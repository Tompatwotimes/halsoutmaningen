-- ============================================================================
-- pgTAP — v1.11.0 double-pass gold star: challenge_day_states.
--   double_pass_achieved
--
-- A pure presentation fact — proves it never depends on the day's
-- (possibly penalty-raised) requirement, only the challenge's BASE
-- required_minutes, and never changes `state`/completion. Runs in a
-- transaction and rolls back. See supabase/tests/0001_*.sql for how to
-- execute.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(16);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000034a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anna34@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-0000000034d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin34@example.test', '{"display_name":"Admin"}', now(), now());

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000034d1';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-00000000c934', 'Star-test',
  current_date - 90, current_date + 90, 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-0000000034d1');

insert into public.challenge_memberships (challenge_id, user_id,
  participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034a1',
  current_date - 90, true, '00000000-0000-0000-0000-0000000034d1');

insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values
  ('00000000-0000-0000-0000-00000000c934', 20, 'minimum_minutes', 45, '45-minutaren', 1),
  ('00000000-0000-0000-0000-00000000c934', 30, 'minimum_minutes', 60, '60-minutaren', 2),
  ('00000000-0000-0000-0000-00000000c934', 60, 'double_session',   2, 'Dubbelpass',   3);

create or replace function pg_temp.star(p_date date)
returns boolean language sql as $$
  select double_pass_achieved from public.challenge_day_states('00000000-0000-0000-0000-00000000c934')
  where user_id = '00000000-0000-0000-0000-0000000034a1' and challenge_date = p_date
$$;

create or replace function pg_temp.st(p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-00000000c934')
  where user_id = '00000000-0000-0000-0000-0000000034a1' and challenge_date = p_date
$$;

create or replace function pg_temp.mk(p_date date, p_seq smallint, p_min int, p_proof boolean, p_status text default 'active')
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes,
    status, invalidated_at, invalidated_by, invalidated_reason)
  values (v_id, '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034a1',
          p_date, p_seq, p_min, p_status,
          case when p_status = 'invalidated' then now() end,
          case when p_status = 'invalidated' then '00000000-0000-0000-0000-0000000034d1'::uuid end,
          case when p_status = 'invalidated' then 'test' end);
  if p_proof then
    insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
    values (v_id, '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034a1',
            format('00000000-0000-0000-0000-00000000c934/00000000-0000-0000-0000-0000000034a1/%s/%s.jpg', p_date, v_id),
            'image/jpeg', 1000);
  end if;
end;
$$;

-- ---- NORMAL DAY --------------------------------------------------------
-- 30 alone: not a double pass.
select pg_temp.mk((current_date - 80)::date, 1::smallint, 30, true);
select is(pg_temp.star((current_date - 80)::date), false, '30 alone -> no star');

-- 60 as ONE session: not a double pass.
select pg_temp.mk((current_date - 79)::date, 1::smallint, 60, true);
select is(pg_temp.star((current_date - 79)::date), false, '60 as one session -> no star');

-- 30 + 30: double pass, and the day completes too.
select pg_temp.mk((current_date - 78)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 78)::date, 2::smallint, 30, true);
select is(pg_temp.star((current_date - 78)::date), true, '30 + 30 -> star');
select is(pg_temp.st((current_date - 78)::date), 'completed', '30 + 30 -> also completed (unrelated fact, sanity check)');

-- 30 + 20: the 20 never reaches the base -> no star.
select pg_temp.mk((current_date - 77)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 77)::date, 2::smallint, 20, true);
select is(pg_temp.star((current_date - 77)::date), false, '30 + 20 -> no star');

-- 30 + 30 + 10: still exactly a star (boolean), extra short session harmless.
select pg_temp.mk((current_date - 76)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 76)::date, 2::smallint, 30, true);
select pg_temp.mk((current_date - 76)::date, 3::smallint, 10, true);
select is(pg_temp.star((current_date - 76)::date), true, '30 + 30 + 10 -> star (the 10 is irrelevant)');

-- An invalidated session never counts: 30 active + 30 invalidated -> no star.
select pg_temp.mk((current_date - 75)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 75)::date, 2::smallint, 30, true, 'invalidated');
select is(pg_temp.star((current_date - 75)::date), false, '30 active + 30 invalidated -> no star');

-- Proof required: 30 proofed + 30 unproofed -> no star.
select pg_temp.mk((current_date - 74)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 74)::date, 2::smallint, 30, false);
select is(pg_temp.star((current_date - 74)::date), false, '30 proofed + 30 unproofed -> no star');

-- ---- PENALTY INDEPENDENCE ------------------------------------------------
-- 45-minutaren, 45 only -> no star (only one base-qualifying session).
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034d1',
  id, current_date - 50, 'minimum_minutes', 45, '45-minutaren', current_date - 50, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c934' and unlock_streak = 20;

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034d1',
  current_date - 90, true, '00000000-0000-0000-0000-0000000034d1');

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c934', ep.id,
  '00000000-0000-0000-0000-0000000034d1', '00000000-0000-0000-0000-0000000034a1',
  current_date - 40, 'minimum_minutes', 45, '45-minutaren', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c934' and ep.value = 45 limit 1;

select pg_temp.mk((current_date - 40)::date, 1::smallint, 45, true);
select is(pg_temp.star((current_date - 40)::date), false,
  '45-min penalty: 45 alone -> no star (satisfies the penalty, but is only one base-qualifying session)');

-- Add a 30-minute second session: satisfies the base independently -> star,
-- even though 30 alone would never satisfy the 45-minute penalty.
select pg_temp.mk((current_date - 40)::date, 2::smallint, 30, true);
select is(pg_temp.star((current_date - 40)::date), true,
  '45-min penalty: 45 + 30 -> star (the 30 clears the BASE on its own)');
select is(pg_temp.st((current_date - 40)::date), 'completed',
  '45-min penalty: day is completed by the 45-minute session alone');

-- 60-minutaren, 60 only -> no star.
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034d1',
  id, current_date - 35, 'minimum_minutes', 60, '60-minutaren', current_date - 35, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c934' and unlock_streak = 30;

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c934', ep.id,
  '00000000-0000-0000-0000-0000000034d1', '00000000-0000-0000-0000-0000000034a1',
  current_date - 33, 'minimum_minutes', 60, '60-minutaren', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c934' and ep.value = 60 limit 1;

select pg_temp.mk((current_date - 33)::date, 1::smallint, 60, true);
select is(pg_temp.star((current_date - 33)::date), false, '60-min penalty: 60 alone -> no star');

select pg_temp.mk((current_date - 33)::date, 2::smallint, 30, true);
select is(pg_temp.star((current_date - 33)::date), true, '60-min penalty: 60 + 30 -> star');

-- double_session penalty, 30 + 30 -> star. 60 single -> no star. 30+30+10 -> star.
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034d1',
  id, current_date - 25, 'double_session', 2, 'Dubbelpass', current_date - 25, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c934' and unlock_streak = 60;

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c934', ep.id,
  '00000000-0000-0000-0000-0000000034d1', '00000000-0000-0000-0000-0000000034a1',
  current_date - 20, 'double_session', 2, 'Dubbelpass', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c934'
  and ep.penalty_type = 'double_session' limit 1;

select pg_temp.mk((current_date - 20)::date, 1::smallint, 30, true);
select pg_temp.mk((current_date - 20)::date, 2::smallint, 30, true);
select is(pg_temp.star((current_date - 20)::date), true, 'double_session penalty: 30 + 30 -> star');
select is(pg_temp.st((current_date - 20)::date), 'completed', 'double_session penalty: also completed');

-- A second, separate earned Dubbelpass — an assignment needs its own
-- earned_penalty_id (one active assignment per earned penalty).
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-0000000034d1',
  id, current_date - 65, 'double_session', 2, 'Dubbelpass', current_date - 65, 'available'
from public.challenge_penalty_definitions
where challenge_id = '00000000-0000-0000-0000-00000000c934' and unlock_streak = 60;

insert into public.penalty_assignments (challenge_id, earned_penalty_id, from_user_id, to_user_id,
  target_date, penalty_type, value, display_name, status)
select '00000000-0000-0000-0000-00000000c934', ep.id,
  '00000000-0000-0000-0000-0000000034d1', '00000000-0000-0000-0000-0000000034a1',
  current_date - 15, 'double_session', 2, 'Dubbelpass', 'active'
from public.earned_penalties ep
where ep.challenge_id = '00000000-0000-0000-0000-00000000c934'
  and ep.penalty_type = 'double_session'
  and ep.earned_on_date = current_date - 65
limit 1;

select pg_temp.mk((current_date - 15)::date, 1::smallint, 60, true);
select is(pg_temp.star((current_date - 15)::date), false, 'double_session penalty: 60 as one session -> no star');

select * from finish();
rollback;
