-- ============================================================================
-- Hälsoutmaningen — v1.10.0 voluntary multi-session days / completion fix
--
-- Depends on 0008 (20260902090300_daily_requirement_day_states.sql), 0011
-- (20260904100100_retroactive_registration_rpcs.sql). Forward-only,
-- non-destructive — no historical migration is edited.
--
-- BUG (confirmed): `challenge_daily_requirement()` returned
-- `min_minutes_per_session = 0` for a normal day and for `minimum_minutes`,
-- so `challenge_day_states()` let several sub-threshold sessions SUM to
-- complete a day (e.g. 15 + 15 = 30 wrongly completed a 30-minute day; 20 +
-- 25 = 45 wrongly satisfied a 45-minute penalty). `double_session` was
-- already correct (`min_minutes_per_session = base`), which is exactly why
-- it never exhibited the bug.
--
-- FIX: every mode now enforces the SAME rule — completion requires at least
-- `required_sessions` sessions that EACH, individually, reach
-- `min_minutes_per_session`. Mirrors src/domain/penalties.ts::
-- computeDailyRequirement exactly (see that file's comment for the table).
--
-- STATISTICS vs. COMPLETION (kept deliberately separate, per the domain
-- rule "multiple short sessions must never be accumulated to complete a
-- day" but "do not discard legitimate short extra sessions from
-- training-time statistics"):
--   - `valid_session_count` / `total_valid_minutes` keep their existing
--     names and now mean STATISTICS: every active, (when required) proofed
--     session counts, regardless of its own duration. This is what feeds
--     `challenge_results.total_valid_minutes` (unchanged there — it already
--     just sums this column) and is safe to redefine: nothing computes
--     completion from these two columns.
--   - two NEW columns, `qualifying_session_count` / `qualifying_minutes`,
--     carry the STRICT per-session-floor-gated numbers that `state` is
--     decided from. `preview_retroactive_approval` needed these explicitly
--     (see below) — it used to add its own proposed-sessions math onto
--     `valid_session_count`/`total_valid_minutes`, which stayed correct only
--     because those columns used to mean the same (buggy) thing this
--     migration removes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- challenge_daily_requirement — fix the per-session floor for normal/
-- minimum_minutes days. double_session is unchanged (already correct).
-- ----------------------------------------------------------------------------
create or replace function public.challenge_daily_requirement(
  p_base_minutes  integer,
  p_penalty_type  text,
  p_penalty_value integer
)
returns table (
  required_total_minutes  integer,
  required_sessions       integer,
  min_minutes_per_session integer
)
language sql
immutable
set search_path = ''
as $$
  select
    (case p_penalty_type
      when 'minimum_minutes' then greatest(p_base_minutes, coalesce(p_penalty_value, 0))
      when 'double_session'  then p_base_minutes * greatest(2, coalesce(p_penalty_value, 2))
      else p_base_minutes
    end)::integer,
    (case p_penalty_type
      when 'double_session'  then greatest(2, coalesce(p_penalty_value, 2))
      else 1
    end)::integer,
    (case p_penalty_type
      -- Every mode's floor now matches its own required_total_minutes for a
      -- single-session requirement (normal, minimum_minutes): one session
      -- must ALONE clear the bar. double_session's floor stays the base —
      -- each of its N sessions clears the base independently.
      when 'minimum_minutes' then greatest(p_base_minutes, coalesce(p_penalty_value, 0))
      when 'double_session'  then p_base_minutes
      else p_base_minutes
    end)::integer;
$$;

comment on function public.challenge_daily_requirement is
  'The one penalty-aware daily requirement. Mirror of '
  'src/domain/penalties.ts::computeDailyRequirement. min_minutes_per_session '
  'is the per-session floor EVERY mode enforces — completion is decided by '
  'individually-qualifying sessions, never by summing sub-threshold ones '
  '(v1.10.0 voluntary multi-session days).';

-- ----------------------------------------------------------------------------
-- challenge_day_states — add qualifying_session_count / qualifying_minutes,
-- redefine valid_session_count / total_valid_minutes to statistics. Return
-- shape changes (2 new columns) so this needs DROP + CREATE, same as 0008.
-- ----------------------------------------------------------------------------
drop function if exists public.challenge_day_states(uuid, uuid);

create or replace function public.challenge_day_states(
  p_challenge_id uuid,
  p_user_id      uuid default null
)
returns table (
  user_id                 uuid,
  challenge_date           date,
  state                    text,
  session_count            integer,
  valid_session_count      integer,
  total_valid_minutes      integer,
  qualifying_session_count integer,
  qualifying_minutes       integer,
  required_minutes         integer,
  required_sessions        integer,
  min_minutes_per_session  integer,
  penalty_type             text,
  penalty_display_name     text,
  penalty_from_user_id     uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select id, start_date, end_date, timezone, required_minutes, proof_required
    from public.challenges
    where id = p_challenge_id
  ),
  cur as (
    select (now() at time zone (select timezone from c))::date as today
  ),
  days as (
    select (c.start_date + g)::date as challenge_date
    from c, generate_series(0, (select end_date - start_date from c)) as g
  ),
  mem as (
    select
      m.user_id,
      greatest(c.start_date, m.participation_start_date) as eff_start,
      least(c.end_date, coalesce(m.participation_end_date, c.end_date)) as eff_end
    from public.challenge_memberships m
    cross join c
    where m.challenge_id = p_challenge_id
      and (p_user_id is null or m.user_id = p_user_id)
  ),
  grid as (
    select mem.user_id, days.challenge_date, mem.eff_start, mem.eff_end
    from mem cross join days
  ),
  pen as (
    select pa.to_user_id, pa.target_date, pa.penalty_type,
           pa.value as penalty_value, pa.display_name, pa.from_user_id
    from public.penalty_assignments pa
    where pa.challenge_id = p_challenge_id and pa.status = 'active'
  ),
  withreq as (
    select
      g.user_id, g.challenge_date, g.eff_start, g.eff_end,
      p.penalty_type,
      p.display_name  as penalty_display_name,
      p.from_user_id  as penalty_from_user_id,
      r.required_total_minutes, r.required_sessions, r.min_minutes_per_session
    from grid g
    left join pen p on p.to_user_id = g.user_id and p.target_date = g.challenge_date
    cross join lateral public.challenge_daily_requirement(
      (select required_minutes from c), p.penalty_type, p.penalty_value
    ) r
  ),
  agg as (
    select
      w.*,
      coalesce(s.logged, 0)             as session_count,
      coalesce(s.stats_sessions, 0)     as valid_session_count,
      coalesce(s.stats_minutes, 0)      as total_valid_minutes,
      coalesce(s.qualifying_sessions, 0) as qualifying_session_count,
      coalesce(s.qualifying_minutes, 0)  as qualifying_minutes
    from withreq w
    left join lateral (
      select
        count(*)                                       as logged,
        count(*) filter (where x.stats_ok)              as stats_sessions,
        coalesce(sum(x.duration_minutes) filter (where x.stats_ok), 0)      as stats_minutes,
        count(*) filter (where x.stats_ok and x.qualifies)                  as qualifying_sessions,
        coalesce(sum(x.duration_minutes) filter (where x.stats_ok and x.qualifies), 0) as qualifying_minutes
      from (
        select
          te.duration_minutes,
          (
            te.status = 'active'
            and (
              not (select proof_required from c)
              or exists (
                select 1 from public.training_proofs tp
                where tp.training_entry_id = te.id
              )
            )
          ) as stats_ok,
          te.duration_minutes >= w.min_minutes_per_session as qualifies
        from public.training_entries te
        where te.challenge_id = p_challenge_id
          and te.user_id = w.user_id
          and te.challenge_date = w.challenge_date
      ) x
    ) s on true
  )
  select
    a.user_id,
    a.challenge_date,
    case
      when a.challenge_date < a.eff_start or a.challenge_date > a.eff_end
        then 'not_participating'
      -- Completion is decided ONLY by individually-qualifying sessions
      -- (qualifying_session_count / qualifying_minutes) — never by summing
      -- sub-threshold sessions, which is what valid_session_count /
      -- total_valid_minutes (statistics) would wrongly allow.
      when a.qualifying_session_count >= a.required_sessions
       and a.qualifying_minutes >= a.required_total_minutes
        then 'completed'
      when a.challenge_date > (select today from cur) then 'future'
      when a.challenge_date = (select today from cur) then 'pending'
      else 'missed'
    end as state,
    a.session_count,
    a.valid_session_count,
    a.total_valid_minutes,
    a.qualifying_session_count,
    a.qualifying_minutes,
    a.required_total_minutes as required_minutes,
    a.required_sessions,
    a.min_minutes_per_session,
    a.penalty_type,
    a.penalty_display_name,
    a.penalty_from_user_id
  from agg a;
$$;

comment on function public.challenge_day_states is
  'One row per (participant, challenge day): canonical state plus the '
  'effective penalty-aware requirement and the day''s totals. '
  'valid_session_count/total_valid_minutes are STATISTICS (every active, '
  'proofed-if-required session, any duration) — TOTAL TRAINING TIME, safe '
  'for legitimate short extra sessions. qualifying_session_count/'
  'qualifying_minutes are the STRICT per-session-floor-gated numbers that '
  '`state` is decided from — never derived by summing sub-threshold '
  'sessions. Multi-session and penalty aware. Mirrors src/domain/'
  'dayState.ts + src/domain/penalties.ts.';

revoke all on function public.challenge_day_states(uuid, uuid) from public, anon;
grant execute on function public.challenge_day_states(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- preview_retroactive_approval — its "would this completion the day"
-- addition (existing qualifying totals + proposed qualifying totals) must
-- use the NEW qualifying_* columns, not the now-redefined (statistics)
-- valid_session_count/total_valid_minutes — otherwise a short existing
-- extra session would wrongly help a short proposed one complete the day.
-- Re-declared here in full (forward-only; the historical migration that
-- first defined it is never edited).
-- ----------------------------------------------------------------------------
create or replace function public.preview_retroactive_approval(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid              uuid := (select auth.uid());
  v_req            public.retroactive_training_requests;
  v_ch             public.challenges;
  v_ds             record;
  v_prop_sessions  int;
  v_prop_minutes   int;
  v_total_sessions int;
  v_total_minutes  int;
  v_would_complete boolean;
  v_resulting_state text;
  v_debt_delta int;
begin
  select * into v_req from public.retroactive_training_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Efterregistreringen finns inte';
  end if;
  if not (v_req.user_id = uid or public.is_admin()) then
    raise exception 'Du får inte se den här efterregistreringen';
  end if;

  select * into v_ch from public.challenges where id = v_req.challenge_id;

  select * into v_ds
  from public.challenge_day_states(v_req.challenge_id, v_req.user_id) ds
  where ds.challenge_date = v_req.challenge_date;

  select
    (count(*) filter (where s.ok))::int,
    (coalesce(sum(s.duration_minutes) filter (where s.ok), 0))::int
  into v_prop_sessions, v_prop_minutes
  from (
    select rs.duration_minutes,
      (rs.duration_minutes >= coalesce(v_ds.min_minutes_per_session, 0)
       and (not v_ch.proof_required or rs.proof_storage_path is not null)) as ok
    from public.retroactive_training_request_sessions rs
    where rs.request_id = p_request_id
  ) s;

  v_total_sessions := coalesce(v_ds.qualifying_session_count, 0) + v_prop_sessions;
  v_total_minutes  := coalesce(v_ds.qualifying_minutes, 0) + v_prop_minutes;
  v_would_complete := v_ds.state = 'completed'
    or (v_total_sessions >= coalesce(v_ds.required_sessions, 1)
        and v_total_minutes >= coalesce(v_ds.required_minutes, v_ch.required_minutes));

  v_resulting_state := case
    when v_ds.state = 'completed' then 'completed'
    when v_would_complete then 'completed'
    else v_ds.state
  end;

  v_debt_delta := case
    when v_ds.state = 'missed' and v_would_complete then -v_ch.missed_day_cost
    else 0
  end;

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', v_req.status,
    'user_id', v_req.user_id,
    'challenge_date', v_req.challenge_date,
    'submitted_at', v_req.submitted_at,
    'participant_reason', v_req.participant_reason,
    'review_note', v_req.review_note,
    'reviewed_at', v_req.reviewed_at,
    'reviewed_by', v_req.reviewed_by,
    'proof_required', v_ch.proof_required,
    'current_state', v_ds.state,
    'required_minutes', v_ds.required_minutes,
    'required_sessions', v_ds.required_sessions,
    'min_minutes_per_session', v_ds.min_minutes_per_session,
    'penalty_type', v_ds.penalty_type,
    'penalty_display_name', v_ds.penalty_display_name,
    'existing_valid_sessions', coalesce(v_ds.qualifying_session_count, 0),
    'existing_valid_minutes', coalesce(v_ds.qualifying_minutes, 0),
    'proposed_valid_sessions', v_prop_sessions,
    'proposed_valid_minutes', v_prop_minutes,
    'would_complete', v_would_complete,
    'resulting_state', v_resulting_state,
    'debt_delta_sek', v_debt_delta,
    'missed_day_cost', v_ch.missed_day_cost
  );
end;
$$;

comment on function public.preview_retroactive_approval is
  'Admin-facing "what would approving this request do" preview. Uses '
  'challenge_day_states'' qualifying_session_count/qualifying_minutes '
  '(individually-qualifying sessions only) for its completion math — never '
  'the statistics-meaning valid_session_count/total_valid_minutes.';

revoke all on function public.preview_retroactive_approval(uuid) from public, anon;
grant execute on function public.preview_retroactive_approval(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- _retroactive_request_eligibility_check — the pre-submit display fields
-- 'existing_valid_sessions'/'existing_valid_minutes' should show the SAME
-- qualifying numbers the completion decision actually uses, not statistics.
-- ----------------------------------------------------------------------------
create or replace function public._retroactive_request_eligibility_check(
  p_challenge_id   uuid,
  p_user_id        uuid,
  p_challenge_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch        public.challenges;
  v_today     date;
  v_ds        record;
  m_active    boolean;
  eff_start   date;
  eff_end     date;
  v_pending   int;
begin
  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null then
    return jsonb_build_object('ok', false, 'blocking_code', 'not_found');
  end if;
  if v_ch.status <> 'active' then
    return jsonb_build_object('ok', false, 'blocking_code', 'challenge_not_active');
  end if;

  v_today := public.challenge_current_date(p_challenge_id);

  if p_challenge_date >= v_today then
    return jsonb_build_object('ok', false, 'blocking_code', 'not_past',
      'challenge_today', v_today);
  end if;
  if p_challenge_date < v_ch.start_date then
    return jsonb_build_object('ok', false, 'blocking_code', 'before_start',
      'challenge_start_date', v_ch.start_date);
  end if;
  if p_challenge_date > v_ch.end_date then
    return jsonb_build_object('ok', false, 'blocking_code', 'after_end',
      'challenge_end_date', v_ch.end_date);
  end if;

  select m.active,
         greatest(v_ch.start_date, m.participation_start_date),
         least(v_ch.end_date, coalesce(m.participation_end_date, v_ch.end_date))
    into m_active, eff_start, eff_end
  from public.challenge_memberships m
  where m.challenge_id = p_challenge_id and m.user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'blocking_code', 'no_membership');
  end if;
  if p_challenge_date < eff_start or p_challenge_date > eff_end then
    return jsonb_build_object('ok', false, 'blocking_code', 'outside_membership',
      'participation_start', eff_start, 'participation_end', eff_end);
  end if;

  select * into v_ds
  from public.challenge_day_states(p_challenge_id, p_user_id) ds
  where ds.challenge_date = p_challenge_date;

  if v_ds.state = 'completed' then
    return jsonb_build_object('ok', false, 'blocking_code', 'already_completed');
  end if;

  select count(*) into v_pending
  from public.retroactive_training_requests
  where challenge_id = p_challenge_id and user_id = p_user_id
    and challenge_date = p_challenge_date and status = 'pending';
  if v_pending > 0 then
    return jsonb_build_object('ok', false, 'blocking_code', 'pending_exists');
  end if;

  return jsonb_build_object(
    'ok', true,
    'challenge_date', p_challenge_date,
    'day_state', v_ds.state,
    'proof_required', v_ch.proof_required,
    'required_minutes', v_ds.required_minutes,
    'required_sessions', v_ds.required_sessions,
    'min_minutes_per_session', v_ds.min_minutes_per_session,
    'penalty_type', v_ds.penalty_type,
    'penalty_display_name', v_ds.penalty_display_name,
    'missed_day_cost', v_ch.missed_day_cost,
    'existing_valid_sessions', v_ds.qualifying_session_count,
    'existing_valid_minutes', v_ds.qualifying_minutes
  );
end;
$$;

revoke all on function public._retroactive_request_eligibility_check(uuid, uuid, date)
  from public, anon;

comment on function public._retroactive_request_eligibility_check is
  'Pre-submit eligibility + display payload for a retroactive registration. '
  'existing_valid_sessions/existing_valid_minutes report the qualifying '
  '(completion-gated) numbers, matching preview_retroactive_approval.';
