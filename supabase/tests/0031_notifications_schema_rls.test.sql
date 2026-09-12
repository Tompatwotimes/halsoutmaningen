-- ============================================================================
-- pgTAP — PWA + Web Push Notifications V1: schema, RLS, subscription /
--         preference RPCs / 0031
--
-- Proves docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §2, §6 as
-- delivered by 20260911090000_notifications_schema.sql and
-- 20260911090100_notifications_rpcs.sql.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(42);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000031a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-31a1@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000031a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-31a2@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000031a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'notif-31a3@example.test', '{"display_name":"Rune"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000031a1';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-000000031f01', 'Notif-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000031a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a2', current_date - 10, true, '00000000-0000-0000-0000-0000000031a1'),
  ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a3', current_date - 10, true, '00000000-0000-0000-0000-0000000031a1');

-- ========================================================================
-- Section A — schema shape
-- ========================================================================
select ok(
  (select column_default like '%true%' from information_schema.columns
   where table_schema='public' and table_name='challenges' and column_name='push_enabled'),
  'challenges.push_enabled defaults true');

select is(
  (select push_enabled from public.challenges where id = '00000000-0000-0000-0000-000000031f01'),
  true, 'an existing/new challenge row is push-enabled by default');

select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select has_table('public', 'notification_preferences', 'notification_preferences exists');
select has_table('public', 'notification_outbox', 'notification_outbox exists');
select has_table('public', 'notification_deliveries', 'notification_deliveries exists');

select col_is_pk('public', 'notification_preferences', array['user_id', 'challenge_id'],
  'notification_preferences PK is (user_id, challenge_id)');

select throws_ok($$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values ('00000000-0000-0000-0000-0000000031a2', 'https://push.example/e1', 'k', 'a'),
         ('00000000-0000-0000-0000-0000000031a3', 'https://push.example/e1', 'k2', 'a2')
$$, null, null, 'push_subscriptions.endpoint is UNIQUE');

select throws_ok($$
  insert into public.notification_outbox
    (challenge_id, recipient_id, category, natural_key, title, body, url, tag)
  values
    ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a2',
     'chat_reply', 'dup-key', 't', 'b', '/', 'tag-1'),
    ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a2',
     'chat_reply', 'dup-key', 't2', 'b2', '/', 'tag-2')
$$, null, null,
  'notification_outbox is unique on (challenge_id, recipient_id, category, natural_key)');

select throws_ok($$
  insert into public.notification_outbox
    (challenge_id, recipient_id, category, natural_key, title, body, url, tag)
  values
    ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a2',
     'chat_reply', 'abs-url', 't', 'b', 'https://evil.example/', 'tag-3')
$$, null, null, 'notification_outbox.url must be app-relative (starts with a single /)');

-- ========================================================================
-- Section B — RLS: owner-only tables
-- ========================================================================
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
values ('00000000-0000-0000-0000-0000000031a2', 'https://push.example/pia', 'kp', 'ap');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.push_subscriptions),
  1, 'the owner sees their own push_subscriptions row');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a3","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.push_subscriptions),
  0, 'a different member sees 0 push_subscriptions rows (no admin override)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.push_subscriptions),
  0, 'an admin does NOT see another user''s push_subscriptions row either');

select throws_ok($$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values ('00000000-0000-0000-0000-0000000031a1', 'https://push.example/forged', 'k', 'a')
$$, null, null, 'no direct INSERT policy on push_subscriptions (RPC only)');

set local role postgres;

-- A genuine outbox row so the admin-read assertion below has something real
-- to see — the two throws_ok blocks above deliberately fail atomically and
-- leave nothing committed.
insert into public.notification_outbox
  (challenge_id, recipient_id, category, natural_key, title, body, url, tag)
values ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a2',
  'chat_reply', 'seed-row', 'Titel', 'Text', '/', 'tag-seed');

-- notification_outbox / notification_deliveries: admin-only select, no writes
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a2","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.notification_outbox),
  0, 'an ordinary member reads 0 rows from notification_outbox');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a1","role":"authenticated"}', true);
select isnt(
  (select count(*)::int from public.notification_outbox),
  0, 'an admin CAN read notification_outbox');

select throws_ok($$
  insert into public.notification_outbox
    (challenge_id, recipient_id, category, natural_key, title, body, url, tag)
  values ('00000000-0000-0000-0000-000000031f01', '00000000-0000-0000-0000-0000000031a1',
    'chat_reply', 'forged', 't', 'b', '/', 'tag-x')
$$, null, null, 'no direct INSERT policy on notification_outbox, even for an admin');

set local role postgres;

-- _daily_first_completion_claims: fully invisible, no grant at all
select ok(
  not has_table_privilege('authenticated', 'public._daily_first_completion_claims', 'SELECT'),
  'authenticated has NO privilege at all on _daily_first_completion_claims');

-- ========================================================================
-- Section C — RPCs
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a3","role":"authenticated"}', true);

select lives_ok($$
  select public.register_push_subscription('https://push.example/rune-1', 'k1', 'a1', 'ua-1')
$$, 'Rune registers a subscription');

select is(
  (select count(*)::int from public.push_subscriptions
   where endpoint = 'https://push.example/rune-1'),
  1, 'exactly one row exists for the endpoint');

select lives_ok($$
  select public.register_push_subscription('https://push.example/rune-1', 'k2', 'a2', 'ua-2')
$$, 'registering the SAME endpoint again does not error');

select is(
  (select count(*)::int from public.push_subscriptions
   where endpoint = 'https://push.example/rune-1'),
  1, 'still exactly one row (upsert, not a duplicate)');

select is(
  (select p256dh from public.push_subscriptions where endpoint = 'https://push.example/rune-1'),
  'k2', 're-registering refreshes the keys in place');

select lives_ok($$
  select public.unregister_push_subscription('https://push.example/rune-1')
$$, 'Rune unregisters his own subscription');

select is(
  (select count(*)::int from public.push_subscriptions
   where endpoint = 'https://push.example/rune-1'),
  0, 'the row is gone after unregister');

select lives_ok($$
  select public.unregister_push_subscription('https://push.example/does-not-exist')
$$, 'unregistering a non-existent / someone else''s endpoint is a silent no-op');

-- get_notification_preferences: materialised defaults when no row exists
select is(
  (select chat_all_messages from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  false, 'chat_all_messages defaults to false with no stored row');
select is(
  (select chat_reply from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  true, 'chat_reply defaults to true with no stored row');
select is(
  (select count(*)::int from public.notification_preferences
   where user_id = '00000000-0000-0000-0000-0000000031a3'),
  0, 'get_notification_preferences does not write a row just by being read');

-- update_notification_preferences: partial upsert, NULL = unchanged
select lives_ok($$
  select public.update_notification_preferences('00000000-0000-0000-0000-000000031f01', p_chat_all_messages := true)
$$, 'Rune opts into chat_all_messages');

select is(
  (select chat_all_messages from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  true, 'chat_all_messages is now true');
select is(
  (select chat_reply from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  true, 'chat_reply is still true (untouched by the partial update)');

select lives_ok($$
  select public.update_notification_preferences('00000000-0000-0000-0000-000000031f01', p_chat_reply := false)
$$, 'Rune later disables chat_reply only');

select is(
  (select chat_reply from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  false, 'chat_reply is now false');
select is(
  (select chat_all_messages from public.get_notification_preferences('00000000-0000-0000-0000-000000031f01')),
  true, 'chat_all_messages remains true (the earlier partial update is not clobbered)');

set local role postgres;
select is(
  (select count(*)::int from public.notification_preferences
   where user_id = '00000000-0000-0000-0000-0000000031a3'
     and challenge_id = '00000000-0000-0000-0000-000000031f01'),
  1, 'exactly one preferences row exists after two partial updates (upsert, not duplicated)');

-- ========================================================================
-- Section D — try_claim_self_test_notification (rate limit + kill switch)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000031a3","role":"authenticated"}', true);

select is(
  (select public.try_claim_self_test_notification()),
  true, 'Runes first self-test claim succeeds');
select is(
  (select public.try_claim_self_test_notification()),
  false, 'an immediate second claim is rate limited');

set local role postgres;
update public._self_test_rate_limit
  set last_sent_at = now() - interval '61 seconds'
where user_id = '00000000-0000-0000-0000-0000000031a3';
set local role authenticated;

select is(
  (select public.try_claim_self_test_notification()),
  true, 'a claim after the 60s window has elapsed succeeds again');

set local role postgres;
update public.challenges set push_enabled = false
where id = '00000000-0000-0000-0000-000000031f01';
set local role authenticated;

select throws_ok($$
  select public.try_claim_self_test_notification()
$$, null, null,
  'the challenge kill switch also blocks self-test (no active push-enabled challenge)');

set local role postgres;
update public.challenges set push_enabled = true
where id = '00000000-0000-0000-0000-000000031f01';

-- ========================================================================
-- Section E — _claim_notification_outbox_batch respects the kill switch
-- ========================================================================
update public.challenges set push_enabled = false
where id = '00000000-0000-0000-0000-000000031f01';

select is(
  (select count(*)::int from public._claim_notification_outbox_batch(50, 'test-run')),
  0, 'a disabled challenge''s outbox row is not claimed while push is off');

update public.challenges set push_enabled = true
where id = '00000000-0000-0000-0000-000000031f01';

select is(
  (select count(*)::int from public._claim_notification_outbox_batch(50, 'test-run')),
  1, 'the same row is claimed once the challenge is re-enabled');

select * from finish();
rollback;
