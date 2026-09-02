-- ============================================================================
-- pgTAP — Phase 9: challenge lifecycle, rule-mutation policy, duplication,
-- completion, admin corrections.
--
-- Covers migrations 0006 + 0007 + 0010.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(16);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000006ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'l6ad@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000061a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'l6p1@example.test', '{"display_name":"Pia"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000006ad';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);

-- create_challenge (draft) via RPC.
select lives_ok(
  $$select public.create_challenge('Höst 2027', current_date + 30, current_date + 150, 45, 25, 'Europe/Stockholm', true, 'Testbeskrivning')$$,
  'admin can create a draft challenge via create_challenge()');

set local role postgres;
create or replace function pg_temp.cid()
returns uuid language sql as $$ select id from public.challenges where name = 'Höst 2027' $$;

-- Draft rules are freely editable.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
select lives_ok(
  $$update public.challenges set required_minutes = 40 where id = (select id from public.challenges where name = 'Höst 2027')$$,
  'a draft challenge''s rules are editable');

-- seed_default_penalty_definitions.
select is(
  (select count(*)::int from public.seed_default_penalty_definitions(
     (select id from public.challenges where name = 'Höst 2027'))),
  3, 'seed_default_penalty_definitions creates the three defaults');

-- Add a member, then activate.
set local role postgres;
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ((select id from public.challenges where name = 'Höst 2027'),
        '00000000-0000-0000-0000-00000000061a', current_date + 30, true,
        '00000000-0000-0000-0000-0000000006ad');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);

select lives_ok(
  $$update public.challenges set status = 'active' where name = 'Höst 2027'$$,
  'draft -> active is allowed');

-- Now the rules are locked, even for an admin.
select throws_ok(
  $$update public.challenges set required_minutes = 30 where name = 'Höst 2027'$$,
  null, null, 'required_minutes is locked once the challenge is active');
select throws_ok(
  $$update public.challenges set missed_day_cost = 10 where name = 'Höst 2027'$$,
  null, null, 'missed_day_cost is locked once the challenge is active');
select lives_ok(
  $$update public.challenges set end_date = current_date + 200 where name = 'Höst 2027'$$,
  'end_date may still be extended');
select throws_ok(
  $$update public.challenges set end_date = current_date + 40 where name = 'Höst 2027'$$,
  null, null, 'end_date may not be shortened');

-- Penalty definitions are locked once active.
select throws_ok(
  $$update public.challenge_penalty_definitions set value = 90
    where challenge_id = (select id from public.challenges where name = 'Höst 2027')$$,
  null, null, 'penalty definitions are locked once the challenge is active');

-- Invalid status transition.
select throws_ok(
  $$update public.challenges set status = 'draft' where name = 'Höst 2027'$$,
  null, null, 'active -> draft is not a valid transition');

-- Duplicate the challenge: rules + penalty defs copied, no history.
select lives_ok(
  $$select public.duplicate_challenge(
      (select id from public.challenges where name = 'Höst 2027'),
      'Höst 2028', current_date + 400, current_date + 500, false)$$,
  'duplicate_challenge creates a draft copy');
select is(
  (select required_minutes from public.challenges where name = 'Höst 2028'),
  40, 'the duplicate inherits the rule set');
select is(
  (select count(*)::int from public.challenge_penalty_definitions d
   join public.challenges c on c.id = d.challenge_id where c.name = 'Höst 2028'),
  3, 'the duplicate inherits the penalty definitions');
select is(
  (select status from public.challenges where name = 'Höst 2028'),
  'draft', 'the duplicate starts as a draft');

-- complete_challenge expires unused earned penalties.
set local role postgres;
insert into public.earned_penalties (challenge_id, user_id, penalty_definition_id, streak_run_start,
  penalty_type, value, display_name, earned_on_date, status)
select c.id, '00000000-0000-0000-0000-00000000061a', d.id, current_date + 35,
  'minimum_minutes', 45, '45-minutaren', current_date + 55, 'available'
from public.challenges c
join public.challenge_penalty_definitions d on d.challenge_id = c.id and d.unlock_streak = 20
where c.name = 'Höst 2027';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
select lives_ok(
  $$select public.complete_challenge((select id from public.challenges where name = 'Höst 2027'))$$,
  'admin can complete an active challenge');
select is(
  (select ep.status from public.earned_penalties ep
   join public.challenges c on c.id = ep.challenge_id where c.name = 'Höst 2027'),
  'expired', 'completing the challenge expired the unused earned penalty');

select * from finish();
rollback;
