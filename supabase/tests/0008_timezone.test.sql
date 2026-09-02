-- ============================================================================
-- pgTAP — Phase 9: every date-sensitive operation uses the CHALLENGE-LOCAL
-- date, not the server session date / UTC.
--
-- Deterministic where practical: `now()` is real time, so we compare two
-- challenges at the same instant in far-apart zones (Pacific/Kiritimati UTC+14
-- vs Etc/GMT+12 UTC-12 — 26 h apart, so their local dates ALWAYS differ).
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(9);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000008ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't8ad@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000080a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't80a@example.test', '{"display_name":"Kim"}', now(), now()),
  ('00000000-0000-0000-0000-00000000080b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't80b@example.test', '{"display_name":"Robin"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000008ad';

-- Same wide range, different timezone.
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-00000000c8ea', 'Kiritimati (UTC+14)',
   current_date - 60, current_date + 60, 'Pacific/Kiritimati', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000008ad'),
  ('00000000-0000-0000-0000-00000000c8eb', 'GMT-12',
   current_date - 60, current_date + 60, 'Etc/GMT+12', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000008ad');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-00000000c8ea', '00000000-0000-0000-0000-00000000080a', current_date - 60, true, '00000000-0000-0000-0000-0000000008ad'),
  ('00000000-0000-0000-0000-00000000c8ea', '00000000-0000-0000-0000-00000000080b', current_date - 60, true, '00000000-0000-0000-0000-0000000008ad'),
  ('00000000-0000-0000-0000-00000000c8eb', '00000000-0000-0000-0000-00000000080a', current_date - 60, true, '00000000-0000-0000-0000-0000000008ad');

-- 1. challenge_current_date reads the CHALLENGE's timezone, not the session.
select is(
  public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea'),
  (now() at time zone 'Pacific/Kiritimati')::date,
  'challenge_current_date uses the challenge timezone');

-- 2. Two challenges, same instant, 26 h apart -> local dates differ by >= 1.
select cmp_ok(
  public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea')
    - public.challenge_current_date('00000000-0000-0000-0000-00000000c8eb'),
  '>=', 1,
  'a UTC+14 challenge is always at least a day ahead of a UTC-12 one');
select cmp_ok(
  public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea')
    - public.challenge_current_date('00000000-0000-0000-0000-00000000c8eb'),
  '<=', 2,
  '... and at most two days ahead');

-- 3. challenge_day_states pending/future boundary is challenge-local.
create or replace function pg_temp.kir_state(p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-00000000c8ea')
  where user_id = '00000000-0000-0000-0000-00000000080a' and challenge_date = p_date
$$;

select is(
  pg_temp.kir_state(public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea')),
  'pending', 'the challenge-local today is pending (no entry)');
select is(
  pg_temp.kir_state(public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea') + 1),
  'future', 'the challenge-local tomorrow is future');
select is(
  pg_temp.kir_state(public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea') - 1),
  'missed', 'the challenge-local yesterday (no entry) is missed');

-- 4. _next_penalty_target_date / assign_penalty land strictly after the
--    CHALLENGE-local today, using the challenge timezone.
insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values ('00000000-0000-0000-0000-00000000c8ea', 20, 'minimum_minutes', 45, '45-minutaren', 1);
insert into public.earned_penalties (id, challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '0000000e-0000-4000-8000-0000000008ea', '00000000-0000-0000-0000-00000000c8ea',
  '00000000-0000-0000-0000-00000000080a', id, current_date - 30, 'minimum_minutes', 45, '45-minutaren',
  current_date - 30, 'available'
from public.challenge_penalty_definitions where challenge_id = '00000000-0000-0000-0000-00000000c8ea';

select is(
  public._next_penalty_target_date('00000000-0000-0000-0000-00000000c8ea',
    '00000000-0000-0000-0000-00000000080b'),
  public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea') + 1,
  'the next target day is challenge-local today + 1');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000080a","role":"authenticated"}', true);
select cmp_ok(
  (public.assign_penalty('0000000e-0000-4000-8000-0000000008ea',
     '00000000-0000-0000-0000-00000000080b') ->> 'target_date')::date,
  '>', public.challenge_current_date('00000000-0000-0000-0000-00000000c8ea'),
  'assign_penalty never lands on or before the challenge-local today');

select * from finish();
rollback;
