-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0006  challenge lifecycle + safe rule editing
--
-- Depends on 0001–0002. Forward-only, non-destructive.
--
-- Adds:
--   * challenges.description / activated_at / completed_at
--   * a status state machine in challenges_guard (draft→active→completed→
--     archived, plus completed→active "reopen" for audited corrections)
--   * revalidation of existing memberships when a DRAFT challenge's dates move
--   * richer audit actions for challenges and memberships (challenge_activated,
--     challenge_completed, challenge_rules_changed, membership_window_changed, …)
--   * create_challenge() — one call, admin-checked, returns the new id
--
-- RULE-MUTATION POLICY (docs/PHASE_9_PLATFORM.md §3): hard immutability.
-- While a challenge is a draft its rules are freely editable. Once it is active
-- or its start date has passed, start_date / timezone / required_minutes /
-- proof_required / missed_day_cost are permanently locked; end_date may only be
-- extended. To change the rules of a running challenge you duplicate it. No
-- effective-dated rule versions — historical day-state is never rewritten.
-- ============================================================================

alter table public.challenges
  add column if not exists description text
    constraint challenges_description_len
    check (description is null or char_length(description) <= 2000);

alter table public.challenges
  add column if not exists activated_at timestamptz;

alter table public.challenges
  add column if not exists completed_at timestamptz;

comment on column public.challenges.activated_at is
  'Set by challenges_guard the first time status becomes active. Not user-writable.';
comment on column public.challenges.completed_at is
  'Set by challenges_guard when status becomes completed. Not user-writable.';

-- ----------------------------------------------------------------------------
-- challenges_guard — timezone validity, rule lock, status state machine,
-- draft-date membership revalidation, lifecycle timestamps.
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
    if new.start_date       is distinct from old.start_date
    or new.timezone         is distinct from old.timezone
    or new.required_minutes is distinct from old.required_minutes
    or new.proof_required   is distinct from old.proof_required
    or new.missed_day_cost  is distinct from old.missed_day_cost then
      raise exception
        'Challenge rule fields are locked once the challenge is active or has started. '
        'Duplicate the challenge to change its rules.';
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
-- audit_row_change — descriptive actions for challenges / memberships.
-- (unchanged behaviour for training_entry / training_proof; new entity types
--  are wired with their own triggers in a later migration.)
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
    entity_type, entity_id, action, before_data, after_data
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
    v_after
  );

  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- create_challenge — admin-checked single call. Rules are data; nothing about
-- the first challenge is special.
-- ----------------------------------------------------------------------------
create or replace function public.create_challenge(
  p_name             text,
  p_start_date       date,
  p_end_date         date,
  p_required_minutes integer,
  p_missed_day_cost  integer,
  p_timezone         text default 'Europe/Stockholm',
  p_proof_required   boolean default true,
  p_description      text default null
)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := (select auth.uid());
  v_row public.challenges;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får skapa utmaningar';
  end if;

  insert into public.challenges (
    name, description, start_date, end_date, timezone,
    required_minutes, proof_required, missed_day_cost, status, created_by
  )
  values (
    p_name, nullif(btrim(p_description), ''), p_start_date, p_end_date, p_timezone,
    p_required_minutes, p_proof_required, p_missed_day_cost, 'draft', uid
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_challenge(
  text, date, date, integer, integer, text, boolean, text) from public, anon;
grant execute on function public.create_challenge(
  text, date, date, integer, integer, text, boolean, text) to authenticated;
