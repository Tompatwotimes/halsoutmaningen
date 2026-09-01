-- ============================================================================
-- pgTAP tests for the initial schema: canonical day-state, guard triggers, RLS.
--
-- HOW TO RUN (the dev VM does not run the local Docker stack):
--   * CI: spin up postgres:15 + apply migrations + `pg_prove` / `supabase test db`
--   * or against a Supabase preview branch created by the GitHub integration
--
-- Everything runs inside a transaction and is rolled back.
-- ============================================================================
begin;

create extension if not exists pgtap;

select plan(22);

-- ----------------------------------------------------------------------------
-- Fixtures. Insert auth.users directly (as the migration/superuser role); the
-- on_auth_user_created trigger fills public.profiles.
-- ----------------------------------------------------------------------------
set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anna@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'erik@example.test', '{"display_name":"Erik"}', now(), now()),
  ('00000000-0000-0000-0000-0000000005c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cecilia@example.test', '{"display_name":"Cecilia"}', now(), now());

select is(
  (select count(*)::int from public.profiles), 4,
  'handle_new_user created a profile per auth user'
);

update public.profiles set role = 'admin'
where id = '00000000-0000-0000-0000-00000000ad01';

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-00000000ad01'),
  'admin', 'first admin can be promoted by a NULL-jwt (privileged) session'
);

-- Challenge: 2026-08-01 .. 2026-09-30, 30 min, proof required, 50 SEK.
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000c0001', 'Testutmaning',
  date '2026-08-01', date '2026-09-30', 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-00000000ad01');

-- Anna: full period. Erik: joins 2026-08-20. Cecilia: leaves 2026-08-10.
insert into public.challenge_memberships (challenge_id, user_id,
  participation_start_date, participation_end_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000005a1',
   date '2026-08-01', null, true, '00000000-0000-0000-0000-00000000ad01'),
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000005e2',
   date '2026-08-20', null, true, '00000000-0000-0000-0000-00000000ad01'),
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000005c3',
   date '2026-08-01', date '2026-08-10', true, '00000000-0000-0000-0000-00000000ad01');

-- ----------------------------------------------------------------------------
-- Membership window trigger
-- ----------------------------------------------------------------------------
select throws_ok(
  $$insert into public.challenge_memberships (challenge_id, user_id, participation_start_date)
    values ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000ad01', date '2027-01-01')$$,
  null, null,
  'membership whose window does not intersect the challenge range is rejected'
);

-- ----------------------------------------------------------------------------
-- Canonical day-state (helper to read one cell)
-- ----------------------------------------------------------------------------
create or replace function pg_temp.state_on(p_user uuid, p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-0000000c0001')
  where user_id = p_user and challenge_date = p_date
$$;

-- All asserted cells use August 2026 dates, i.e. always in the past for any
-- realistic run (challenge_current_date uses now()), so these are stable.
select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005a1', date '2026-08-05'),
  'missed', 'Anna, eligible past day, no entry -> missed');

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005e2', date '2026-08-05'),
  'not_participating', 'Erik before his join date -> not_participating (not missed)');

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005e2', date '2026-08-20'),
  'missed', 'Erik on his join date, no entry -> missed');

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005c3', date '2026-08-10'),
  'missed', 'Cecilia on her last day -> eligible (missed)');

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005c3', date '2026-08-11'),
  'not_participating', 'Cecilia after departure -> not_participating');

-- A qualifying entry -> completed
insert into public.training_entries (id, challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0001',
  '00000000-0000-0000-0000-0000000005a1', date '2026-08-06', 35);
insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0001',
  '00000000-0000-0000-0000-0000000005a1',
  '00000000-0000-0000-0000-0000000c0001/00000000-0000-0000-0000-0000000005a1/2026-08-06/p.jpg',
  'image/jpeg', 12345);

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005a1', date '2026-08-06'),
  'completed', 'Anna with a 35-min entry + proof -> completed');

-- Entry without proof -> still missed (proof required)
insert into public.training_entries (id, challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000c0001',
  '00000000-0000-0000-0000-0000000005a1', date '2026-08-07', 40);

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005a1', date '2026-08-07'),
  'missed', '40-min entry without proof -> missed (proof_required)');

-- Under-duration entry -> missed
insert into public.training_entries (id, challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000c0001',
  '00000000-0000-0000-0000-0000000005a1', date '2026-08-08', 20);
insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000c0001',
  '00000000-0000-0000-0000-0000000005a1',
  '00000000-0000-0000-0000-0000000c0001/00000000-0000-0000-0000-0000000005a1/2026-08-08/p.jpg',
  'image/jpeg', 12345);

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005a1', date '2026-08-08'),
  'missed', '20-min entry (< required 30) -> missed');

-- Invalidated entry -> missed
update public.training_entries
  set status = 'invalidated', invalidated_at = now(),
      invalidated_by = '00000000-0000-0000-0000-00000000ad01'
where id = '00000000-0000-0000-0000-00000000e001';

select is(pg_temp.state_on('00000000-0000-0000-0000-0000000005a1', date '2026-08-06'),
  'missed', 'admin-invalidated entry no longer counts -> missed');

select ok(
  exists (select 1 from public.audit_log
          where entity_type = 'training_entry' and action = 'invalidate'),
  'invalidation wrote an audit_log row'
);

-- ----------------------------------------------------------------------------
-- RLS: act as Anna
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.challenges), 1,
  'Anna (member) can see the challenge'
);

select throws_ok(
  $$update public.profiles set role = 'admin'
    where id = '00000000-0000-0000-0000-0000000005a1'$$,
  null, null,
  'Anna cannot promote herself to admin'
);

select throws_ok(
  $$insert into public.training_entries (challenge_id, user_id, challenge_date, duration_minutes)
    values ('00000000-0000-0000-0000-0000000c0001',
            '00000000-0000-0000-0000-0000000005e2', date '2026-08-25', 30)$$,
  null, null,
  'Anna cannot log training for Erik'
);

select throws_ok(
  $$insert into public.training_entries (challenge_id, user_id, challenge_date, duration_minutes)
    values ('00000000-0000-0000-0000-0000000c0001',
            '00000000-0000-0000-0000-0000000005a1', date '2026-08-15', 30)$$,
  null, null,
  'Anna cannot log training for a past (non-current) challenge day'
);

-- ----------------------------------------------------------------------------
-- RLS: a non-member sees nothing
-- ----------------------------------------------------------------------------
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'outsider@example.test', '{"display_name":"Outsider"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.challenges), 0,
  'a non-member cannot see the challenge'
);
select is(
  (select count(*)::int from public.training_entries), 0,
  'a non-member cannot see any training entries'
);
select is(
  (select count(*)::int from public.challenge_day_states('00000000-0000-0000-0000-0000000c0001')),
  0, 'challenge_day_states returns nothing to a non-member'
);

-- ----------------------------------------------------------------------------
-- RLS: challenge rule-lock (as admin, via JWT)
-- ----------------------------------------------------------------------------
set local role postgres;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$update public.challenges set required_minutes = 60
    where id = '00000000-0000-0000-0000-0000000c0001'$$,
  null, null,
  'required_minutes is locked on a started challenge, even for an admin'
);

select lives_ok(
  $$update public.challenges set end_date = date '2026-10-31'
    where id = '00000000-0000-0000-0000-0000000c0001'$$,
  'end_date may still be extended'
);

select * from finish();
rollback;
