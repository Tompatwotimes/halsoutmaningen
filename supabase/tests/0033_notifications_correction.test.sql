-- ============================================================================
-- pgTAP — PWA + Web Push V1 / POST-RELEASE CORRECTION — 0033
--
-- Proves the three verified product gaps fixed by
-- 20260912100000_notifications_correction.sql:
--   A. the scheduler no longer drifts to ~19:30/22:30 (exact local-time slot
--      boundaries, pure and deterministic — no dependency on real wall-clock
--      time at test-run time);
--   B. the 06:30 report uses real Game-Master-voice copy with real missed
--      participant names (Swedish joining, never dropped) and the
--      challenge's own configured missed_day_cost;
--   C. training invalidation/revalidation and challenge start/completion now
--      each enqueue a personal_status notification.
--
-- Sections A–C below test the three PURE helper functions directly — no
-- fixture, no dependency on when the suite runs. Sections D–F exercise the
-- real triggers/scheduler against a fixture, following the same
-- deterministic-per-window pattern already established in
-- 0032_notifications_producers_scheduler.test.sql's Section H.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(46);

set local role postgres;
reset request.jwt.claims;

-- ========================================================================
-- Section A — _notification_local_slot: exact boundaries, not a bare hour.
-- This is the direct proof that the 19:30/22:30 drift bug is gone: a bare
-- "hour = 19" check (the old bug, effectively) would have returned true for
-- slot(19, 30) too. The corrected function must not.
-- ========================================================================
select is(public._notification_local_slot(19, 0), 'reminder_19', '19:00 is inside the 19:00 slot');
select is(public._notification_local_slot(19, 9), 'reminder_19', '19:09 is still inside the 19:00 slot');
select is(public._notification_local_slot(19, 10), null, '19:10 is OUTSIDE the 19:00 slot (grace window ends)');
select is(public._notification_local_slot(19, 30), null, '19:30 is OUTSIDE the 19:00 slot — the fixed drift bug');
select is(public._notification_local_slot(19, 59), null, '19:59 is OUTSIDE the 19:00 slot');

select is(public._notification_local_slot(22, 0), 'reminder_22', '22:00 is inside the 22:00 slot');
select is(public._notification_local_slot(22, 9), 'reminder_22', '22:09 is still inside the 22:00 slot');
select is(public._notification_local_slot(22, 10), null, '22:10 is OUTSIDE the 22:00 slot');
select is(public._notification_local_slot(22, 30), null, '22:30 is OUTSIDE the 22:00 slot — the fixed drift bug');

select is(public._notification_local_slot(6, 29), null, '06:29 is OUTSIDE the 06:30 slot');
select is(public._notification_local_slot(6, 30), 'morning_report', '06:30 is inside the 06:30 slot');
select is(public._notification_local_slot(6, 39), 'morning_report', '06:39 is still inside the 06:30 slot');
select is(public._notification_local_slot(6, 40), null, '06:40 is OUTSIDE the 06:30 slot');

select is(public._notification_local_slot(12, 0), null, 'an arbitrary hour with no slot returns null');

-- A 5-minute tick cadence must land inside every 10-minute-wide window at
-- least once: every multiple of 5 from 0..55 that falls in a slot's first 10
-- minutes is caught (0 and 5 for each slot).
select is(public._notification_local_slot(19, 5), 'reminder_19', 'a :05 tick still catches the 19:00 slot');
select is(public._notification_local_slot(6, 35), 'morning_report', 'a :35 tick still catches the 06:30 slot');

-- ========================================================================
-- Section B — DST: the underlying local-time conversion is genuinely
-- wall-clock aware, not a fixed UTC offset — proven with literal timestamps
-- pinned to real Stockholm transition instants, never now().
-- ========================================================================
-- Winter (CET, UTC+1): 2026-01-15 18:00 UTC = 19:00 local.
select is(
  extract(hour from (timestamptz '2026-01-15 18:00:00+00' at time zone 'Europe/Stockholm'))::int,
  19, 'winter (CET, UTC+1): 18:00 UTC is 19:00 Stockholm local');
-- Summer (CEST, UTC+2): 2026-07-15 17:00 UTC = 19:00 local — a full hour
-- earlier in UTC than winter for the SAME local wall-clock time, proving
-- this is genuine local-time arithmetic, not a hardcoded offset.
select is(
  extract(hour from (timestamptz '2026-07-15 17:00:00+00' at time zone 'Europe/Stockholm'))::int,
  19, 'summer (CEST, UTC+2): 17:00 UTC is 19:00 Stockholm local');
-- Spring-forward instant (2026-03-29 01:00 UTC): the local wall clock jumps
-- from 01:59:59 CET straight to 03:00:00 CEST (02:00–02:59 never occurs).
select is(
  (timestamptz '2026-03-29 00:59:00+00' at time zone 'Europe/Stockholm')::text,
  '2026-03-29 01:59:00', 'one minute before spring-forward: still CET (UTC+1)');
select is(
  (timestamptz '2026-03-29 01:00:00+00' at time zone 'Europe/Stockholm')::text,
  '2026-03-29 03:00:00', 'spring-forward instant: local clock jumps straight to 03:00 CEST');
-- Fall-back instant (2026-10-25 01:00 UTC): local wall clock repeats
-- 02:00–02:59 (first as CEST, then as CET) — proven by two different UTC
-- instants an hour apart both mapping to local 02:30.
select is(
  (timestamptz '2026-10-25 00:30:00+00' at time zone 'Europe/Stockholm')::text,
  '2026-10-25 02:30:00', 'fall-back: 00:30 UTC is the FIRST local 02:30 (still CEST)');
select is(
  (timestamptz '2026-10-25 01:30:00+00' at time zone 'Europe/Stockholm')::text,
  '2026-10-25 02:30:00', 'fall-back: 01:30 UTC is the SECOND local 02:30 (now CET) — same local time as above');

-- ========================================================================
-- Section C — _join_swedish_names: never drops a name.
-- ========================================================================
select is(public._join_swedish_names(array[]::text[]), '', 'zero names joins to an empty string');
select is(public._join_swedish_names(array['Filip']), 'Filip', 'one name');
select is(public._join_swedish_names(array['Filip', 'David']), 'Filip och David', 'two names');
select is(public._join_swedish_names(array['Filip', 'David', 'Tomas']), 'Filip, David och Tomas', 'three names');
select is(
  public._join_swedish_names(array['Filip', 'David', 'Tomas', 'Anna']),
  'Filip, David, Tomas och Anna', 'four names — nobody silently omitted');

-- ========================================================================
-- Section D — _notification_morning_report_body: Game Master voice, real
-- amount (never hardcoded), deterministic variant selection.
-- ========================================================================
select is(
  public._notification_morning_report_body(null, 0, 0),
  'Ingen bommade igår. Julbordet blev utan bidrag. Ovanligt.', 'zero-missed, variant 0');
select is(
  public._notification_morning_report_body(null, 0, 1),
  'Alla tränade igår. Julbordet fick vila.', 'zero-missed, variant 1');
select is(
  public._notification_morning_report_body(null, 0, 2),
  'Full pott igår — ingen missade. Sällsynt syn.', 'zero-missed, variant 2');
select is(
  public._notification_morning_report_body(null, 0, 3),
  'Ingen bommade igår. Julbordet blev utan bidrag. Ovanligt.',
  'variant index wraps modulo the bank size (3 behaves like 0)');

select is(
  public._notification_morning_report_body(array['Filip'], 50, 0),
  'Gårdagens bommar: Filip. Julbordet tackar för 50 kr.', 'one missed, variant 0');
select is(
  public._notification_morning_report_body(array['Filip', 'David'], 100, 1),
  'Filip och David uteblev igår. Kassan är rikare med 100 kr.', 'two missed, variant 1');
select is(
  public._notification_morning_report_body(array['Filip', 'David', 'Tomas'], 150, 2),
  'Gårdagens missar: Filip, David och Tomas. 150 kr rakt in i Julbordet.', 'three missed, variant 2');
select is(
  public._notification_morning_report_body(array['X'], 999, 0),
  'Gårdagens bommar: X. Julbordet tackar för 999 kr.',
  'the amount is whatever the caller passes — never a hardcoded 50');

-- ========================================================================
-- Section E — end-to-end: real display names flow through the live
-- scheduler tick and the challenge's OWN missed_day_cost (25, not 50) is
-- used, deterministic-per-window like 0032's Section H.
-- ========================================================================
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000033a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-33a1@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-33a2@example.test', '{"display_name":"Filip"}', now(), now()),
  ('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-33a3@example.test', '{"display_name":"David"}', now(), now()),
  ('00000000-0000-0000-0000-0000000033a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-33a4@example.test', '{"display_name":"Anna"}', now(), now());
update public.profiles set display_name = 'Filip' where id = '00000000-0000-0000-0000-0000000033a2';
update public.profiles set display_name = 'David' where id = '00000000-0000-0000-0000-0000000033a3';
update public.profiles set display_name = 'Anna'  where id = '00000000-0000-0000-0000-0000000033a4';
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000033a1';

-- A fifth user who has an account but is NOT a member of any challenge in
-- this file — must never appear in a missed-names list or receive anything.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000033a5', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'notif-33a5@example.test', '{"display_name":"Utomstaende"}', now(), now());
update public.profiles set display_name = 'Utomstaende' where id = '00000000-0000-0000-0000-0000000033a5';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-000000033f01', 'Notif-Correction', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, false, 25, 'active', '00000000-0000-0000-0000-0000000033a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-000000033f01', '00000000-0000-0000-0000-0000000033a2', current_date - 10, true, '00000000-0000-0000-0000-0000000033a1'),
  ('00000000-0000-0000-0000-000000033f01', '00000000-0000-0000-0000-0000000033a3', current_date - 10, true, '00000000-0000-0000-0000-0000000033a1'),
  ('00000000-0000-0000-0000-000000033f01', '00000000-0000-0000-0000-0000000033a4', current_date - 10, true, '00000000-0000-0000-0000-0000000033a1');

-- Filip and David missed yesterday (no entry); Anna completed it.
insert into public.training_entries (challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-000000033f01', '00000000-0000-0000-0000-0000000033a4', current_date - 1, 40);

select lives_ok($$select public._notification_scheduler_tick()$$, 'scheduler tick runs without error against the new fixture');

select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000033f01' and category = 'daily_morning_report'),
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'morning_report' then 3 else 0 end,
  'inside the 06:30 window: all 3 eligible members get the report (0 otherwise)');

-- Only meaningful to check the body content when the tick actually fired —
-- guarded the same way 0032's Section H guards its hour-dependent counts.
select ok(
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'morning_report'
  then (
    select body ~ 'Filip' and body ~ 'David' and body !~ 'Anna'
      and body ~ '50 kr'  -- 2 missed x 25 SEK missed_day_cost
    from public.notification_outbox
    where challenge_id = '00000000-0000-0000-0000-000000033f01'
      and category = 'daily_morning_report'
    limit 1
  )
  else true
  end,
  'when the report fires, the body names exactly the real missed participants and uses the challenge''s own missed_day_cost (25), never a hardcoded 50 total');

select ok(
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'morning_report'
  then (
    select title = 'GAME MASTER'
    from public.notification_outbox
    where challenge_id = '00000000-0000-0000-0000-000000033f01'
      and category = 'daily_morning_report'
    limit 1
  )
  else true
  end,
  'the morning report title is the Game Master voice, never "Gårdagens resultat"');

-- ========================================================================
-- Section F — training invalidation / revalidation (personal_status)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000033a1","role":"authenticated"}', true);
select public.invalidate_training_session(
  (select id from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-000000033f01'
     and user_id = '00000000-0000-0000-0000-0000000033a4'),
  'testkorrigering');
set local role postgres;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'personal_status' and recipient_id = '00000000-0000-0000-0000-0000000033a4'
     and title = 'Träningspass ogiltigförklarat'),
  1, 'invalidating Annas training entry notifies her exactly once');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000033a1","role":"authenticated"}', true);
select public.revalidate_training_session(
  (select id from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-000000033f01'
     and user_id = '00000000-0000-0000-0000-0000000033a4'),
  'rattelse');
set local role postgres;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'personal_status' and recipient_id = '00000000-0000-0000-0000-0000000033a4'
     and title = 'Träningspass återställt'),
  1, 'revalidating it afterwards notifies her again, distinctly');

-- A second, later invalidate/revalidate cycle on the SAME entry must notify
-- again too — this is a rare, trusted, deliberate admin action each time,
-- not a user-toggle abuse case (unlike chat-like's collapsing dedupe).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000033a1","role":"authenticated"}', true);
select public.invalidate_training_session(
  (select id from public.training_entries
   where challenge_id = '00000000-0000-0000-0000-000000033f01'
     and user_id = '00000000-0000-0000-0000-0000000033a4'),
  'andra korrigeringen');
set local role postgres;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'personal_status' and recipient_id = '00000000-0000-0000-0000-0000000033a4'
     and title = 'Träningspass ogiltigförklarat'),
  2, 'a second, later invalidation of the same entry notifies again (not collapsed)');

-- ========================================================================
-- Section G — challenge lifecycle (personal_status)
-- ========================================================================
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-000000033f02', 'Notif-Lifecycle', current_date - 5, current_date + 20,
  'Europe/Stockholm', 30, false, 25, 'draft', '00000000-0000-0000-0000-0000000033a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-000000033f02', '00000000-0000-0000-0000-0000000033a2', current_date - 5, true, '00000000-0000-0000-0000-0000000033a1');

update public.challenges set status = 'active' where id = '00000000-0000-0000-0000-000000033f02';

select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000033f02' and category = 'personal_status'
     and title = 'Utmaningen har startat' and recipient_id = '00000000-0000-0000-0000-0000000033a2'),
  1, 'draft -> active notifies the eligible member that the challenge has started');

update public.challenges set status = 'completed' where id = '00000000-0000-0000-0000-000000033f02';

select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000033f02' and category = 'personal_status'
     and title = 'Utmaningen är slut' and recipient_id = '00000000-0000-0000-0000-0000000033a2'),
  1, 'active -> completed notifies the eligible member that the challenge is done');

-- Reopening (completed -> active) must NOT re-fire "challenge started".
update public.challenges set status = 'active' where id = '00000000-0000-0000-0000-000000033f02';

select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000033f02' and category = 'personal_status'
     and title = 'Utmaningen har startat'),
  1, 'reopening a completed challenge does not re-send "challenge started" (still exactly one, from the real start)');

select is(
  (select count(*)::int from public.notification_outbox
   where recipient_id = '00000000-0000-0000-0000-0000000033a5'),
  0, 'a non-participant (no membership at all) never receives any notification from this challenge');

select * from finish();
rollback;
