-- ============================================================================
-- Hälsoutmaningen — Phase 10 / 0013  audited correction of an ACTIVE
-- challenge's start_date, forward-only.
--
-- Depends on 0001–0012. Forward-only, non-destructive.
--
-- Production problem this fixes: a challenge was activated with the wrong
-- start_date (e.g. configured for 2026-08-01 when it should have been
-- 2026-09-01). challenges_guard() correctly locks start_date once a challenge
-- is active — that lock stays the default. This migration adds ONE narrow,
-- audited escape hatch:
--
--   preview_challenge_start_date_correction(challenge, new_start)
--       read-only safety check — never mutates anything.
--   correct_challenge_start_date(challenge, new_start, reason)
--       re-runs the same check inside the transaction, then moves start_date
--       forward. Nothing is deleted; challenge_day_states/challenge_results/
--       streaks/liability all recompute naturally because they are derived
--       live from challenges.start_date — there is no persisted state to
--       rewrite for dates that simply leave the (start_date..end_date) grid.
--
-- Safety (enforced by _challenge_start_date_correction_check, called by both
-- RPCs so preview and apply can never disagree):
--   * the challenge must be 'active'
--   * new_start_date must be STRICTLY AFTER the current start_date (forward
--     only — this is a correction, not a general re-date)
--   * new_start_date must be <= end_date
--   * no ACTIVE training_entries row may exist before new_start_date
--   * no ACTIVE penalty_assignments row may target a date before new_start_date
--   * no earned_penalties row (any status) may have earned_on_date before
--     new_start_date
-- A membership whose participation_start_date is before new_start_date does
-- NOT block the correction on its own (CLAUDE.md §4 late-join semantics keep
-- working exactly the same either side of the corrected start).
--
-- The bypass is a transaction-local flag (set_config('app.
-- allow_start_date_correction', 'true', true)), mirroring the existing
-- app.audit_reason idiom (0010) — challenges_guard() only allows a start_date
-- change through when this RPC set it, and only forward. Every other locked
-- field stays locked during the correction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- challenges_guard — unchanged except: the start_date lock now has one
-- narrow, flagged bypass (forward-only). Copied from 0006 with that addition.
-- ----------------------------------------------------------------------------
create or replace function public.challenges_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_backend boolean := (select auth.uid()) is null;
  locked     boolean;
  orphaned   int;
  allow_start_correction boolean :=
    coalesce(nullif(current_setting('app.allow_start_date_correction', true), ''), 'false')::boolean;
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'active' and new.activated_at is null then
      new.activated_at := now();
    end if;
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
    return new;
  end if;

  -- ---- UPDATE ----------------------------------------------------------------

  -- Status state machine. A no-JWT backend may break glass (document it).
  if new.status is distinct from old.status and not is_backend then
    if not (
         (old.status = 'draft'     and new.status in ('active', 'archived'))
      or (old.status = 'active'    and new.status in ('completed', 'archived'))
      or (old.status = 'completed' and new.status in ('active', 'archived'))
      or (old.status = 'archived'  and new.status in ('active', 'completed'))
    ) then
      raise exception 'Ogiltig statusövergång: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status = 'active' and new.activated_at is null then
    new.activated_at := now();
  end if;
  if new.status = 'completed' then
    new.completed_at := now();
  end if;

  -- Rule lock: draft + not-yet-started is the only freely-editable window.
  locked := (
    (old.status <> 'draft')
    or ((now() at time zone old.timezone)::date >= old.start_date)
  ) and not is_backend;

  if locked then
    if (new.start_date is distinct from old.start_date and not allow_start_correction)
    or new.timezone         is distinct from old.timezone
    or new.required_minutes is distinct from old.required_minutes
    or new.proof_required   is distinct from old.proof_required
    or new.missed_day_cost  is distinct from old.missed_day_cost then
      raise exception
        'Challenge rule fields are locked once the challenge is active or has started. '
        'Duplicate the challenge to change its rules.';
    end if;

    -- The flagged bypass only ever moves start_date forward. Anything else
    -- (a bug in the calling RPC, or the flag leaking into an unrelated
    -- statement) is rejected rather than silently allowed.
    if allow_start_correction
       and new.start_date is distinct from old.start_date
       and new.start_date <= old.start_date then
      raise exception 'Startdatumet kan bara flyttas framåt vid en rättning';
    end if;

    if new.end_date is distinct from old.end_date then
      if old.status in ('completed', 'archived') then
        raise exception 'Cannot change end_date of a % challenge', old.status;
      end if;
      if new.end_date < old.end_date then
        raise exception 'A running challenge''s end_date may only be extended';
      end if;
    end if;
  else
    -- Draft is being re-dated: no existing membership window may fall out of it.
    if (new.start_date is distinct from old.start_date
        or new.end_date is distinct from old.end_date) then
      select count(*) into orphaned
      from public.challenge_memberships m
      where m.challenge_id = new.id
        and (m.participation_start_date > new.end_date
             or coalesce(m.participation_end_date, new.start_date) < new.start_date);
      if orphaned > 0 then
        raise exception
          '% deltagares deltagandeperiod hamnar utanför de nya datumen — justera perioderna först',
          orphaned;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- audit_row_change — unchanged except: one new recognised action for the
-- challenge entity, taken from a transaction-local flag the correction RPC
-- sets (mirrors how app.audit_reason already carries the reason). Copied from
-- 0006/0007 with that addition.
-- ----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity  text := tg_argv[0];
  v_always  boolean := tg_argv[1]::boolean;
  v_action  text := lower(tg_op);
  v_before  jsonb;
  v_after   jsonb;
  v_row     jsonb;
  -- Optional human reason, set transaction-locally by a correction RPC via
  -- set_config('app.audit_reason', …, true). Lets a DEFINER RPC attach a reason
  -- to the SINGLE audit row the trigger produces, instead of writing its own
  -- (which would double-log). Set by invalidate/revalidate and by
  -- correct_challenge_start_date.
  v_note    text := nullif(btrim(coalesce(
                      current_setting('app.audit_reason', true), '')), '');
  -- Likewise transaction-local: lets correct_challenge_start_date's plain
  -- UPDATE produce a specific, searchable action name instead of the generic
  -- 'challenge_rules_changed'.
  v_correction_kind text := nullif(current_setting('app.correction_kind', true), '');
begin
  if not v_always
     and not public.is_admin()
     and (select auth.uid()) is not null then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);

  if v_entity = 'challenge' then
    if tg_op = 'INSERT' then
      v_action := 'challenge_created';
    elsif tg_op = 'DELETE' then
      v_action := 'challenge_deleted';
    elsif new.status is distinct from old.status then
      v_action := case
        when old.status = 'draft'     and new.status = 'active'    then 'challenge_activated'
        when old.status = 'completed' and new.status = 'active'    then 'challenge_reopened'
        when old.status = 'archived'  and new.status = 'active'    then 'challenge_reopened'
        when new.status = 'completed'                              then 'challenge_completed'
        when new.status = 'archived'                               then 'challenge_archived'
        else 'challenge_status_changed'
      end;
    elsif v_correction_kind = 'start_date_correction' then
      v_action := 'challenge_start_date_corrected';
    elsif new.start_date       is distinct from old.start_date
       or new.end_date         is distinct from old.end_date
       or new.timezone         is distinct from old.timezone
       or new.required_minutes is distinct from old.required_minutes
       or new.proof_required   is distinct from old.proof_required
       or new.missed_day_cost  is distinct from old.missed_day_cost then
      v_action := 'challenge_rules_changed';
    end if;
  elsif v_entity = 'challenge_membership' then
    if tg_op = 'INSERT' then
      v_action := 'membership_created';
    elsif tg_op = 'DELETE' then
      v_action := 'membership_deleted';
    elsif new.active is distinct from old.active then
      v_action := case when new.active then 'membership_reactivated'
                       else 'membership_deactivated' end;
    elsif new.participation_start_date is distinct from old.participation_start_date
       or new.participation_end_date   is distinct from old.participation_end_date then
      v_action := 'membership_window_changed';
    end if;
  elsif v_entity = 'training_entry' and tg_op = 'UPDATE' then
    if new.status = 'invalidated' and old.status <> 'invalidated' then
      v_action := 'invalidate';
    elsif new.status = 'active' and old.status = 'invalidated' then
      v_action := 'revalidate';
    end if;
  end if;

  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id,
    entity_type, entity_id, action, before_data, after_data, note
  )
  values (
    (select auth.uid()),
    coalesce(
      nullif(v_row ->> 'challenge_id', '')::uuid,
      case when v_entity = 'challenge' then nullif(v_row ->> 'id', '')::uuid end
    ),
    nullif(v_row ->> 'user_id', '')::uuid,
    v_entity,
    nullif(v_row ->> 'id', '')::uuid,
    v_action,
    v_before,
    v_after,
    v_note
  );

  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- The one authoritative safety check, shared by preview and apply so they can
-- never disagree. Not granted directly — both public RPCs below call it.
-- ----------------------------------------------------------------------------
create or replace function public._challenge_start_date_correction_check(
  p_challenge_id   uuid,
  p_new_start_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch  public.challenges;
  v_bad date;
begin
  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null then
    return jsonb_build_object('ok', false, 'blocking_code', 'not_found');
  end if;

  if v_ch.status <> 'active' then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'not_active',
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  if p_new_start_date <= v_ch.start_date then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'not_forward',
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  if p_new_start_date > v_ch.end_date then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'past_end',
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  -- No real, currently-valid training in the period being removed.
  select min(te.challenge_date) into v_bad
  from public.training_entries te
  where te.challenge_id = p_challenge_id
    and te.status = 'active'
    and te.challenge_date < p_new_start_date;
  if v_bad is not null then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'training_exists', 'blocking_date', v_bad,
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  -- No active penalty assignment targets a date being removed.
  select min(pa.target_date) into v_bad
  from public.penalty_assignments pa
  where pa.challenge_id = p_challenge_id
    and pa.status = 'active'
    and pa.target_date < p_new_start_date;
  if v_bad is not null then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'penalty_target_exists', 'blocking_date', v_bad,
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  -- No earned penalty (any status — even a spent/revoked one is a real
  -- historical event) was earned on a date being removed.
  select min(ep.earned_on_date) into v_bad
  from public.earned_penalties ep
  where ep.challenge_id = p_challenge_id
    and ep.earned_on_date < p_new_start_date;
  if v_bad is not null then
    return jsonb_build_object(
      'ok', false, 'blocking_code', 'penalty_earned_exists', 'blocking_date', v_bad,
      'old_start_date', v_ch.start_date, 'new_start_date', p_new_start_date);
  end if;

  return jsonb_build_object(
    'ok', true,
    'old_start_date', v_ch.start_date,
    'new_start_date', p_new_start_date,
    'removed_range_start', v_ch.start_date,
    'removed_range_end', p_new_start_date - 1
  );
end;
$$;

revoke all on function public._challenge_start_date_correction_check(uuid, date)
  from public, anon;

-- ----------------------------------------------------------------------------
-- Read-only preview for the admin confirm UI. Admin-only; never mutates.
-- ----------------------------------------------------------------------------
create or replace function public.preview_challenge_start_date_correction(
  p_challenge_id   uuid,
  p_new_start_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får förhandsgranska en datumrättning';
  end if;
  return public._challenge_start_date_correction_check(p_challenge_id, p_new_start_date);
end;
$$;

revoke all on function public.preview_challenge_start_date_correction(uuid, date)
  from public, anon;
grant execute on function public.preview_challenge_start_date_correction(uuid, date)
  to authenticated;

-- ----------------------------------------------------------------------------
-- The atomic, audited correction. Admin-only. Re-runs the exact same safety
-- check inside the transaction (never trusts a stale client-side preview),
-- then flips the transaction-local bypass just for this one UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.correct_challenge_start_date(
  p_challenge_id   uuid,
  p_new_start_date date,
  p_reason         text default null
)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_ch  public.challenges;
  chk   jsonb;
  v_row public.challenges;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får rätta utmaningens startdatum';
  end if;

  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if v_ch.id is null then
    raise exception 'Utmaningen finns inte';
  end if;

  -- Never trust a stale client-side preview: re-run the exact same check
  -- inside this transaction. The failure message stays free of internal
  -- detail (blocking_code / blocking_date) — those are for the preview RPC's
  -- JSON response to humanize, not for a raised exception a client surfaces
  -- verbatim (CLAUDE.md §4 "do not expose raw SQL/backend wording"). Since
  -- the confirm UI only ever calls this after an 'ok' preview, reaching this
  -- branch means something changed in between; ask the admin to re-check.
  chk := public._challenge_start_date_correction_check(p_challenge_id, p_new_start_date);
  if not (chk ->> 'ok')::boolean then
    raise exception
      'Rättningen kan inte längre genomföras — något ändrades sedan förhandsgranskningen. Förhandsgranska igen.';
  end if;

  perform set_config(
    'app.audit_reason', coalesce(nullif(btrim(p_reason), ''), 'Rättning av startdatum'), true);
  perform set_config('app.correction_kind', 'start_date_correction', true);
  perform set_config('app.allow_start_date_correction', 'true', true);

  update public.challenges
    set start_date = p_new_start_date
  where id = p_challenge_id
  returning * into v_row;

  perform set_config('app.audit_reason', '', true);
  perform set_config('app.correction_kind', '', true);
  perform set_config('app.allow_start_date_correction', '', true);

  return v_row;
end;
$$;

revoke all on function public.correct_challenge_start_date(uuid, date, text)
  from public, anon;
grant execute on function public.correct_challenge_start_date(uuid, date, text)
  to authenticated;

comment on function public.correct_challenge_start_date is
  'Admin-only, audited, forward-only correction of an ACTIVE challenge''s '
  'start_date. Blocks (without deleting anything) when real training, '
  'assigned or earned Straffbank history exists in the period being removed. '
  'challenge_day_states/challenge_results/streaks/liability recompute '
  'naturally — nothing about them is stored.';
