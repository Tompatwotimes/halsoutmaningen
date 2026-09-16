-- ============================================================================
-- Hälsoutmaningen — v1.11.0 double-pass gold star (Overview prestige marker)
--
-- Depends on 20260915090000_multi_session_completion_fix.sql. Forward-only,
-- non-destructive — no historical migration is edited.
--
-- Adds ONE new boolean column to challenge_day_states: `double_pass_achieved`.
-- Purely a derived presentation fact — CLAUDE.md/PRODUCT: zero gameplay
-- effect. It never feeds `state`, `challenge_results`, streaks, liability,
-- Straffbanken or ranking; it is read by the Overview matrix only.
--
-- CANONICAL DEFINITION (mirrors src/domain/penalties.ts::isDoublePassDay
-- exactly): at least TWO DISTINCT sessions that are each active, proofed if
-- the challenge requires proof, and independently reach the challenge's
-- BASE `required_minutes` — deliberately NEVER the day's (possibly
-- penalty-raised) `min_minutes_per_session`. A single 60-minute session is
-- not a double pass; a 45-minute penalty day completed by one 45-minute
-- session gets no star, but 45 + 30 does (the 30 alone clears the 30-minute
-- base, independent of whether it would satisfy the 45-minute penalty).
-- ============================================================================

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
  double_pass_achieved     boolean,
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
      coalesce(s.logged, 0)              as session_count,
      coalesce(s.stats_sessions, 0)      as valid_session_count,
      coalesce(s.stats_minutes, 0)       as total_valid_minutes,
      coalesce(s.qualifying_sessions, 0) as qualifying_session_count,
      coalesce(s.qualifying_minutes, 0)  as qualifying_minutes,
      coalesce(s.base_qualifying_sessions, 0) >= 2 as double_pass_achieved
    from withreq w
    left join lateral (
      select
        count(*)                                                             as logged,
        count(*) filter (where x.stats_ok)                                   as stats_sessions,
        coalesce(sum(x.duration_minutes) filter (where x.stats_ok), 0)       as stats_minutes,
        count(*) filter (where x.stats_ok and x.qualifies)                   as qualifying_sessions,
        coalesce(sum(x.duration_minutes) filter (where x.stats_ok and x.qualifies), 0) as qualifying_minutes,
        -- Double-pass uses the challenge's BASE minutes, never the
        -- (possibly penalty-raised) per-session floor `w.min_minutes_per_session`.
        count(*) filter (where x.stats_ok and x.base_qualifies)              as base_qualifying_sessions
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
          te.duration_minutes >= w.min_minutes_per_session as qualifies,
          te.duration_minutes >= (select required_minutes from c) as base_qualifies
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
    a.double_pass_achieved,
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
  'proofed-if-required session, any duration). qualifying_session_count/'
  'qualifying_minutes are the STRICT per-session-floor-gated numbers that '
  '`state` is decided from. double_pass_achieved is a PURE PRESENTATION '
  'fact (zero gameplay effect) — at least 2 distinct sessions each '
  'independently reaching the challenge''s BASE required_minutes, always '
  'independent of any active penalty. Multi-session and penalty aware. '
  'Mirrors src/domain/dayState.ts + src/domain/penalties.ts.';

revoke all on function public.challenge_day_states(uuid, uuid) from public, anon;
grant execute on function public.challenge_day_states(uuid, uuid) to authenticated;
