-- ============================================================================
-- pgTAP — Phase 9: multiple sessions per day + penalty-aware daily requirement.
--
-- Covers migrations 0005 (session_seq) and 0008 (challenge_daily_requirement /
-- rewritten challenge_day_states). Runs in a transaction and rolls back.
-- See supabase/tests/0001_*.sql for how to execute.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(16);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anna9@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin9@example.test', '{"display_name":"Admin"}', now(), now());

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009d1';

-- Challenge with room for history: started 90 days ago, ends in 120.
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-00000000c901', 'Fas9-test',
  current_date - 90, current_date + 120, 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-0000000009d1');

insert into public.challenge_memberships (challenge_id, user_id,
  participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a1',
  current_date - 90, true, '00000000-0000-0000-0000-0000000009d1');

-- 45-minutaren + Dubbelpass definitions.
insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values
  ('00000000-0000-0000-0000-00000000c901', 20, 'minimum_minutes', 45, '45-minutaren', 1),
  ('00000000-0000-0000-0000-00000000c901', 60, 'double_session',   2, 'Dubbelpass',   3);

create or replace function pg_temp.st(p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-00000000c901')
  where user_id = '00000000-0000-0000-0000-0000000009a1' and challenge_date = p_date
$$;

create or replace function pg_temp.mk(p_date date, p_seq smallint, p_min int, p_proof boolean)
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
  values (v_id, '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a1',
          p_date, p_seq, p_min);
  if p_proof then
    insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
    values (v_id, '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009a1',
            format('00000000-0000-0000-0000-00000000c901/00000000-0000-0000-0000-0000000009a1/%s/%s.jpg', p_date, v_id),
            'image/jpeg', 1000);
  end if;
end;
$$;

-- ---- NORMAL DAY -------------------------------------------------------------
select pg_temp.mk((current_date - 80)::date, 1::smallint, 35, true);
select is(pg_temp.st((current_date - 80)::date), 'completed', 'one 35-min session + proof -> completed');

-- Two short sessions that sum to the base.
select pg_temp.mk((current_date - 79)::date, 1::smallint, 20, true);
select pg_temp.mk((current_date - 79)::date, 2::smallint, 15, true);
select is(pg_temp.st((current_date - 79)::date), 'completed', '20 + 15 min (both proven) -> completed');

-- One of the two sessions has no proof: it does not contribute.
select pg_temp.mk((current_date - 78)::date, 1::smallint, 20, true);
select pg_temp.mk((current_date - 78)::date, 2::smallint, 20, false);
select is(pg_temp.st((current_date - 78)::date), 'missed', 'unproven session does not contribute -> missed');

select is(
  (select session_count from public.challenge_day_states('00000000-0000-0000-0000-00000000c901')
   where user_id = '00000000-0000-0000-0000-0000000009a1' and challenge_date = (current_date - 78)::date),
  2, 'session_count reflects every logged session');
select is(
  (select valid_session_count from public.challenge_day_states('00000000-0000-0000-0000-00000000c901')
   where user_id = '00000000-0000-0000-0000-0000000009a1' and challenge_date = (current_date - 78)::date),
  1, 'valid_session_count counts only contributing sessions');

-- Invalidated session never contributes.
select pg_temp.mk((current_date - 77)::date, 1::smallint, 40, true);
update public.training_entries set status = 'invalidated', invalidated_at = now(),
  invalidated_by = '00000000-0000-0000-0000-0000000009d1', invalidated_reason = 'test'
where challenge_id = '00000000-0000-0000-0000-00000000c901'
  and challenge_date = (current_date - 77)::date;
select is(pg_temp.st((current_date - 77)::date), 'missed', 'invalidated session does not count -> missed');

-- ---- add_training_session (as the participant) ----------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);

select lives_ok(
  $$select public.add_training_session('00000000-0000-0000-0000-00000000c901', 30, 'Löpning', null)$$,
  'participant can append a session for today');
select lives_ok(
  $$select public.add_training_session('00000000-0000-0000-0000-00000000c901', 25, 'Simning', null)$$,
  'participant can append a second session for today');
select is(
  (select count(*)::int from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-00000000c901'
     and user_id = '00000000-0000-0000-0000-0000000009a1'
     and challenge_date = public.challenge_current_date('00000000-0000-0000-0000-00000000c901')),
  2, 'two distinct session rows exist for today');
select is(
  (select max(session_seq)::int from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-00000000c901'
     and user_id = '00000000-0000-0000-0000-0000000009a1'
     and challenge_date = public.challenge_current_date('00000000-0000-0000-0000-00000000c901')),
  2, 'session_seq auto-increments');

-- ---- PENALTY REQUIREMENT --------------------------------------------------
set local role postgres;

-- Put a 45-minutaren penalty on a past day (direct insert as the trusted backend).
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009d1',
  id, current_date - 50, 'minimum_minutes', 45, '45-minutaren', current_date - 50, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c901' and unlock_streak = 20;

-- Admin has no membership, add one so they can be a target.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009d1',
  current_date - 90, true, '00000000-0000-0000-0000-0000000009d1');

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c901', ep.id,
  '00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a1',
  current_date - 40, 'minimum_minutes', 45, '45-minutaren', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c901' limit 1;

-- 35 valid minutes on the penalised day -> still MISSED (needs 45).
select pg_temp.mk((current_date - 40)::date, 1::smallint, 35, true);
select is(pg_temp.st((current_date - 40)::date), 'missed', '45-min penalty: 35 valid minutes -> missed');

select is(
  (select required_minutes from public.challenge_day_states('00000000-0000-0000-0000-00000000c901')
   where user_id = '00000000-0000-0000-0000-0000000009a1' and challenge_date = (current_date - 40)::date),
  45, 'challenge_day_states reports the effective (penalty) requirement');

-- Add a second session; 35 + 15 = 50 >= 45 -> completed.
select pg_temp.mk((current_date - 40)::date, 2::smallint, 15, true);
select is(pg_temp.st((current_date - 40)::date), 'completed', '45-min penalty: 35 + 15 valid minutes -> completed');

-- ---- DOUBLE SESSION ------------------------------------------------------
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-0000000009d1',
  id, current_date - 30, 'double_session', 2, 'Dubbelpass', current_date - 30, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c901' and unlock_streak = 60;

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c901', ep.id,
  '00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a1',
  current_date - 25, 'double_session', 2, 'Dubbelpass', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c901'
  and ep.penalty_type = 'double_session' limit 1;

-- One 70-minute session: NOT enough for Dubbelpass.
select pg_temp.mk((current_date - 25)::date, 1::smallint, 70, true);
select is(pg_temp.st((current_date - 25)::date), 'missed', 'Dubbelpass: one long session -> missed');

-- Add a second base-length proven session -> completed.
select pg_temp.mk((current_date - 25)::date, 2::smallint, 30, true);
select is(pg_temp.st((current_date - 25)::date), 'completed', 'Dubbelpass: two proven base sessions -> completed');

select * from finish();
rollback;
