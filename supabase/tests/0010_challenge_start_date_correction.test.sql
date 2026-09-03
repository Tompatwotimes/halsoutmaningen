-- ============================================================================
-- pgTAP — Phase 10: audited correction of an ACTIVE challenge's start_date.
--
-- Covers migration 0013: preview_challenge_start_date_correction /
-- correct_challenge_start_date — forward-only, admin-only, blocked by real
-- training/penalty history, never deletes anything, audited.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(26);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ca01@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ca02@example.test', '{"display_name":"Nils"}', now(), now()),
  ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ca03@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000ca01';

-- ----------------------------------------------------------------------------
-- Challenge A — the happy path. Old start is well before "today"; the
-- intended corrected start is a month later, still before end_date. One
-- membership predates the new start (allowed — no training before it), one
-- starts after it. One valid training entry sits AFTER the new start, so it
-- must survive untouched.
-- ----------------------------------------------------------------------------
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000ca', 'Rätt-startdatum-test',
  current_date - 40, current_date + 40, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000ca01');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000ca02',
   current_date - 40, true, '00000000-0000-0000-0000-00000000ca01'),
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000ca03',
   current_date - 5, true, '00000000-0000-0000-0000-00000000ca01');

insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000ca',
  '00000000-0000-0000-0000-00000000ca02', current_date - 3, 1, 40);

-- Intended correction: move start forward by 31 days (mirrors Aug 1 -> Sep 1).
-- current_date - 40 + 31 = current_date - 9.

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}', true);

select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000ca', (current_date - 9)::date) ->> 'ok')::boolean,
  true, 'preview: safe correction is reported ok (membership before new start does not block it)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select throws_ok(
  $$select public.correct_challenge_start_date('00000000-0000-0000-0000-0000000000ca', (current_date - 9)::date)$$,
  null, null, 'a participant cannot correct the challenge start date');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}', true);
select throws_ok(
  $$select public.correct_challenge_start_date('00000000-0000-0000-0000-0000000000ca', (current_date + 41)::date)$$,
  null, null, 'a new start after end_date is rejected');
select is(
  (select start_date from public.challenges where id = '00000000-0000-0000-0000-0000000000ca'),
  (current_date - 40)::date, 'the rejected attempt did not change start_date');

select lives_ok(
  $$select public.correct_challenge_start_date('00000000-0000-0000-0000-0000000000ca',
      (current_date - 9)::date, 'felaktigt startdatum vid aktivering')$$,
  'admin can apply a safe correction');

select is(
  (select start_date from public.challenges where id = '00000000-0000-0000-0000-0000000000ca'),
  (current_date - 9)::date, 'start_date is now the corrected date');

select is(
  (select count(*)::int from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000ca'
     and action = 'challenge_start_date_corrected'),
  1, 'the correction produces exactly one audit event');
select is(
  (select actor_user_id from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000ca'
     and action = 'challenge_start_date_corrected'),
  '00000000-0000-0000-0000-00000000ca01'::uuid, 'the audit row records the correcting admin');
select is(
  (select before_data ->> 'start_date' from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000ca'
     and action = 'challenge_start_date_corrected'),
  (current_date - 40)::text, 'the audit row records the old start_date');
select is(
  (select after_data ->> 'start_date' from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000ca'
     and action = 'challenge_start_date_corrected'),
  (current_date - 9)::text, 'the audit row records the new start_date');
select is(
  (select note from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000ca'
     and action = 'challenge_start_date_corrected'),
  'felaktigt startdatum vid aktivering', 'the audit row carries the optional reason');

select is(
  (select count(*)::int from public.training_entries where challenge_id = '00000000-0000-0000-0000-0000000000ca'),
  1, 'no training row was deleted by the correction');
select is(
  (select count(*)::int from public.challenge_memberships where challenge_id = '00000000-0000-0000-0000-0000000000ca'),
  2, 'no membership row was deleted by the correction');

select is(
  (select min(challenge_date) from public.challenge_day_states('00000000-0000-0000-0000-0000000000ca')),
  (current_date - 9)::date, 'day states now begin at the corrected start date');
select ok(
  not exists (
    select 1 from public.challenge_day_states('00000000-0000-0000-0000-0000000000ca')
    where challenge_date = (current_date - 40)::date
  ), 'the old, now-removed start date no longer appears in day states');

-- 50 eligible days = (end_date - corrected_start + 1), proving liability now
-- accrues only from the corrected start onward — the 31 days that used to be
-- eligible (and would have been missed) before it are simply gone.
select is(
  (select eligible_days from public.challenge_results('00000000-0000-0000-0000-0000000000ca')
   where user_id = '00000000-0000-0000-0000-00000000ca02'),
  50, 'liability before the corrected start disappeared naturally (eligible days now count only from the corrected start)');

-- ----------------------------------------------------------------------------
-- Challenge B — blocked by a valid training entry in the period being
-- removed. Nothing may be deleted or changed.
-- ----------------------------------------------------------------------------
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000cc', 'Blockerad-rättning-test',
  current_date - 40, current_date + 40, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-00000000ca01');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000ca02',
  current_date - 40, true, '00000000-0000-0000-0000-00000000ca01');

-- A real, valid session two days before the intended new start.
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-0000000000cc',
  '00000000-0000-0000-0000-00000000ca02', current_date - 11, 1, 35);

select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000cc', (current_date - 9)::date) ->> 'blocking_code'),
  'training_exists', 'preview reports the correct blocking reason for real training in the removed period');
select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000cc', (current_date - 9)::date) ->> 'blocking_date'),
  (current_date - 11)::text, 'preview reports the exact blocking date');

select throws_ok(
  $$select public.correct_challenge_start_date('00000000-0000-0000-0000-0000000000cc', (current_date - 9)::date)$$,
  null, null, 'a valid training entry before the new start blocks the correction');
select is(
  (select start_date from public.challenges where id = '00000000-0000-0000-0000-0000000000cc'),
  (current_date - 40)::date, 'the blocked challenge''s start_date is unchanged');
select is(
  (select count(*)::int from public.training_entries where challenge_id = '00000000-0000-0000-0000-0000000000cc'),
  1, 'the blocking training row was not deleted');
select is(
  (select count(*)::int from public.audit_log
   where challenge_id = '00000000-0000-0000-0000-0000000000cc'
     and action = 'challenge_start_date_corrected'),
  0, 'a blocked correction produces no audit event');

-- Invalidating the blocking entry (an unrelated admin correction) should
-- unblock the same start_date correction — the safety check is live, not
-- based on a snapshot.
select public.invalidate_training_session(
  '00000000-0000-0000-0000-0000000000cd', 'felregistrerat datum', 'fel_datum');
select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000cc', (current_date - 9)::date) ->> 'ok')::boolean,
  true, 'once the blocking entry is invalidated, the same correction is safe');

-- ----------------------------------------------------------------------------
-- Challenge C — not active. Cannot be corrected via this path.
-- ----------------------------------------------------------------------------
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000ce', 'Utkast-rättning-test',
  current_date + 5, current_date + 60, 'Europe/Stockholm', 30, true, 50, 'draft',
  '00000000-0000-0000-0000-00000000ca01');

select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000ce', (current_date + 6)::date) ->> 'blocking_code'),
  'not_active', 'a draft challenge cannot be corrected via this narrow path');
select throws_ok(
  $$select public.correct_challenge_start_date('00000000-0000-0000-0000-0000000000ce', (current_date + 6)::date)$$,
  null, null, 'correcting a non-active challenge raises');

-- A backward "correction" is rejected outright.
select is(
  (public.preview_challenge_start_date_correction(
    '00000000-0000-0000-0000-0000000000ca', (current_date - 20)::date) ->> 'blocking_code'),
  'not_forward', 'moving start_date backward is rejected as not-forward');

select * from finish();
rollback;
