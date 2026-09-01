-- ============================================================================
-- pgTAP — Fas 3: invite / membership authorization and semantics.
--
-- Covers what the invite Edge Function relies on at the database layer:
--   * only an admin may create a challenge_membership (RLS)
--   * the invite display_name flows auth.users.raw_user_meta_data -> profiles
--   * an admin membership insert via a JWT records the admin as audit actor
--   * `active = false` never rewrites historical day-state
--   * the participation window guard rejects a non-intersecting window
--
-- Runs in a transaction and rolls back. See 0001 for how to execute.
-- ============================================================================
begin;

create extension if not exists pgtap;
select plan(11);

set local role postgres;

-- Invite metadata path: display_name comes from raw_user_meta_data.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ad10', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin2@example.test',
   '{"display_name":"Admin Två"}', now(), now()),
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bea@example.test',
   '{"display_name":"Bea Berg"}', now(), now()),
  ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dan@example.test',
   '{}', now(), now());

select is(
  (select display_name from public.profiles
   where id = '00000000-0000-0000-0000-0000000005b1'),
  'Bea Berg',
  'handle_new_user copies display_name from invite metadata'
);

select is(
  (select display_name from public.profiles
   where id = '00000000-0000-0000-0000-0000000005d1'),
  'dan',
  'handle_new_user falls back to the email local-part when metadata is empty'
);

update public.profiles set role = 'admin'
where id = '00000000-0000-0000-0000-00000000ad10';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000c0010', 'Inbjudningstest',
  date '2026-08-01', date '2026-09-30', 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-00000000ad10');

-- --------------------------------------------------------------------------
-- RLS: a participant (Bea) may not create memberships
-- --------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.challenge_memberships
      (challenge_id, user_id, participation_start_date)
    values ('00000000-0000-0000-0000-0000000c0010',
            '00000000-0000-0000-0000-0000000005b1', date '2026-08-01')$$,
  '42501', null,
  'a participant cannot insert a challenge_membership (RLS)'
);

-- --------------------------------------------------------------------------
-- RLS: an admin (via JWT) may create memberships, and is the audit actor
-- --------------------------------------------------------------------------
set local role postgres;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ad10","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.challenge_memberships
      (challenge_id, user_id, participation_start_date, participation_end_date,
       active, created_by)
    values ('00000000-0000-0000-0000-0000000c0010',
            '00000000-0000-0000-0000-0000000005b1',
            date '2026-08-01', null, true,
            '00000000-0000-0000-0000-00000000ad10')$$,
  'an admin can insert a challenge_membership'
);

select lives_ok(
  $$insert into public.challenge_memberships
      (challenge_id, user_id, participation_start_date, active, created_by)
    values ('00000000-0000-0000-0000-0000000c0010',
            '00000000-0000-0000-0000-0000000005d1',
            date '2026-08-01', true,
            '00000000-0000-0000-0000-00000000ad10')$$,
  'an admin can insert a second membership'
);

select is(
  (select actor_user_id from public.audit_log
   where entity_type = 'challenge_membership'
     and target_user_id = '00000000-0000-0000-0000-0000000005b1'
   order by created_at desc limit 1),
  '00000000-0000-0000-0000-00000000ad10'::uuid,
  'membership insert via JWT records the admin as the audit actor'
);

-- --------------------------------------------------------------------------
-- Window guard: a non-intersecting participation window is rejected
-- --------------------------------------------------------------------------
select throws_ok(
  $$insert into public.challenge_memberships
      (challenge_id, user_id, participation_start_date, participation_end_date,
       created_by)
    values ('00000000-0000-0000-0000-0000000c0010',
            '00000000-0000-0000-0000-00000000ad10',
            date '2026-06-01', date '2026-07-01',
            '00000000-0000-0000-0000-00000000ad10')$$,
  null, null,
  'a participation window entirely before the challenge is rejected'
);

-- --------------------------------------------------------------------------
-- `active = false` must not rewrite historical day-state
-- --------------------------------------------------------------------------
set local role postgres;

-- Bea completed 2026-08-03 (past day, qualifying entry + proof).
insert into public.training_entries (id, challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-00000000e010', '00000000-0000-0000-0000-0000000c0010',
  '00000000-0000-0000-0000-0000000005b1', date '2026-08-03', 45);
insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-00000000e010', '00000000-0000-0000-0000-0000000c0010',
  '00000000-0000-0000-0000-0000000005b1',
  '00000000-0000-0000-0000-0000000c0010/00000000-0000-0000-0000-0000000005b1/2026-08-03/p.jpg',
  'image/jpeg', 9999);

create or replace function pg_temp.bea_state(p_date date)
returns text language sql as $$
  select state from public.challenge_day_states('00000000-0000-0000-0000-0000000c0010')
  where user_id = '00000000-0000-0000-0000-0000000005b1' and challenge_date = p_date
$$;

select is(pg_temp.bea_state(date '2026-08-03'), 'completed',
  'Bea 2026-08-03 completed while active');
select is(pg_temp.bea_state(date '2026-08-04'), 'missed',
  'Bea 2026-08-04 missed while active');

update public.challenge_memberships
  set active = false
where challenge_id = '00000000-0000-0000-0000-0000000c0010'
  and user_id = '00000000-0000-0000-0000-0000000005b1';

select is(pg_temp.bea_state(date '2026-08-03'), 'completed',
  'deactivating the membership does NOT erase a past completed day');
select is(pg_temp.bea_state(date '2026-08-04'), 'missed',
  'deactivating the membership does NOT turn a past missed day into not_participating');

select * from finish();
rollback;
