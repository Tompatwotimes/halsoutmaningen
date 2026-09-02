-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0010  challenge operations, corrections, export
--
-- Depends on 0006–0009. Forward-only.
--
--   invalidate_training_session / revalidate_training_session
--       admin correction with a MANDATORY reason; the original row, its proof
--       metadata, the actor, the time and the reason are all preserved. The
--       existing audit trigger records invalidate / revalidate; the reconcile
--       trigger recomputes the participant's streak-derived Straffbank.
--
--   duplicate_challenge   "Skapa ny från denna" — copies the rule set and the
--       penalty definitions (and, optionally, the roster with fresh windows).
--       Never copies history, proofs, earned penalties, assignments or audit.
--
--   complete_challenge / archive_challenge / reopen_challenge
--       lifecycle transitions; completion/archival expires unused Straffbank
--       ammunition. Reopening is allowed for audited corrections.
--
--   challenge_results(challenge)  per-participant aggregate built entirely from
--       authoritative state — the export read model.
-- ============================================================================

alter table public.training_entries
  add column if not exists invalidated_reason_code text
    constraint training_entries_invalidated_reason_code_valid
    check (invalidated_reason_code is null or invalidated_reason_code in (
      'felregistrerad', 'otillrackligt_bildbevis', 'dubblett',
      'fel_datum', 'administrativ_rattning', 'annat'
    ));

-- ----------------------------------------------------------------------------
-- Admin corrections
-- ----------------------------------------------------------------------------
create or replace function public.invalidate_training_session(
  p_entry_id    uuid,
  p_reason      text,
  p_reason_code text default null
)
returns public.training_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.training_entries;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får ogiltigförklara ett pass';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'En anledning krävs';
  end if;

  -- The audit trigger (audit_row_change) writes the single 'invalidate' row and
  -- picks the reason up from here — the RPC never writes its own audit row.
  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.training_entries
    set status = 'invalidated',
        invalidated_reason = btrim(p_reason),
        invalidated_reason_code = p_reason_code,
        invalidated_by = uid,
        invalidated_at = now()
  where id = p_entry_id and status = 'active'
  returning * into v_row;

  perform set_config('app.audit_reason', '', true);

  if v_row.id is null then
    raise exception 'Passet finns inte eller är redan ogiltigförklarat';
  end if;
  return v_row;
end;
$$;

create or replace function public.revalidate_training_session(
  p_entry_id uuid,
  p_reason   text
)
returns public.training_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.training_entries;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får återställa ett pass';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'En anledning krävs';
  end if;

  -- Exactly one audit event: the audit trigger emits 'revalidate' and reads the
  -- reason from here. No second, explicit audit row.
  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.training_entries
    set status = 'active',
        invalidated_reason = null,
        invalidated_reason_code = null,
        invalidated_by = null,
        invalidated_at = null
  where id = p_entry_id and status = 'invalidated'
  returning * into v_row;

  perform set_config('app.audit_reason', '', true);

  if v_row.id is null then
    raise exception 'Passet finns inte eller är redan aktivt';
  end if;

  return v_row;
end;
$$;

revoke all on function public.invalidate_training_session(uuid, text, text) from public, anon;
revoke all on function public.revalidate_training_session(uuid, text) from public, anon;
grant execute on function public.invalidate_training_session(uuid, text, text) to authenticated;
grant execute on function public.revalidate_training_session(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- duplicate_challenge — "Skapa ny från denna"
-- ----------------------------------------------------------------------------
create or replace function public.duplicate_challenge(
  p_source_id   uuid,
  p_name        text,
  p_start_date  date,
  p_end_date    date,
  p_copy_roster boolean default false
)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  src   public.challenges;
  v_new public.challenges;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får skapa utmaningar';
  end if;

  select * into src from public.challenges where id = p_source_id;
  if src.id is null then
    raise exception 'Källutmaningen finns inte';
  end if;

  insert into public.challenges (
    name, description, start_date, end_date, timezone,
    required_minutes, proof_required, missed_day_cost, status, created_by
  )
  values (
    p_name, src.description, p_start_date, p_end_date, src.timezone,
    src.required_minutes, src.proof_required, src.missed_day_cost, 'draft', uid
  )
  returning * into v_new;

  insert into public.challenge_penalty_definitions (
    challenge_id, unlock_streak, penalty_type, value, display_name, active, sort_order
  )
  select v_new.id, unlock_streak, penalty_type, value, display_name, active, sort_order
  from public.challenge_penalty_definitions
  where challenge_id = p_source_id;

  if p_copy_roster then
    insert into public.challenge_memberships (
      challenge_id, user_id, participation_start_date, participation_end_date, active, created_by
    )
    select
      v_new.id, m.user_id,
      p_start_date,  -- fresh window: the whole new challenge
      null, true, uid
    from public.challenge_memberships m
    where m.challenge_id = p_source_id;
  end if;

  insert into public.audit_log (actor_user_id, challenge_id, entity_type, entity_id, action, after_data, note)
  values (uid, v_new.id, 'challenge', v_new.id, 'challenge_created',
          to_jsonb(v_new), format('duplicated from %s', p_source_id));

  return v_new;
end;
$$;

revoke all on function public.duplicate_challenge(uuid, text, date, date, boolean) from public, anon;
grant execute on function public.duplicate_challenge(uuid, text, date, date, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Lifecycle transitions
-- ----------------------------------------------------------------------------
create or replace function public.complete_challenge(p_challenge_id uuid)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.challenges;
  v_expired int;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får avsluta en utmaning';
  end if;

  update public.challenges set status = 'completed'
  where id = p_challenge_id and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Utmaningen är inte aktiv';
  end if;

  update public.earned_penalties
    set status = 'expired'
  where challenge_id = p_challenge_id and status = 'available';
  get diagnostics v_expired = row_count;

  insert into public.audit_log (actor_user_id, challenge_id, entity_type, entity_id, action, note)
  values (uid, p_challenge_id, 'challenge', p_challenge_id, 'penalties_expired',
          format('%s oanvända straff gick ut', v_expired));

  return v_row;
end;
$$;

create or replace function public.archive_challenge(p_challenge_id uuid)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.challenges;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får arkivera en utmaning';
  end if;

  update public.challenges set status = 'archived'
  where id = p_challenge_id and status in ('active', 'completed')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Endast aktiva eller avslutade utmaningar kan arkiveras';
  end if;

  update public.earned_penalties
    set status = 'expired'
  where challenge_id = p_challenge_id and status = 'available';

  return v_row;
end;
$$;

create or replace function public.reopen_challenge(p_challenge_id uuid)
returns public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.challenges;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får återöppna en utmaning';
  end if;

  update public.challenges set status = 'active'
  where id = p_challenge_id and status in ('completed', 'archived')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Endast en avslutad eller arkiverad utmaning kan återöppnas';
  end if;

  insert into public.audit_log (actor_user_id, challenge_id, entity_type, entity_id, action, note)
  values (uid, p_challenge_id, 'challenge', p_challenge_id, 'challenge_reopened',
          'Återöppnad för administrativ rättning');

  return v_row;
end;
$$;

revoke all on function public.complete_challenge(uuid) from public, anon;
revoke all on function public.archive_challenge(uuid)  from public, anon;
revoke all on function public.reopen_challenge(uuid)   from public, anon;
grant execute on function public.complete_challenge(uuid) to authenticated;
grant execute on function public.archive_challenge(uuid)  to authenticated;
grant execute on function public.reopen_challenge(uuid)   to authenticated;

-- ----------------------------------------------------------------------------
-- challenge_results — the export / dashboard read model, from authoritative state
-- ----------------------------------------------------------------------------
create or replace function public.challenge_results(p_challenge_id uuid)
returns table (
  user_id                  uuid,
  participation_start_date date,
  participation_end_date   date,
  membership_active        boolean,
  eligible_days            integer,
  completed_days           integer,
  missed_days              integer,
  pending_days             integer,
  future_days              integer,
  completion_rate          numeric,
  current_streak           integer,
  longest_streak           integer,
  total_valid_minutes      bigint,
  liability_sek            integer,
  penalties_earned         integer,
  penalties_assigned       integer,
  penalties_received       integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select id, missed_day_cost from public.challenges where id = p_challenge_id
  ),
  today as (
    select public.challenge_current_date(p_challenge_id) as d
  ),
  ds as (
    select * from public.challenge_day_states(p_challenge_id)
  ),
  tallies as (
    select
      ds.user_id,
      count(*) filter (where ds.state <> 'not_participating')      as eligible_days,
      count(*) filter (where ds.state = 'completed')               as completed_days,
      count(*) filter (where ds.state = 'missed')                  as missed_days,
      count(*) filter (where ds.state = 'pending')                 as pending_days,
      count(*) filter (where ds.state = 'future')                  as future_days,
      coalesce(sum(ds.total_valid_minutes) filter (where ds.state <> 'not_participating'), 0) as total_valid_minutes
    from ds
    group by ds.user_id
  ),
  streaks as (
    select
      m.user_id,
      coalesce((select max(run_len) from public.challenge_streak_runs(p_challenge_id, m.user_id)), 0)
        as longest_streak,
      coalesce((
        select r.run_len
        from public.challenge_streak_runs(p_challenge_id, m.user_id) r
        where r.run_days[array_upper(r.run_days, 1)] = (
          select max(challenge_date) from ds
          where ds.user_id = m.user_id
            and ds.state in ('completed', 'missed')
            and ds.challenge_date <= (select d from today)
        )
      ), 0) as current_streak
    from public.challenge_memberships m
    where m.challenge_id = p_challenge_id
  ),
  pen_earned as (
    select user_id, count(*)::int as n
    from public.earned_penalties
    where challenge_id = p_challenge_id and status <> 'revoked'
    group by user_id
  ),
  pen_sent as (
    select from_user_id as user_id, count(*)::int as n
    from public.penalty_assignments
    where challenge_id = p_challenge_id and status = 'active'
    group by from_user_id
  ),
  pen_recv as (
    select to_user_id as user_id, count(*)::int as n
    from public.penalty_assignments
    where challenge_id = p_challenge_id and status = 'active'
    group by to_user_id
  )
  select
    m.user_id,
    m.participation_start_date,
    m.participation_end_date,
    m.active,
    coalesce(t.eligible_days, 0)::int,
    coalesce(t.completed_days, 0)::int,
    coalesce(t.missed_days, 0)::int,
    coalesce(t.pending_days, 0)::int,
    coalesce(t.future_days, 0)::int,
    case
      when coalesce(t.completed_days, 0) + coalesce(t.missed_days, 0) = 0 then 0
      else round(
        t.completed_days::numeric / (t.completed_days + t.missed_days), 4
      )
    end as completion_rate,
    coalesce(s.current_streak, 0)::int,
    coalesce(s.longest_streak, 0)::int,
    coalesce(t.total_valid_minutes, 0)::bigint,
    (coalesce(t.missed_days, 0) * (select missed_day_cost from c))::int as liability_sek,
    coalesce(pe.n, 0),
    coalesce(ps.n, 0),
    coalesce(pr.n, 0)
  from public.challenge_memberships m
  left join tallies    t  on t.user_id  = m.user_id
  left join streaks    s  on s.user_id  = m.user_id
  left join pen_earned pe on pe.user_id = m.user_id
  left join pen_sent   ps on ps.user_id = m.user_id
  left join pen_recv   pr on pr.user_id = m.user_id
  where m.challenge_id = p_challenge_id;
$$;

revoke all on function public.challenge_results(uuid) from public, anon;
grant execute on function public.challenge_results(uuid) to authenticated;

comment on function public.challenge_results is
  'Per-participant challenge aggregate from authoritative state — the export / '
  'admin-dashboard read model. No private proof URLs.';
