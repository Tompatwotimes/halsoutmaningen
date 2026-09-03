-- ============================================================================
-- pgTAP — Phase 11 / 0015: efterregistrering — APPROVAL.
--
-- Approval is admin-only, transactional and exactly-once. It materialises real
-- training_entries + training_proofs with the ORIGINAL historical
-- challenge_date; the existing daily-requirement engine then decides the day,
-- and the reconcile triggers + derived views recompute streak / debt / KASSAN /
-- Straffbanken. No bespoke completion logic.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(23);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e201@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e202@example.test', '{"display_name":"Anna"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000e201';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000e2', 'Efterreg-approve-test',
  current_date - 30, current_date + 30, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000e201');

-- Milestone at a low streak so the retroactive-earn path is testable.
insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values ('00000000-0000-0000-0000-0000000000e2', 3, 'minimum_minutes', 45, 'Trippel', 1);

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e202',
  current_date - 30, true, '00000000-0000-0000-0000-00000000e201');

-- Anna completes -6, -5, [-4 gap], -3, -2. Filling -4 makes a run of 5.
create or replace function pg_temp.done(p_date date, p_seq smallint default 1, p_min int default 35)
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
  values (v_id, '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e202', p_date, p_seq, p_min);
  insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
  values (v_id, '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e202',
    format('00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/%s/%s.jpg', p_date, v_id),
    'image/jpeg', 1000);
end;
$$;

select pg_temp.done((current_date - 6)::date);
select pg_temp.done((current_date - 5)::date);
select pg_temp.done((current_date - 3)::date);
select pg_temp.done((current_date - 2)::date);

-- A legitimate session ALREADY exists on the gap day (-4): 15 min, not enough.
select pg_temp.done((current_date - 4)::date, 1::smallint, 15);

create or replace function pg_temp.obj(p_path text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values ('proofs', p_path);
$$;

-- ---- Anna submits three requests ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e202","role":"authenticated"}', true);

-- (A) day -4: a 20-min proven session. 15 + 20 = 35 >= 30 -> should COMPLETE.
select pg_temp.obj('00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
  || (current_date - 4)::text || '/a.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e2',
  (current_date - 4)::date, 'ingen täckning',
  jsonb_build_array(jsonb_build_object('duration_minutes', 20, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
      || (current_date - 4)::text || '/a.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

-- (B) day -10: a single 20-min session -> stays MISSED (needs 30).
select pg_temp.obj('00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
  || (current_date - 10)::text || '/b.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e2',
  (current_date - 10)::date, 'kort pass',
  jsonb_build_array(jsonb_build_object('duration_minutes', 20, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
      || (current_date - 10)::text || '/b.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

-- (C) day -12: two 20-min proven sessions -> 40 >= 30 -> COMPLETE via sum.
select pg_temp.obj('00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
  || (current_date - 12)::text || '/c1.jpg');
select pg_temp.obj('00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
  || (current_date - 12)::text || '/c2.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e2',
  (current_date - 12)::date, 'dubbelt kort',
  jsonb_build_array(
    jsonb_build_object('duration_minutes', 20, 'sort_order', 1,
      'proof_storage_path', '00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
        || (current_date - 12)::text || '/c1.jpg',
      'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000),
    jsonb_build_object('duration_minutes', 20, 'sort_order', 2,
      'proof_storage_path', '00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
        || (current_date - 12)::text || '/c2.jpg',
      'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

-- A non-admin cannot approve.
select throws_ok(
  format($$select public.approve_retroactive_registration(%L)$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 4)::date)),
  null, null, 'a participant cannot approve a request');

-- ---- Admin approves ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e201","role":"authenticated"}', true);

-- Preview first.
select is(
  (public.preview_retroactive_approval(
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 4)::date))
   ->> 'would_complete')::boolean,
  true, 'preview: approving request A would complete the day');
select is(
  (public.preview_retroactive_approval(
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 4)::date))
   ->> 'debt_delta_sek')::int,
  -50, 'preview: request A drops the debt by 50 kr');
select is(
  (public.preview_retroactive_approval(
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 10)::date))
   ->> 'would_complete')::boolean,
  false, 'preview: request B would NOT complete the day');

create or replace function pg_temp.debt()
returns int language sql as $$
  select liability_sek from public.challenge_results('00000000-0000-0000-0000-0000000000e2')
  where user_id = '00000000-0000-0000-0000-00000000e202';
$$;
create or replace function pg_temp.kassan()
returns int language sql as $$
  select coalesce(sum(liability_sek),0)::int from public.challenge_results('00000000-0000-0000-0000-0000000000e2');
$$;

-- Snapshot debt / KASSAN just before approving request A.
create temp table _before as select pg_temp.debt() as debt, pg_temp.kassan() as kassan;

select lives_ok(
  format($$select public.approve_retroactive_registration(%L, 'ser rimligt ut')$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 4)::date)),
  'admin approves request A');

select is(
  (select status from public.retroactive_training_requests where challenge_date = (current_date - 4)::date),
  'approved', 'request A is now approved');

-- Approve exactly once.
select throws_ok(
  format($$select public.approve_retroactive_registration(%L)$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 4)::date)),
  null, null, 'a request cannot be approved twice');

-- Real training entries at the ORIGINAL date; the pre-existing session survives.
select is(
  (select count(*)::int from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-0000000000e2'
     and user_id = '00000000-0000-0000-0000-00000000e202'
     and challenge_date = (current_date - 4)::date),
  2, 'the approved session is appended alongside the pre-existing one');
select is(
  (select max(session_seq)::int from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-0000000000e2'
     and user_id = '00000000-0000-0000-0000-00000000e202'
     and challenge_date = (current_date - 4)::date),
  2, 'session_seq is appended, not overwritten');
select is(
  (select count(*)::int from public.training_proofs tp
   join public.training_entries te on te.id = tp.training_entry_id
   where te.challenge_date = (current_date - 4)::date
     and tp.storage_path = '00000000-0000-0000-0000-0000000000e2/00000000-0000-0000-0000-00000000e202/'
       || (current_date - 4)::text || '/a.jpg'),
  1, 'a training_proofs row now points at the same private object');

-- Day flips missed -> completed; debt and KASSAN drop by exactly one missed-day cost.
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e2')
   where user_id = '00000000-0000-0000-0000-00000000e202' and challenge_date = (current_date - 4)::date),
  'completed', 'the day is now completed');
select is(pg_temp.debt(), (select debt from _before) - 50,
  'the participant''s liability drops by exactly the 50 kr missed-day cost');
select is(pg_temp.kassan(), (select kassan from _before) - 50,
  'KASSAN drops by the same 50 kr');

-- Streak: -6..-2 is now an unbroken run of 5.
select cmp_ok(
  (select longest_streak from public.challenge_results('00000000-0000-0000-0000-0000000000e2')
   where user_id = '00000000-0000-0000-0000-00000000e202'),
  '>=', 5, 'the filled gap restores a 5-day streak run');

-- Milestone at streak 3 is earned retroactively, and stays earned exactly once.
select is(
  (select count(*)::int from public.earned_penalties
   where challenge_id = '00000000-0000-0000-0000-0000000000e2'
     and user_id = '00000000-0000-0000-0000-00000000e202' and status <> 'revoked'),
  1, 'approval retroactively earns the streak-3 milestone');
select lives_ok(
  $$select public.reconcile_earned_penalties('00000000-0000-0000-0000-0000000000e2',
      '00000000-0000-0000-0000-00000000e202')$$,
  're-reconcile is safe');
select is(
  (select count(*)::int from public.earned_penalties
   where challenge_id = '00000000-0000-0000-0000-0000000000e2'
     and user_id = '00000000-0000-0000-0000-00000000e202' and status <> 'revoked'),
  1, 'earning stays idempotent');

-- Request B: truthful but insufficient -> session exists, day stays missed.
select lives_ok(
  format($$select public.approve_retroactive_registration(%L)$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 10)::date)),
  'admin approves request B');
select is(
  (select count(*)::int from public.training_entries
   where challenge_date = (current_date - 10)::date
     and user_id = '00000000-0000-0000-0000-00000000e202'),
  1, 'request B still creates the real session');
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e2')
   where user_id = '00000000-0000-0000-0000-00000000e202' and challenge_date = (current_date - 10)::date),
  'missed', 'request B: an honest but insufficient session leaves the day missed');

-- Request C: two sessions summing to the requirement -> completed.
select lives_ok(
  format($$select public.approve_retroactive_registration(%L)$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 12)::date)),
  'admin approves request C');
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e2')
   where user_id = '00000000-0000-0000-0000-00000000e202' and challenge_date = (current_date - 12)::date),
  'completed', 'request C: 20 + 20 proven minutes complete the day');

-- A participant still cannot write training_entries for a past day directly.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e202","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.training_entries (challenge_id, user_id, challenge_date, session_seq, duration_minutes)
    values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e202',
      (current_date - 15)::date, 1, 40)$$,
  null, null, 'a participant cannot bypass the flow with a direct past-day insert');

select * from finish();
rollback;
