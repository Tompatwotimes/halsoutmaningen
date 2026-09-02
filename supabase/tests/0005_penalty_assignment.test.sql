-- ============================================================================
-- pgTAP — Phase 9: penalty assignment lifecycle (atomic, concurrency-safe).
--
-- Covers migration 0009: assign_penalty / preview_penalty_target /
-- cancel_penalty_assignment — ownership, self-target, target eligibility,
-- future-only, no-stacking auto-advance, atomic spend, no double-use, cancel.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(18);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a501@example.test', '{"display_name":"Sara"}', now(), now()),
  ('00000000-0000-0000-0000-00000000a502', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a502@example.test', '{"display_name":"Tomas"}', now(), now()),
  ('00000000-0000-0000-0000-00000000a5ff', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a5ff@example.test', '{"display_name":"Ove"}', now(), now()),
  ('00000000-0000-0000-0000-00000000a5ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a5ad@example.test', '{"display_name":"Admin"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000a5ad';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-000000000a50', 'Assign-test',
  current_date - 30, current_date + 60, 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-00000000a5ad');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-000000000a50', '00000000-0000-0000-0000-00000000a501', current_date - 30, true, '00000000-0000-0000-0000-00000000a5ad'),
  ('00000000-0000-0000-0000-000000000a50', '00000000-0000-0000-0000-00000000a502', current_date - 30, true, '00000000-0000-0000-0000-00000000a5ad'),
  -- Ove left yesterday: not an eligible target for any future day.
  ('00000000-0000-0000-0000-000000000a50', '00000000-0000-0000-0000-00000000a5ff', current_date - 30, current_date - 1, true, '00000000-0000-0000-0000-00000000a5ad');

insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values ('00000000-0000-0000-0000-000000000a50', 20, 'minimum_minutes', 60, '60-minutaren', 1);

-- Give Sara two available 60-minutaren penalties (different fake streak runs).
insert into public.earned_penalties (id, challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000a50',
  '00000000-0000-0000-0000-00000000a501', id, current_date - 25, 'minimum_minutes', 60, '60-minutaren', current_date - 6, 'available'
from public.challenge_penalty_definitions where challenge_id = '00000000-0000-0000-0000-000000000a50';
insert into public.earned_penalties (id, challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select '0000000e-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000a50',
  '00000000-0000-0000-0000-00000000a501', id, current_date - 24, 'minimum_minutes', 60, '60-minutaren', current_date - 5, 'available'
from public.challenge_penalty_definitions where challenge_id = '00000000-0000-0000-0000-000000000a50';

-- Act as Sara.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a501","role":"authenticated"}', true);

-- Cannot target yourself.
select throws_ok(
  $$select public.assign_penalty('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a501')$$,
  null, null, 'cannot target yourself');

-- Cannot target someone who is not an eligible active participant on a future day.
select throws_ok(
  $$select public.assign_penalty('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a5ff')$$,
  null, null, 'cannot target a member with no eligible future day left');

-- Preview: lands on tomorrow.
select is(
  (public.preview_penalty_target('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a502') ->> 'target_date')::date,
  (current_date + 1)::date,
  'preview lands on the first eligible day after today');

-- Assign #1 -> tomorrow, inventory consumed.
select is(
  (public.assign_penalty('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a502') ->> 'target_date')::date,
  (current_date + 1)::date,
  'first assignment lands on tomorrow');
select is(
  (select status from public.earned_penalties where id = '0000000e-0000-4000-8000-000000000001'),
  'spent', 'the earned penalty is now spent');

-- The same inventory row cannot be used again.
select throws_ok(
  $$select public.assign_penalty('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a502')$$,
  null, null, 'a spent penalty cannot be assigned again');

-- Assign #2 (the other inventory row) -> must NOT stack on tomorrow; auto-advances.
select is(
  (public.assign_penalty('0000000e-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000a502') ->> 'target_date')::date,
  (current_date + 2)::date,
  'second assignment auto-advances past the penalised day (no stacking)');

select is(
  (select count(*)::int from public.penalty_assignments
   where challenge_id = '00000000-0000-0000-0000-000000000a50'
     and to_user_id = '00000000-0000-0000-0000-00000000a502' and status = 'active'),
  2, 'target has exactly two active penalties, on different days');

-- The target sees who hit them.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a502","role":"authenticated"}', true);
select is(
  (select from_user_id from public.penalty_assignments
   where to_user_id = '00000000-0000-0000-0000-00000000a502' and target_date = (current_date + 1)::date),
  '00000000-0000-0000-0000-00000000a501'::uuid,
  'the target can see the sender');

-- The target's tomorrow now requires 60 minutes.
select is(
  (select required_minutes from public.challenge_day_states('00000000-0000-0000-0000-000000000a50')
   where user_id = '00000000-0000-0000-0000-00000000a502' and challenge_date = (current_date + 1)::date),
  60, 'the penalised day requires the enhanced minutes');

-- A participant cannot cancel an assignment.
select throws_ok(
  $$select public.cancel_penalty_assignment(
      (select id from public.penalty_assignments where target_date = (current_date + 1)::date), 'nej')$$,
  null, null, 'a participant cannot cancel an assignment');

-- Admin cancels with a reason.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a5ad","role":"authenticated"}', true);
select throws_ok(
  $$select public.cancel_penalty_assignment(
      (select id from public.penalty_assignments where target_date = (current_date + 1)::date and status='active'), '')$$,
  null, null, 'cancellation requires a reason');
select lives_ok(
  $$select public.cancel_penalty_assignment(
      (select id from public.penalty_assignments where target_date = (current_date + 1)::date and status='active'),
      'fel person')$$,
  'admin can cancel with a reason');
select is(
  (select required_minutes from public.challenge_day_states('00000000-0000-0000-0000-000000000a50')
   where user_id = '00000000-0000-0000-0000-00000000a502' and challenge_date = (current_date + 1)::date),
  30, 'a cancelled penalty no longer affects the day');
select ok(
  exists (select 1 from public.audit_log
          where action = 'penalty_assignment_cancelled' and note = 'fel person'),
  'the cancellation is audited with its reason');

-- The ammunition RETURNS to the sender (administrative correction, not confiscation).
select is(
  (select status from public.earned_penalties where id = '0000000e-0000-4000-8000-000000000001'),
  'available', 'a cancelled assignment returns the earned penalty to available');
select is(
  (select spent_assignment_id from public.earned_penalties where id = '0000000e-0000-4000-8000-000000000001'),
  null, 'the returned earned penalty is no longer linked to the cancelled assignment');

-- Sara can re-assign the returned ammunition.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a501","role":"authenticated"}', true);
select is(
  (public.assign_penalty('0000000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000a502') ->> 'target_date')::date,
  (current_date + 1)::date,
  'the returned ammunition can be assigned again (the cancelled day is free)');

select * from finish();
rollback;
