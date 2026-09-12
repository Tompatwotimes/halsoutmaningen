-- ============================================================================
-- pgTAP — PWA + Web Push Notifications V1: producer triggers + scheduler / 0032
--
-- Proves docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §3-§4 as
-- delivered by 20260911090200_notifications_producers.sql and
-- 20260911090300_notifications_scheduler.sql.
--
-- Hour-dependent scheduler assertions follow the SAME deterministic-per-window
-- pattern as 0017_game_master_rls_audit_cron.test.sql's dispatcher section:
-- the expected count is computed FROM the actual wall-clock hour at test-run
-- time, never mocked.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(35);

set local role postgres;
reset request.jwt.claims;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000032a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-32a1@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000032a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-32a2@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000032a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-32a3@example.test', '{"display_name":"Rune"}', now(), now()),
  ('00000000-0000-0000-0000-0000000032a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-32a4@example.test', '{"display_name":"Vera"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000032a1';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-000000032f01', 'Notif-Producers', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, false, 50, 'active', '00000000-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-000000032f02', 'Notif-Scheduler', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, false, 50, 'active', '00000000-0000-0000-0000-0000000032a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-0000000032a2', current_date - 10, true, '00000000-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-0000000032a3', current_date - 10, true, '00000000-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-0000000032a4', current_date - 10, true, '00000000-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-000000032f02', '00000000-0000-0000-0000-0000000032a2', current_date - 10, true, '00000000-0000-0000-0000-0000000032a1');

-- ========================================================================
-- Section A — chat reply
-- ========================================================================
insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values ('00000000-0000-0000-0000-0000000032c1', '00000000-0000-0000-0000-000000032f01',
  'participant', '00000000-0000-0000-0000-0000000032a2', 'Pias meddelande');

insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
values ('00000000-0000-0000-0000-0000000032c2', '00000000-0000-0000-0000-000000032f01',
  'participant', '00000000-0000-0000-0000-0000000032a3', 'Runes svar', '00000000-0000-0000-0000-0000000032c1');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_reply' and recipient_id = '00000000-0000-0000-0000-0000000032a2'
     and natural_key = '00000000-0000-0000-0000-0000000032c2'),
  1, 'Runes reply enqueues one chat_reply notification for Pia');
select is(
  (select source_message_id from public.notification_outbox
   where category = 'chat_reply' and natural_key = '00000000-0000-0000-0000-0000000032c2'),
  '00000000-0000-0000-0000-0000000032c2'::uuid,
  'the reply row records its own message id so the dispatcher can re-check moderation state at send time');

insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
values ('00000000-0000-0000-0000-0000000032c3', '00000000-0000-0000-0000-000000032f01',
  'participant', '00000000-0000-0000-0000-0000000032a2', 'Pia svarar sig själv', '00000000-0000-0000-0000-0000000032c1');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_reply' and natural_key = '00000000-0000-0000-0000-0000000032c3'),
  0, 'a self-reply never enqueues a notification');

-- ========================================================================
-- Section B — chat like
-- ========================================================================
insert into public.chat_message_likes (message_id, challenge_id, user_id)
values ('00000000-0000-0000-0000-0000000032c1', '00000000-0000-0000-0000-000000032f01',
  '00000000-0000-0000-0000-0000000032a3');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_like' and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  1, 'Rune liking Pias message enqueues one chat_like notification for Pia');
select is(
  (select source_message_id from public.notification_outbox
   where category = 'chat_like' and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  '00000000-0000-0000-0000-0000000032c1'::uuid,
  'the like row records the liked message id, not the like relation itself');

insert into public.chat_message_likes (message_id, challenge_id, user_id)
values ('00000000-0000-0000-0000-0000000032c1', '00000000-0000-0000-0000-000000032f01',
  '00000000-0000-0000-0000-0000000032a2');

select is(
  (select count(*)::int from public.notification_outbox where category = 'chat_like'),
  1, 'Pia liking her own message never enqueues a notification (still just one row)');

-- Unlike/re-like abuse case: `chat_message_likes` has no `liked` boolean to
-- flip — unlike is a physical DELETE and a re-like is a fresh INSERT (see
-- set_chat_message_like), so the trigger fires again with a brand-new
-- created_at each time. The dedupe key must be (message, liker) ONLY —
-- never a timestamp — or a like/unlike/like cycle would spam pushes.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000032a3","role":"authenticated"}', true);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000032c1', false);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000032c1', true);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000032c1', false);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000032c1', true);
set local role postgres;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_like' and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  1, 'Rune unliking then re-liking Pias message twice still enqueues only ONE like push ever');
select is(
  (select count(*)::int from public.chat_message_likes
   where message_id = '00000000-0000-0000-0000-0000000032c1'
     and user_id = '00000000-0000-0000-0000-0000000032a3'),
  1, 'Rune''s like is genuinely active again (delete/insert cycle completed on a like)');

-- ========================================================================
-- Section C — chat "all messages" (opt-in)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000032a4","role":"authenticated"}', true);
select public.update_notification_preferences('00000000-0000-0000-0000-000000032f01', p_chat_all_messages := true);
set local role postgres;
reset request.jwt.claims;

insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values ('00000000-0000-0000-0000-0000000032c4', '00000000-0000-0000-0000-000000032f01',
  'participant', '00000000-0000-0000-0000-0000000032a3', 'Runes tredje meddelande');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_all' and recipient_id = '00000000-0000-0000-0000-0000000032a4'
     and natural_key = '00000000-0000-0000-0000-0000000032c4'),
  1, 'Vera (opted in) gets a chat_all notification for Runes new message');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_all' and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  0, 'Pia (not opted in) gets no chat_all notification');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'chat_all' and recipient_id = '00000000-0000-0000-0000-0000000032a3'),
  0, 'the sender never gets a chat_all notification for their own message');

-- ========================================================================
-- Section D — Straffbanken
-- ========================================================================
insert into public.challenge_penalty_definitions
  (id, challenge_id, unlock_streak, penalty_type, value, display_name)
values ('00000000-0000-0000-0000-000000032d01', '00000000-0000-0000-0000-000000032f01',
  7, 'minimum_minutes', 45, 'Skärpta krav');

insert into public.earned_penalties
  (id, challenge_id, user_id, penalty_definition_id, streak_run_start,
   penalty_type, value, display_name, earned_on_date)
values ('00000000-0000-0000-0000-000000032d02', '00000000-0000-0000-0000-000000032f01',
  '00000000-0000-0000-0000-0000000032a3', '00000000-0000-0000-0000-000000032d01',
  current_date - 10, 'minimum_minutes', 45, 'Skärpta krav', current_date - 3);

insert into public.penalty_assignments
  (challenge_id, earned_penalty_id, from_user_id, to_user_id, target_date,
   penalty_type, value, display_name)
values ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-000000032d02',
  '00000000-0000-0000-0000-0000000032a1', '00000000-0000-0000-0000-0000000032a3',
  current_date - 3, 'minimum_minutes', 45, 'Skärpta krav');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'straffbanken' and recipient_id = '00000000-0000-0000-0000-0000000032a3'),
  1, 'assigning a penalty to Rune enqueues one straffbanken notification for him');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'straffbanken' and recipient_id = '00000000-0000-0000-0000-0000000032a1'),
  0, 'the assigning admin never gets a straffbanken notification');

-- ========================================================================
-- Section E — Game Master
-- ========================================================================
-- Rune opts out of Game Master pushes ahead of the public event below.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000032a3","role":"authenticated"}', true);
select public.update_notification_preferences('00000000-0000-0000-0000-000000032f01', p_game_master := false);
set local role postgres;
reset request.jwt.claims;

insert into public.game_master_events
  (id, challenge_id, family, visibility, severity, title_text, body_text)
values ('00000000-0000-0000-0000-000000032e01', '00000000-0000-0000-0000-000000032f01',
  'roast', 'public', 2, 'Titel', 'Text');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'game_master' and natural_key = '00000000-0000-0000-0000-000000032e01'
     and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  1, 'Pia gets the public GM event notification');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'game_master' and natural_key = '00000000-0000-0000-0000-000000032e01'
     and recipient_id = '00000000-0000-0000-0000-0000000032a3'),
  0, 'Rune (opted out of game_master) does not get it');

insert into public.game_master_events
  (id, challenge_id, family, visibility, subject_user_id, severity, title_text, body_text)
values ('00000000-0000-0000-0000-000000032e02', '00000000-0000-0000-0000-000000032f01',
  'roast', 'private', '00000000-0000-0000-0000-0000000032a2', 2, 'Titel', 'Text');

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'game_master' and natural_key = '00000000-0000-0000-0000-000000032e02'),
  1, 'a private GM event enqueues exactly one notification (its subject only)');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'game_master' and natural_key = '00000000-0000-0000-0000-000000032e02'
     and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  1, 'and it is addressed to the subject');

insert into public.game_master_events
  (id, challenge_id, family, visibility, severity, title_text, body_text, push_enabled)
values ('00000000-0000-0000-0000-000000032e03', '00000000-0000-0000-0000-000000032f01',
  'roast', 'public', 2, 'Titel', 'Text', false);

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'game_master' and natural_key = '00000000-0000-0000-0000-000000032e03'),
  0, 'push_enabled = false on the event suppresses every notification for it');

-- ========================================================================
-- Section F — Daily group: first completed day (atomic claim)
-- ========================================================================
insert into public.training_entries (challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-0000000032a2', current_date, 60);

select is(
  (select count(*)::int from public._daily_first_completion_claims
   where challenge_id = '00000000-0000-0000-0000-000000032f01' and challenge_date = current_date),
  1, 'exactly one claim row exists for todays first completion');
select is(
  (select claimed_by from public._daily_first_completion_claims
   where challenge_id = '00000000-0000-0000-0000-000000032f01' and challenge_date = current_date),
  '00000000-0000-0000-0000-0000000032a2'::uuid, 'Pia is recorded as the claimant');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'daily_first_completed' and natural_key = current_date::text),
  2, 'the other two eligible members (Rune, Vera) each get one notification');
select is(
  (select count(*)::int from public.notification_outbox
   where category = 'daily_first_completed' and natural_key = current_date::text
     and recipient_id = '00000000-0000-0000-0000-0000000032a2'),
  0, 'the completer herself never gets her own "first completed" notification');

insert into public.training_entries (challenge_id, user_id, challenge_date, duration_minutes)
values ('00000000-0000-0000-0000-000000032f01', '00000000-0000-0000-0000-0000000032a3', current_date, 60);

select is(
  (select count(*)::int from public._daily_first_completion_claims
   where challenge_id = '00000000-0000-0000-0000-000000032f01' and challenge_date = current_date),
  1, 'a second completion the same day does NOT create a second claim');
select is(
  (select count(*)::int from public.notification_outbox where category = 'daily_first_completed'),
  2, 'and enqueues no additional notifications');

-- ========================================================================
-- Section G — personal status (retroactive registration decided)
-- ========================================================================
insert into public.retroactive_training_requests
  (id, challenge_id, user_id, challenge_date, participant_reason, status)
values ('00000000-0000-0000-0000-000000032b01', '00000000-0000-0000-0000-000000032f01',
  '00000000-0000-0000-0000-0000000032a4', current_date - 5, 'glömde logga', 'pending');

update public.retroactive_training_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-0000000032a1'
where id = '00000000-0000-0000-0000-000000032b01';

select is(
  (select count(*)::int from public.notification_outbox
   where category = 'personal_status' and recipient_id = '00000000-0000-0000-0000-0000000032a4'
     and natural_key = '00000000-0000-0000-0000-000000032b01'),
  1, 'approving Veras retroactive request enqueues one personal_status notification');
select is(
  (select title from public.notification_outbox
   where category = 'personal_status' and natural_key = '00000000-0000-0000-0000-000000032b01'),
  'Efterregistrering godkänd', 'the copy reflects approval');

insert into public.retroactive_training_requests
  (id, challenge_id, user_id, challenge_date, participant_reason, status)
values ('00000000-0000-0000-0000-000000032b02', '00000000-0000-0000-0000-000000032f01',
  '00000000-0000-0000-0000-0000000032a4', current_date - 6, 'glömde igen', 'pending');

update public.retroactive_training_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-0000000032a1',
      review_note = 'ingen bild'
where id = '00000000-0000-0000-0000-000000032b02';

select is(
  (select title from public.notification_outbox
   where category = 'personal_status' and natural_key = '00000000-0000-0000-0000-000000032b02'),
  'Efterregistrering avslagen', 'a rejection gets its own copy');

-- ========================================================================
-- Section H — scheduler (deterministic-per-window, mirrors 0017's dispatcher)
-- ========================================================================
select lives_ok($$select public._notification_scheduler_tick()$$, 'first scheduler tick runs without error');
select lives_ok($$select public._notification_scheduler_tick()$$, 'second scheduler tick (same call) runs without error');

-- NOTE: gated on the exact 10-minute local-time SLOT
-- (public._notification_local_slot), not a bare hour match — the
-- POST-RELEASE CORRECTION (20260912100000) fixed the scheduler firing
-- ~19:30/22:30 instead of ~19:00/22:00. A bare hour-match here would pass
-- even with that bug still present (it would be right for 50 of every 60
-- minutes and silently wrong the other 10) — matching the precise slot is
-- the whole point of this assertion.
select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000032f02' and category = 'training_reminder_19'),
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'reminder_19' then 1 else 0 end,
  'a 19:00 reminder is enqueued only inside the exact 19:00-19:09 local window');
select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000032f02' and category = 'training_reminder_22'),
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'reminder_22' then 1 else 0 end,
  'a 22:00 reminder is enqueued only inside the exact 22:00-22:09 local window');
select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000032f02' and category = 'daily_morning_report'),
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) = 'morning_report' then 1 else 0 end,
  'a 06:30-window morning report is enqueued only inside the exact 06:30-06:39 local window');

-- f01's members already completed today (Section F), so nobody there is
-- 'pending' — the reminder must never fire for someone who has finished.
select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000032f01'
     and category in ('training_reminder_19', 'training_reminder_22')
     and recipient_id in ('00000000-0000-0000-0000-0000000032a2', '00000000-0000-0000-0000-0000000032a3')),
  0, 'a member who already completed today never gets a training reminder');

update public.challenges set push_enabled = false where id = '00000000-0000-0000-0000-000000032f02';
select lives_ok($$select public._notification_scheduler_tick()$$, 'a third tick after disabling f02 runs without error');
select is(
  (select count(*)::int from public.notification_outbox
   where challenge_id = '00000000-0000-0000-0000-000000032f02'
     and category in ('training_reminder_19', 'training_reminder_22', 'daily_morning_report')),
  case when public._notification_local_slot(
    extract(hour from (now() at time zone 'Europe/Stockholm'))::int,
    extract(minute from (now() at time zone 'Europe/Stockholm'))::int
  ) is not null then 1 else 0 end,
  'disabling push mid-window does not retroactively remove what was already enqueued, and enqueues nothing further');

select * from finish();
rollback;
