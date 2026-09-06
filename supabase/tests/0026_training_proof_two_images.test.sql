-- ============================================================================
-- pgTAP — 0026: a second, optional training-proof image.
--
-- Proves 20260906120000_training_proof_two_images.sql:
--   * a proof inserted with no explicit position lands at 1 (historical
--     single-proof rows stay valid, backfilled to 1 by the column DEFAULT)
--   * a second proof at position 2 is accepted
--   * position 3 is rejected by training_proofs_position_valid
--   * (training_entry_id, position) is unique — no two proofs in the same slot
--   * storage_path stays globally unique
--   * training_proofs SELECT RLS is position-agnostic: a challenge member sees
--     BOTH slots, a non-member sees neither, an admin sees both
--
-- Runs in a transaction and rolls back. See 0001_*.sql for how to execute.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(10);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000e2601', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'proof-e2601@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000e2602', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'proof-e2602@example.test', '{"display_name":"Ada"}', now(), now()),
  ('00000000-0000-0000-0000-0000000e2603', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'proof-e2603@example.test', '{"display_name":"Bo"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000e2601';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000ec601', 'Proof-Two', current_date - 30, current_date + 30,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000e2601');

-- Ada is a member; Bo is not.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000ec601', '00000000-0000-0000-0000-0000000e2602',
  current_date - 30, true, '00000000-0000-0000-0000-0000000e2601');

-- Ada's training entry for today (as postgres: training_proofs_guard treats a
-- null auth.uid() as an admin actor and skips the owner/day checks, but still
-- forces challenge_id/user_id from the parent entry).
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
  '00000000-0000-0000-0000-0000000e2602', current_date, 1, 30);

-- ---- slot / position constraints -------------------------------------
insert into public.training_proofs
  (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
  '00000000-0000-0000-0000-0000000e2602',
  '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a1.jpg',
  'image/jpeg', 1000);

select is(
  (select position from public.training_proofs
   where storage_path = '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a1.jpg'),
  1::smallint,
  'a proof inserted with no explicit position lands at slot 1');

select lives_ok(
  $$insert into public.training_proofs
     (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes, position)
   values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
     '00000000-0000-0000-0000-0000000e2602',
     '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a2.jpg',
     'image/jpeg', 1000, 2)$$,
  'a second proof at slot 2 is accepted');

select throws_ok(
  $$insert into public.training_proofs
     (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes, position)
   values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
     '00000000-0000-0000-0000-0000000e2602',
     '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a3.jpg',
     'image/jpeg', 1000, 3)$$,
  null, null,
  'a third slot (position 3) is rejected by training_proofs_position_valid');

select throws_ok(
  $$insert into public.training_proofs
     (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes, position)
   values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
     '00000000-0000-0000-0000-0000000e2602',
     '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a1b.jpg',
     'image/jpeg', 1000, 1)$$,
  null, null,
  'a second proof in slot 1 is rejected by training_proofs_one_per_slot');

select throws_ok(
  $$insert into public.training_proofs
     (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes, position)
   values ('00000000-0000-0000-0000-00000000e260', '00000000-0000-0000-0000-0000000ec601',
     '00000000-0000-0000-0000-0000000e2602',
     '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/a2.jpg',
     'image/jpeg', 1000, 1)$$,
  null, null,
  'storage_path stays globally unique across slots');

select is(
  (select count(*)::int from public.training_proofs
   where training_entry_id = '00000000-0000-0000-0000-00000000e260'),
  2, 'exactly the two accepted proofs exist for the entry');

-- (training_entry_id, position) is unique PER ENTRY, not globally per slot: a
-- different session's slot 1 is fine.
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-00000000e261', '00000000-0000-0000-0000-0000000ec601',
  '00000000-0000-0000-0000-0000000e2602', current_date, 2, 20);
select lives_ok(
  $$insert into public.training_proofs
     (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
   values ('00000000-0000-0000-0000-00000000e261', '00000000-0000-0000-0000-0000000ec601',
     '00000000-0000-0000-0000-0000000e2602',
     '00000000-0000-0000-0000-0000000ec601/00000000-0000-0000-0000-0000000e2602/p/b1.jpg',
     'image/jpeg', 1000)$$,
  'another session can still have its own slot-1 proof (uniqueness is per entry)');

-- ---- SELECT RLS is position-agnostic --------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000e2602","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.training_proofs
   where training_entry_id = '00000000-0000-0000-0000-00000000e260'),
  2, 'the owner (a member) sees both proof slots');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000e2603","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.training_proofs
   where training_entry_id = '00000000-0000-0000-0000-00000000e260'),
  0, 'a non-member sees neither slot');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000e2601","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.training_proofs
   where training_entry_id = '00000000-0000-0000-0000-00000000e260'),
  2, 'an admin sees both slots');

select * from finish();
rollback;
