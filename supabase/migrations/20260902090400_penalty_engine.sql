-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0009  Straffbanken engine
--
-- Depends on 0007 (schema) + 0008 (day states / valid-earned helpers).
-- Forward-only.
--
-- EARNING  (server-authoritative, idempotent)
--   _reconcile_earned_penalties(challenge, user)  — recompute the earned set
--   from streak runs, INSERT ON CONFLICT DO NOTHING, and mark still-unused rows
--   whose streak basis vanished as 'revoked'. Fires automatically from
--   statement-level triggers on training_entries / training_proofs, and is also
--   exposed as reconcile_earned_penalties() for admin tools.
--
-- ASSIGNMENT  (atomic)
--   assign_penalty(earned_penalty, target)  — verify ownership + availability,
--   verify target is an eligible active participant, reserve the target's next
--   unpenalized eligible day STRICTLY AFTER today, insert the assignment, mark
--   the inventory row spent, audit — all in one transaction. Collisions
--   auto-advance to the next free day (docs/PHASE_9_PLATFORM.md §7). The partial
--   unique index pa_one_active_per_target_day is the concurrency backstop.
--
-- CANCELLATION  (admin, audited)
--   cancel_penalty_assignment(assignment, reason)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Earning
-- ----------------------------------------------------------------------------
create or replace function public._reconcile_earned_penalties(
  p_challenge_id uuid,
  p_user_id      uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.challenges where id = p_challenge_id;
  -- Earned state is only computed while the challenge is live. Completion
  -- freezes it (unused rows are expired by complete_challenge()).
  if v_status is distinct from 'active' then
    return;
  end if;

  with valid as (
    select * from public.challenge_valid_earned_penalties(p_challenge_id, p_user_id)
  ),
  ins as (
    insert into public.earned_penalties (
      challenge_id, user_id, penalty_definition_id, streak_run_start,
      penalty_type, value, display_name, earned_on_date, status
    )
    select
      p_challenge_id, p_user_id, v.definition_id, v.streak_run_start,
      d.penalty_type, d.value, d.display_name, v.earned_on_date, 'available'
    from valid v
    join public.challenge_penalty_definitions d on d.id = v.definition_id
    on conflict (challenge_id, user_id, penalty_definition_id, streak_run_start)
      do nothing
    returning id, streak_run_start, earned_on_date, display_name
  )
  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, after_data
  )
  select
    (select auth.uid()), p_challenge_id, p_user_id, 'earned_penalty', ins.id, 'penalty_earned',
    jsonb_build_object(
      'display_name', ins.display_name,
      'streak_run_start', ins.streak_run_start,
      'earned_on_date', ins.earned_on_date
    )
  from ins;

  with revoked as (
    update public.earned_penalties ep
    set status = 'revoked'
    where ep.challenge_id = p_challenge_id
      and ep.user_id = p_user_id
      and ep.status = 'available'
      and not exists (
        select 1
        from public.challenge_valid_earned_penalties(p_challenge_id, p_user_id) v
        where v.definition_id = ep.penalty_definition_id
          and v.streak_run_start = ep.streak_run_start
      )
    returning ep.id, ep.display_name, ep.streak_run_start
  )
  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, before_data
  )
  select
    (select auth.uid()), p_challenge_id, p_user_id, 'earned_penalty', revoked.id, 'penalty_revoked',
    jsonb_build_object(
      'display_name', revoked.display_name,
      'streak_run_start', revoked.streak_run_start
    )
  from revoked;
end;
$$;

comment on function public._reconcile_earned_penalties is
  'Internal worker: recompute one participant''s earned Straffbank from their '
  'streak runs. Idempotent. No auth check — callers gate access.';

create or replace function public.reconcile_earned_penalties(
  p_challenge_id uuid,
  p_user_id      uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  target uuid := coalesce(p_user_id, (select auth.uid()));
begin
  if uid is not null and target is distinct from uid and not public.is_admin() then
    raise exception 'Du kan bara räkna om din egen straffbank';
  end if;
  perform public._reconcile_earned_penalties(p_challenge_id, target);
end;
$$;

revoke all on function public.reconcile_earned_penalties(uuid, uuid) from public, anon;
grant execute on function public.reconcile_earned_penalties(uuid, uuid) to authenticated;

-- Automatic reconciliation. Statement-level with transition tables so bulk
-- admin operations reconcile each affected participant once, not per row.
create or replace function public.trg_reconcile_from_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select distinct challenge_id, user_id from changed loop
    perform public._reconcile_earned_penalties(r.challenge_id, r.user_id);
  end loop;
  return null;
end;
$$;

create trigger training_entries_reconcile_ins
  after insert on public.training_entries
  referencing new table as changed
  for each statement execute function public.trg_reconcile_from_changed();
create trigger training_entries_reconcile_upd
  after update on public.training_entries
  referencing new table as changed
  for each statement execute function public.trg_reconcile_from_changed();
create trigger training_entries_reconcile_del
  after delete on public.training_entries
  referencing old table as changed
  for each statement execute function public.trg_reconcile_from_changed();

create trigger training_proofs_reconcile_ins
  after insert on public.training_proofs
  referencing new table as changed
  for each statement execute function public.trg_reconcile_from_changed();
create trigger training_proofs_reconcile_upd
  after update on public.training_proofs
  referencing new table as changed
  for each statement execute function public.trg_reconcile_from_changed();
create trigger training_proofs_reconcile_del
  after delete on public.training_proofs
  referencing old table as changed
  for each statement execute function public.trg_reconcile_from_changed();

-- ----------------------------------------------------------------------------
-- Assignment
-- ----------------------------------------------------------------------------

-- First eligible day for `p_to_user_id` STRICTLY after the challenge-local today
-- that has no active penalty. NULL when the target has no such day left, or is
-- not an eligible active participant.
create or replace function public._next_penalty_target_date(
  p_challenge_id uuid,
  p_to_user_id   uuid
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_row     public.challenges;
  m_active  boolean;
  eff_start date;
  eff_end   date;
  today     date;
  cand      date;
begin
  select * into c_row from public.challenges where id = p_challenge_id;
  if c_row.id is null then return null; end if;

  today := (now() at time zone c_row.timezone)::date;

  select m.active,
         greatest(c_row.start_date, m.participation_start_date),
         least(c_row.end_date, coalesce(m.participation_end_date, c_row.end_date))
    into m_active, eff_start, eff_end
  from public.challenge_memberships m
  where m.challenge_id = p_challenge_id and m.user_id = p_to_user_id;

  if not found or not coalesce(m_active, false) then return null; end if;

  cand := greatest(today + 1, eff_start);
  while cand <= eff_end loop
    if not exists (
      select 1 from public.penalty_assignments pa
      where pa.challenge_id = p_challenge_id
        and pa.to_user_id = p_to_user_id
        and pa.target_date = cand
        and pa.status = 'active'
    ) then
      return cand;
    end if;
    cand := cand + 1;
  end loop;

  return null;
end;
$$;

revoke all on function public._next_penalty_target_date(uuid, uuid) from public, anon;

-- Read-only "where would this land" for the confirm UI.
create or replace function public.preview_penalty_target(
  p_earned_penalty_id uuid,
  p_to_user_id        uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_ep  public.earned_penalties;
  v_ch  public.challenges;
  v_td  date;
begin
  select * into v_ep from public.earned_penalties where id = p_earned_penalty_id;
  if v_ep.id is null or v_ep.user_id <> uid then
    return jsonb_build_object('ok', false, 'reason', 'Straffet finns inte eller tillhör inte dig');
  end if;
  if v_ep.status <> 'available' then
    return jsonb_build_object('ok', false, 'reason', 'Straffet är redan använt eller har gått ut');
  end if;
  if p_to_user_id = uid then
    return jsonb_build_object('ok', false, 'reason', 'Du kan inte straffa dig själv');
  end if;

  select * into v_ch from public.challenges where id = v_ep.challenge_id;
  if v_ch.status <> 'active'
     or (now() at time zone v_ch.timezone)::date > v_ch.end_date then
    return jsonb_build_object('ok', false, 'reason', 'Utmaningen är inte aktiv');
  end if;

  v_td := public._next_penalty_target_date(v_ep.challenge_id, p_to_user_id);
  if v_td is null then
    return jsonb_build_object('ok', false,
      'reason', 'Det finns ingen ledig dag kvar att straffa personen på');
  end if;

  return jsonb_build_object(
    'ok', true,
    'target_date', v_td,
    'penalty_type', v_ep.penalty_type,
    'value', v_ep.value,
    'display_name', v_ep.display_name
  );
end;
$$;

revoke all on function public.preview_penalty_target(uuid, uuid) from public, anon;
grant execute on function public.preview_penalty_target(uuid, uuid) to authenticated;

-- Atomic assignment.
create or replace function public.assign_penalty(
  p_earned_penalty_id uuid,
  p_to_user_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid            uuid := (select auth.uid());
  v_ep           public.earned_penalties;
  v_ch           public.challenges;
  v_today        date;
  v_target_date  date;
  v_assignment_id uuid;
  v_tries        int := 0;
begin
  if uid is null then
    raise exception 'assign_penalty kräver en inloggad session';
  end if;
  if p_to_user_id = uid then
    raise exception 'Du kan inte straffa dig själv';
  end if;

  -- Lock the inventory row for the duration of the transaction.
  select * into v_ep from public.earned_penalties
  where id = p_earned_penalty_id
  for update;

  if v_ep.id is null then
    raise exception 'Straffet finns inte';
  end if;
  if v_ep.user_id <> uid then
    raise exception 'Det här straffet tillhör inte dig';
  end if;
  if v_ep.status <> 'available' then
    raise exception 'Straffet är redan använt eller har gått ut';
  end if;

  select * into v_ch from public.challenges where id = v_ep.challenge_id;
  if v_ch.status <> 'active' then
    raise exception 'Utmaningen är inte aktiv';
  end if;

  v_today := (now() at time zone v_ch.timezone)::date;
  if v_today > v_ch.end_date then
    raise exception 'Utmaningen är slut';
  end if;

  -- Reserve the next free eligible day. Retry on the (rare) race where a
  -- concurrent assignment claimed the same date between the lookup and insert.
  loop
    v_target_date := public._next_penalty_target_date(v_ep.challenge_id, p_to_user_id);
    if v_target_date is null then
      raise exception 'Det finns ingen ledig dag kvar att straffa personen på';
    end if;

    begin
      insert into public.penalty_assignments (
        challenge_id, earned_penalty_id, from_user_id, to_user_id,
        target_date, penalty_type, value, display_name, status
      )
      values (
        v_ep.challenge_id, v_ep.id, uid, p_to_user_id,
        v_target_date, v_ep.penalty_type, v_ep.value, v_ep.display_name, 'active'
      )
      returning id into v_assignment_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 60 then
        raise exception 'Kunde inte tilldela straffet just nu, försök igen';
      end if;
    end;
  end loop;

  update public.earned_penalties
    set status = 'spent', spent_assignment_id = v_assignment_id
  where id = v_ep.id;

  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, after_data
  )
  values (
    uid, v_ep.challenge_id, p_to_user_id, 'penalty_assignment', v_assignment_id, 'penalty_assigned',
    jsonb_build_object(
      'from_user_id', uid, 'to_user_id', p_to_user_id, 'target_date', v_target_date,
      'penalty_type', v_ep.penalty_type, 'value', v_ep.value, 'display_name', v_ep.display_name
    )
  );

  return jsonb_build_object(
    'assignment_id', v_assignment_id,
    'to_user_id', p_to_user_id,
    'target_date', v_target_date,
    'penalty_type', v_ep.penalty_type,
    'value', v_ep.value,
    'display_name', v_ep.display_name
  );
end;
$$;

revoke all on function public.assign_penalty(uuid, uuid) from public, anon;
grant execute on function public.assign_penalty(uuid, uuid) to authenticated;

-- Admin cancellation, mandatory reason, audited. The inventory row does NOT
-- return to the sender (docs/PHASE_9_PLATFORM.md §7).
create or replace function public.cancel_penalty_assignment(
  p_assignment_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_pa  public.penalty_assignments;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får ångra ett straff';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'En anledning krävs';
  end if;

  update public.penalty_assignments
    set status = 'cancelled',
        cancelled_by = uid,
        cancelled_reason = btrim(p_reason),
        cancelled_at = now()
  where id = p_assignment_id and status = 'active'
  returning * into v_pa;

  if v_pa.id is null then
    raise exception 'Straffet är inte aktivt eller finns inte';
  end if;

  update public.earned_penalties
    set status = 'revoked'
  where id = v_pa.earned_penalty_id and status = 'spent';

  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, before_data, after_data, note
  )
  values (
    uid, v_pa.challenge_id, v_pa.to_user_id, 'penalty_assignment', v_pa.id, 'penalty_assignment_cancelled',
    jsonb_build_object('target_date', v_pa.target_date, 'display_name', v_pa.display_name,
                       'from_user_id', v_pa.from_user_id),
    jsonb_build_object('status', 'cancelled'),
    btrim(p_reason)
  );

  return jsonb_build_object('assignment_id', v_pa.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_penalty_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_penalty_assignment(uuid, text) to authenticated;
