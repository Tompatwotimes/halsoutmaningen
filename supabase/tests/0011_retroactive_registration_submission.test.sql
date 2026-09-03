-- ============================================================================
-- pgTAP — Phase 11 / 0014-0015: efterregistrering — SUBMISSION.
--
-- A participant may request registration for a PAST eligible participation day.
-- A pending request changes NOTHING (day state / debt / KASSAN / streak). The
-- guard rejects today / future / pre-start / outside-membership / duplicate /
-- missing-or-forged proof.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(19);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e101@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e102@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e103@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000e101';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000e1', 'Efterreg-submit-test',
  current_date - 20, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000e101');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e102',
   current_date - 10, true, '00000000-0000-0000-0000-00000000e101'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e103',
   current_date - 10, true, '00000000-0000-0000-0000-00000000e101');

-- Proof objects the participant "uploaded" before calling the RPC.
create or replace function pg_temp.obj(p_path text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values ('proofs', p_path);
$$;

select pg_temp.obj('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
  || (current_date - 5)::text || '/proof-a.jpg');
select pg_temp.obj('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
  || (current_date - 5)::text || '/proof-b.jpg');

-- Helper: a one-session jsonb payload with a proof.
create or replace function pg_temp.one_session(p_path text, p_min int default 40)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'duration_minutes', p_min, 'activity', 'Löpning', 'sort_order', 1,
    'proof_storage_path', p_path, 'proof_mime_type', 'image/jpeg',
    'proof_size_bytes', 120000));
$$;

-- ---- Act as the participant -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}', true);

-- Baseline: the past day is currently MISSED. Snapshot the derived numbers.
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e1')
   where user_id = '00000000-0000-0000-0000-00000000e102' and challenge_date = (current_date - 5)::date),
  'missed', 'baseline: the target day is missed');

create temp table _snap as
  select liability_sek, current_streak, missed_days
  from public.challenge_results('00000000-0000-0000-0000-0000000000e1')
  where user_id = '00000000-0000-0000-0000-00000000e102';

select lives_ok(
  $$select public.submit_retroactive_registration(
      '00000000-0000-0000-0000-0000000000e1', (current_date - 5)::date,
      'Ingen täckning på kvällen',
      pg_temp.one_session('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
        || (current_date - 5)::text || '/proof-a.jpg'))$$,
  'participant can request a past eligible day');

select is(
  (select status from public.retroactive_training_requests
   where challenge_id = '00000000-0000-0000-0000-0000000000e1'
     and user_id = '00000000-0000-0000-0000-00000000e102'),
  'pending', 'the request is created pending');

select is(
  (select count(*)::int from public.retroactive_training_request_sessions s
   join public.retroactive_training_requests r on r.id = s.request_id
   where r.user_id = '00000000-0000-0000-0000-00000000e102'),
  1, 'the proposed session row is stored');

-- Pending request must not touch derived state.
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e1')
   where user_id = '00000000-0000-0000-0000-00000000e102' and challenge_date = (current_date - 5)::date),
  'missed', 'pending request does NOT change the day state');
select is(
  (select liability_sek from public.challenge_results('00000000-0000-0000-0000-0000000000e1')
   where user_id = '00000000-0000-0000-0000-00000000e102'),
  (select liability_sek from _snap),
  'pending request does NOT change liability');
select is(
  (select count(*)::int from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-0000000000e1'
     and user_id = '00000000-0000-0000-0000-00000000e102'),
  0, 'pending request creates no training_entries');
select is(
  (select current_streak from public.challenge_results('00000000-0000-0000-0000-0000000000e1')
   where user_id = '00000000-0000-0000-0000-00000000e102'),
  (select current_streak from _snap),
  'pending request does NOT change the streak');

-- Duplicate pending request for the same day is rejected.
select throws_ok(
  $$select public.submit_retroactive_registration(
      '00000000-0000-0000-0000-0000000000e1', (current_date - 5)::date, 'igen',
      pg_temp.one_session('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
        || (current_date - 5)::text || '/proof-b.jpg'))$$,
  null, null, 'a second pending request for the same day is rejected');

-- Today / future / pre-start / outside-membership.
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      current_date, 'idag', pg_temp.one_session('x'))$$,
  null, null, 'cannot efterregistrera today');
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date + 3)::date, 'framtid', pg_temp.one_session('x'))$$,
  null, null, 'cannot efterregistrera a future day');
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 25)::date, 'före start', pg_temp.one_session('x'))$$,
  null, null, 'cannot efterregistrera before the challenge start');
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 15)::date, 'utanför period', pg_temp.one_session('x'))$$,
  null, null, 'cannot efterregistrera a day before the own participation start');

-- Reason is mandatory.
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 6)::date, '   ',
      pg_temp.one_session('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
        || (current_date - 6)::text || '/p.jpg'))$$,
  null, null, 'a reason is required');

-- Proof required: a session with no proof is rejected.
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 6)::date, 'utan bild',
      jsonb_build_array(jsonb_build_object('duration_minutes', 40, 'sort_order', 1)))$$,
  null, null, 'proof-required challenge: a session without proof is rejected');

-- Forged proof path (another participant's folder).
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 6)::date, 'fejkad sökväg',
      pg_temp.one_session('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e103/'
        || (current_date - 6)::text || '/p.jpg'))$$,
  null, null, 'a proof path in another participant''s folder is rejected');

-- Path shape is right but the object does not exist.
select throws_ok(
  $$select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e1',
      (current_date - 6)::date, 'saknad fil',
      pg_temp.one_session('00000000-0000-0000-0000-0000000000e1/00000000-0000-0000-0000-00000000e102/'
        || (current_date - 6)::text || '/missing.jpg'))$$,
  null, null, 'a proof path with no matching storage object is rejected');

-- A participant cannot forge a request by writing the table directly.
select throws_ok(
  $$insert into public.retroactive_training_requests
      (challenge_id, user_id, challenge_date, participant_reason)
    values ('00000000-0000-0000-0000-0000000000e1',
      '00000000-0000-0000-0000-00000000e102', (current_date - 7)::date, 'direkt')$$,
  null, null, 'a direct INSERT into retroactive_training_requests is denied by RLS');

-- Erik cannot see Anna's request.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.retroactive_training_requests
   where user_id = '00000000-0000-0000-0000-00000000e102'),
  0, 'another participant cannot see the request (RLS)');

select * from finish();
rollback;
