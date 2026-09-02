-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0008  centralized daily requirement + day states
--
-- Depends on 0001–0002, 0007 (penalty_assignments / challenge_penalty_definitions).
-- Forward-only. Rewrites challenge_day_states (DROP + CREATE — the return shape
-- changes).
--
-- ONE authoritative answer to "what does this challenge day require":
--   challenge_daily_requirement(base, penalty_type, penalty_value)
--     -> (required_total_minutes, required_sessions, min_minutes_per_session)
--
-- Mirrors src/domain/penalties.ts::computeDailyRequirement exactly:
--   normal            total >= base,           sessions >= 1
--   minimum_minutes V total >= max(base, V),   sessions >= 1
--   double_session  N total >= base*N,         sessions >= N, each >= base
--
-- A session "contributes" when it is active, meets min_minutes_per_session and
-- (when the challenge requires proof) carries its own proof. A day is completed
-- when contributing sessions >= required_sessions AND their minutes sum to
-- >= required_total_minutes.
-- ============================================================================

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
      when 'double_session'  then p_base_minutes
      else 0
    end)::integer;
$$;

revoke all on function public.challenge_daily_requirement(integer, text, integer)
  from public, anon;
grant execute on function public.challenge_daily_requirement(integer, text, integer)
  to authenticated;

comment on function public.challenge_daily_requirement is
  'The one penalty-aware daily requirement. Mirror of '
  'src/domain/penalties.ts::computeDailyRequirement.';

-- ----------------------------------------------------------------------------
-- challenge_day_states — canonical (user, date, state, …) for a whole challenge
-- (or one member). Multi-session aware, penalty aware. SECURITY INVOKER so RLS
-- filters a non-member to an empty result.
-- ----------------------------------------------------------------------------
drop function if exists public.challenge_day_states(uuid);

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
      coalesce(s.logged, 0)        as session_count,
      coalesce(s.contributing, 0)  as valid_session_count,
      coalesce(s.valid_minutes, 0) as total_valid_minutes
    from withreq w
    left join lateral (
      select
        count(*)                              as logged,
        count(*) filter (where x.ok)          as contributing,
        coalesce(sum(x.duration_minutes) filter (where x.ok), 0) as valid_minutes
      from (
        select
          te.duration_minutes,
          (
            te.status = 'active'
            and te.duration_minutes >= w.min_minutes_per_session
            and (
              not (select proof_required from c)
              or exists (
                select 1 from public.training_proofs tp
                where tp.training_entry_id = te.id
              )
            )
          ) as ok
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
      when a.valid_session_count >= a.required_sessions
       and a.total_valid_minutes >= a.required_total_minutes
        then 'completed'
      when a.challenge_date > (select today from cur) then 'future'
      when a.challenge_date = (select today from cur) then 'pending'
      else 'missed'
    end as state,
    a.session_count,
    a.valid_session_count,
    a.total_valid_minutes,
    a.required_total_minutes as required_minutes,
    a.required_sessions,
    a.min_minutes_per_session,
    a.penalty_type,
    a.penalty_display_name,
    a.penalty_from_user_id
  from agg a;
$$;

comment on function public.challenge_day_states is
  'One row per (participant, challenge day): canonical state plus the effective '
  'penalty-aware requirement and the day''s valid totals. Multi-session and '
  'penalty aware. Mirrors src/domain/dayState.ts + src/domain/penalties.ts.';

revoke all on function public.challenge_day_states(uuid, uuid) from public, anon;
grant execute on function public.challenge_day_states(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Streak runs + the set of milestones a participant has legitimately earned.
-- Internal helpers for the reconciler — not granted to authenticated.
-- ----------------------------------------------------------------------------
create or replace function public.challenge_streak_runs(
  p_challenge_id uuid,
  p_user_id      uuid
)
returns table (run_start date, run_len integer, run_days date[])
language sql
stable
security definer
set search_path = ''
as $$
  with ds as (
    select challenge_date, (state = 'completed') as completed
    from public.challenge_day_states(p_challenge_id, p_user_id)
    where state in ('completed', 'missed')
      and challenge_date <= public.challenge_current_date(p_challenge_id)
  ),
  marked as (
    select challenge_date, completed,
      sum(case when not completed then 1 else 0 end)
        over (order by challenge_date rows between unbounded preceding and current row) as grp
    from ds
  )
  select
    min(challenge_date) filter (where completed)                       as run_start,
    (count(*) filter (where completed))::integer                       as run_len,
    array_agg(challenge_date order by challenge_date) filter (where completed) as run_days
  from marked
  group by grp
  having count(*) filter (where completed) > 0;
$$;

create or replace function public.challenge_valid_earned_penalties(
  p_challenge_id uuid,
  p_user_id      uuid
)
returns table (definition_id uuid, streak_run_start date, earned_on_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    r.run_start,
    r.run_days[d.unlock_streak]
  from public.challenge_streak_runs(p_challenge_id, p_user_id) r
  join public.challenge_penalty_definitions d
    on d.challenge_id = p_challenge_id
   and d.active
   and d.unlock_streak <= r.run_len;
$$;

revoke all on function public.challenge_streak_runs(uuid, uuid) from public, anon;
revoke all on function public.challenge_valid_earned_penalties(uuid, uuid) from public, anon;
