-- ============================================================================
-- pgTAP — Phase 9: administrative training corrections.
--
-- Covers migration 0010: invalidate_training_session / revalidate_training_session
-- — participant cannot; reason mandatory; original preserved; audited; the
-- invalidated session stops counting and the streak recomputes.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(13);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000c7ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c7ad@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000c701', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c701@example.test', '{"display_name":"Nils"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000c7ad';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000c7', 'Rätt-test',
  current_date - 20, current_date + 40, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000c7ad');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-00000000c701',
  current_date - 20, true, '00000000-0000-0000-0000-00000000c7ad');

-- A completed past day.
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c7',
  '00000000-0000-0000-0000-00000000c701', current_date - 10, 1, 40);
insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c7',
  '00000000-0000-0000-0000-00000000c701',
  '00000000-0000-0000-0000-0000000000c7/00000000-0000-0000-0000-00000000c701/x/p.jpg', 'image/jpeg', 1000);

create or replace function pg_temp.st(p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-0000000000c7')
  where user_id = '00000000-0000-0000-0000-00000000c701' and challenge_date = p_date
$$;

select is(pg_temp.st((current_date - 10)::date), 'completed', 'the day starts completed');

-- Participant cannot invalidate (even their own).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c701","role":"authenticated"}', true);
select throws_ok(
  $$select public.invalidate_training_session('00000000-0000-0000-0000-0000000000c8', 'jag ångrar mig')$$,
  null, null, 'a participant cannot invalidate a session');

-- Admin: reason is mandatory.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c7ad","role":"authenticated"}', true);
select throws_ok(
  $$select public.invalidate_training_session('00000000-0000-0000-0000-0000000000c8', '   ')$$,
  null, null, 'invalidation requires a non-empty reason');

-- Admin invalidates with a reason + code.
select lives_ok(
  $$select public.invalidate_training_session('00000000-0000-0000-0000-0000000000c8',
      'otillräckligt bildbevis', 'otillrackligt_bildbevis')$$,
  'admin can invalidate with a reason');

select is(pg_temp.st((current_date - 10)::date), 'missed',
  'the invalidated session no longer counts -> missed');
select is(
  (select duration_minutes from public.training_entries where id = '00000000-0000-0000-0000-0000000000c8'),
  40, 'the original entry data is preserved');
select is(
  (select invalidated_by from public.training_entries where id = '00000000-0000-0000-0000-0000000000c8'),
  '00000000-0000-0000-0000-00000000c7ad'::uuid, 'the correcting admin is recorded');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'training_entry' and entity_id = '00000000-0000-0000-0000-0000000000c8'
     and action = 'invalidate'),
  1, 'invalidation produces exactly one audit event');
select is(
  (select note from public.audit_log
   where entity_type = 'training_entry' and entity_id = '00000000-0000-0000-0000-0000000000c8'
     and action = 'invalidate'),
  'otillräckligt bildbevis', 'the invalidate audit row carries the reason as its note');

-- Revalidate.
select lives_ok(
  $$select public.revalidate_training_session('00000000-0000-0000-0000-0000000000c8', 'bevis inkommet i efterhand')$$,
  'admin can revalidate with a reason');
select is(pg_temp.st((current_date - 10)::date), 'completed',
  'revalidation restores the completed state');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'training_entry' and entity_id = '00000000-0000-0000-0000-0000000000c8'
     and action = 'revalidate'),
  1, 'revalidation produces exactly one audit event (no duplicate)');
select is(
  (select note from public.audit_log
   where entity_type = 'training_entry' and entity_id = '00000000-0000-0000-0000-0000000000c8'
     and action = 'revalidate'),
  'bevis inkommet i efterhand', 'the revalidate audit row carries the reason');

select * from finish();
rollback;
