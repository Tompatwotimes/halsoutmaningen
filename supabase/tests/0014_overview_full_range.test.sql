-- ============================================================================
-- pgTAP — Phase 11: the shared Översikt matrix spans the FULL challenge period.
--
-- challenge_day_states already emits one row per (member × every challenge day)
-- with `not_participating` for days outside a member's window. The frontend
-- (MatrixGrid) renders every one of those columns. This locks the DB side of
-- that contract: start_date and start_date+1 are present as `not_participating`
-- when every membership begins later, and end_date is present.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(6);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f101@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f102@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f103@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000f101';

-- Challenge started 10 days ago; both members joined 8 days ago -> the first
-- two challenge days precede every membership.
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000f1', 'Full-range-test',
  current_date - 10, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000f101');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f102',
   current_date - 8, true, '00000000-0000-0000-0000-00000000f101'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000f103',
   current_date - 8, true, '00000000-0000-0000-0000-00000000f101');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000f102","role":"authenticated"}', true);

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')
   where user_id = '00000000-0000-0000-0000-00000000f102'
     and challenge_date = (current_date - 10)::date),
  'not_participating', 'the challenge start day is present as not_participating for a later joiner');

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')
   where user_id = '00000000-0000-0000-0000-00000000f102'
     and challenge_date = (current_date - 9)::date),
  'not_participating', 'the second challenge day is present as not_participating');

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')
   where user_id = '00000000-0000-0000-0000-00000000f103'
     and challenge_date = (current_date - 10)::date),
  'not_participating', 'the same holds for the second participant');

select is(
  (select min(challenge_date) from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')),
  (current_date - 10)::date, 'day states begin at challenge.start_date, not the earliest membership');

select is(
  (select max(challenge_date) from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')),
  (current_date + 20)::date, 'day states run through challenge.end_date');

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000f1')
   where user_id = '00000000-0000-0000-0000-00000000f102'
     and challenge_date = (current_date - 7)::date),
  'missed', 'a day inside the participation window still evaluates normally');

select * from finish();
rollback;
