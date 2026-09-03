-- ============================================================================
-- pgTAP — Phase 11 / 0014-0015: efterregistrering — RLS, storage, reject, audit.
--
--   * a participant sees only their own request + session rows
--   * a PENDING retroactive proof object is invisible to other participants,
--     visible to its owner and admins; after approval it is a normal proof
--     visible to every challenge member
--   * rejection is admin-only, needs a reason, creates no training and leaves
--     the day untouched
--   * submit / approve / reject write the right audit rows, with no proof
--     paths / URLs / tokens in them
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(20);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e301@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e302@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e303@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000e301';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000e3', 'Efterreg-rls-test',
  current_date - 20, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000e301');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000e302',
   current_date - 20, true, '00000000-0000-0000-0000-00000000e301'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000e303',
   current_date - 20, true, '00000000-0000-0000-0000-00000000e301');

create or replace function pg_temp.obj(p_path text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values ('proofs', p_path);
$$;

-- Anna's pending proof for day -5.
select pg_temp.obj('00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
  || (current_date - 5)::text || '/anna.jpg');

-- ---- Anna submits ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e302","role":"authenticated"}', true);

select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e3',
  (current_date - 5)::date, 'ingen uppkoppling',
  jsonb_build_array(jsonb_build_object('duration_minutes', 40, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
      || (current_date - 5)::text || '/anna.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

-- Anna also submits a second request (day -6) that will be rejected.
select pg_temp.obj('00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
  || (current_date - 6)::text || '/anna6.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000000e3',
  (current_date - 6)::date, 'fel dag kanske',
  jsonb_build_array(jsonb_build_object('duration_minutes', 40, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
      || (current_date - 6)::text || '/anna6.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

select is(
  (select count(*)::int from public.retroactive_training_requests where user_id = '00000000-0000-0000-0000-00000000e302'),
  2, 'Anna sees her own two requests');
select is(
  (select count(*)::int from public.retroactive_training_request_sessions), 2,
  'Anna sees her own session rows');
-- Anna can see her own pending proof object.
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
     || (current_date - 5)::text || '/anna.jpg'),
  1, 'the owner can read her own pending proof object');

-- ---- Erik (co-member) cannot see any of it ---------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e303","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.retroactive_training_requests), 0,
  'a co-participant cannot see another participant''s requests (RLS)');
select is(
  (select count(*)::int from public.retroactive_training_request_sessions), 0,
  'a co-participant cannot see another participant''s session rows (RLS)');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
     || (current_date - 5)::text || '/anna.jpg'),
  0, 'a co-participant CANNOT read a pending retroactive proof object');
select throws_ok(
  $$select public.approve_retroactive_registration('00000000-0000-0000-0000-000000000999')$$,
  null, null, 'a co-participant cannot approve');

-- ---- Admin sees everything -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e301","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.retroactive_training_requests
   where challenge_id = '00000000-0000-0000-0000-0000000000e3'),
  2, 'an admin sees all requests');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
     || (current_date - 5)::text || '/anna.jpg'),
  1, 'an admin can read a pending retroactive proof object');
select is(
  (select status from public.retroactive_requests_for_challenge('00000000-0000-0000-0000-0000000000e3')
   order by submitted_at asc limit 1),
  'pending', 'the admin queue lists pending requests');

-- Reject needs a reason.
select throws_ok(
  format($$select public.reject_retroactive_registration(%L, '  ')$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 6)::date)),
  null, null, 'rejection without a reason is refused');

-- Reject request -6.
select lives_ok(
  format($$select public.reject_retroactive_registration(%L, 'Bild matchar inte datumet')$$,
    (select id from public.retroactive_training_requests where challenge_date = (current_date - 6)::date)),
  'admin can reject with a reason');
select is(
  (select status from public.retroactive_training_requests where challenge_date = (current_date - 6)::date),
  'rejected', 'the request is rejected');
select is(
  (select count(*)::int from public.training_entries
   where user_id = '00000000-0000-0000-0000-00000000e302' and challenge_date = (current_date - 6)::date),
  0, 'a rejected request creates no training entry');
select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000e3')
   where user_id = '00000000-0000-0000-0000-00000000e302' and challenge_date = (current_date - 6)::date),
  'missed', 'a rejected request leaves the day missed');

-- Approve request -5 → the proof becomes a normal, member-visible proof.
select public.approve_retroactive_registration(
  (select id from public.retroactive_training_requests where challenge_date = (current_date - 5)::date),
  'ok');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e303","role":"authenticated"}', true);
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000000e3/00000000-0000-0000-0000-00000000e302/'
     || (current_date - 5)::text || '/anna.jpg'),
  1, 'after approval every challenge member can read the (now real) proof');

-- ---- Audit ---------------------------------------------------------
set local role postgres;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000e3'
     and entity_type = 'retroactive_training_request'
     and action = 'retroactive_registration_submitted'),
  2, 'both submissions are audited');
select is(
  (select actor_user_id from public.audit_log
   where action = 'retroactive_registration_approved'
     and challenge_id = '00000000-0000-0000-0000-0000000000e3'),
  '00000000-0000-0000-0000-00000000e301'::uuid, 'the approval audit row records the admin');
select is(
  (select note from public.audit_log
   where action = 'retroactive_registration_rejected'
     and challenge_id = '00000000-0000-0000-0000-0000000000e3'),
  'Bild matchar inte datumet', 'the rejection audit row carries the reason');
select ok(
  not exists (
    select 1 from public.audit_log
    where challenge_id = '00000000-0000-0000-0000-0000000000e3'
      and entity_type = 'retroactive_training_request'
      and (coalesce(after_data::text, '') || coalesce(before_data::text, '') || coalesce(note, ''))
          like '%.jpg%'
  ), 'the efterregistrering audit rows carry no proof path / URL / token');

select * from finish();
rollback;
