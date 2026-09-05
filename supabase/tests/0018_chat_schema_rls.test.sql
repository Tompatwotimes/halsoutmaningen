-- ============================================================================
-- pgTAP — Shared Chat / 0018: chat_messages + chat_read_state schema + RLS.
--
--   * domain CHECKs: sender coherence, hidden coherence, body length 1..1000,
--     sender_type / status enums
--   * seq is unique and strictly increasing across inserts
--   * widened audit vocabulary accepts 'chat_message'
--   * RLS: a non-member reads nothing; a member reads every row of their
--     challenge (active AND hidden); a viewer sees only their own read cursor;
--     no role may INSERT / UPDATE / DELETE either table directly
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(26);

set local role postgres;

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000c1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-c1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-c1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-c1003@example.test', '{"display_name":"Ove"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000c1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-00000000cf01', 'Chat-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000c1001'),
  ('00000000-0000-0000-0000-00000000cf02', 'Chat-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000c1001');

-- Pia is a member of Chat-A only. Ove is a member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-0000000c1002',
        current_date - 10, true, '00000000-0000-0000-0000-0000000c1001');

-- ========================================================================
-- Section A — domain constraints (as postgres, RLS bypassed)
-- ========================================================================
select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant', null, 'x')$$,
  null, null, 'a participant message requires sender_user_id');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
    values ('00000000-0000-0000-0000-00000000cf01', 'game_master',
            '00000000-0000-0000-0000-0000000c1002', 'x')$$,
  null, null, 'a game_master message must not carry a sender_user_id');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, body)
    values ('00000000-0000-0000-0000-00000000cf01', 'bot', 'x')$$,
  null, null, 'sender_type must be participant or game_master');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant',
            '00000000-0000-0000-0000-0000000c1002', '')$$,
  null, null, 'an empty body is rejected');

select throws_ok(
  format($$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
           values ('00000000-0000-0000-0000-00000000cf01', 'participant',
                   '00000000-0000-0000-0000-0000000c1002', %L)$$, repeat('a', 1001)),
  null, null, 'a body of 1001 characters is rejected');

select lives_ok(
  format($$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
           values ('00000000-0000-0000-0000-00000000cf01', 'participant',
                   '00000000-0000-0000-0000-0000000c1002', %L)$$, repeat('a', 1000)),
  'a body of exactly 1000 characters is accepted');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, status)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant',
            '00000000-0000-0000-0000-0000000c1002', 'x', 'hidden')$$,
  null, null, 'a hidden message without the moderation trail is rejected');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body,
      status, hidden_at, hidden_by, hidden_reason)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant',
            '00000000-0000-0000-0000-0000000c1002', 'x',
            'active', now(), '00000000-0000-0000-0000-0000000c1001', 'skäl')$$,
  null, null, 'an active message must not carry moderation fields');

select lives_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body,
      status, hidden_at, hidden_by, hidden_reason)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant',
            '00000000-0000-0000-0000-0000000c1002', 'olämpligt',
            'hidden', now(), '00000000-0000-0000-0000-0000000c1001', 'fel ton')$$,
  'a coherent hidden message is accepted');

-- ---- seq strictly increasing (capture each insert's seq into a probe) ----
create temp table seq_probe (n int primary key, seq bigint not null);

with i as (
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000cf01', 'participant',
          '00000000-0000-0000-0000-0000000c1002', 's1')
  returning seq)
insert into seq_probe select 1, seq from i;

with i as (
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000cf01', 'participant',
          '00000000-0000-0000-0000-0000000c1002', 's2')
  returning seq)
insert into seq_probe select 2, seq from i;

with i as (
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000cf01', 'participant',
          '00000000-0000-0000-0000-0000000c1002', 's3')
  returning seq)
insert into seq_probe select 3, seq from i;

select ok(
  (select bool_and(later.seq > earlier.seq)
   from seq_probe earlier join seq_probe later on later.n = earlier.n + 1),
  'seq is strictly increasing in insertion order');
select is(
  (select count(distinct seq)::int from public.chat_messages),
  (select count(*)::int from public.chat_messages),
  'seq is unique across every row');

-- ---- audit vocabulary --------------------------------------------------
select lives_ok(
  $$insert into public.audit_log (actor_user_id, entity_type, action)
    values ('00000000-0000-0000-0000-0000000c1001', 'chat_message', 'chat_message_hidden')$$,
  'the audit vocabulary now accepts chat_message');

-- ---- read-state fixtures for the RLS section --------------------------
insert into public.chat_read_state (challenge_id, user_id, last_read_seq)
values
  ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-0000000c1002', 0),
  ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-0000000c1001', 0);

-- ========================================================================
-- Section B — RLS as Pia (member of Chat-A)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1002","role":"authenticated"}', true);

select ok(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000cf01') >= 4,
  'a member sees every message in their challenge, active and hidden');
select is(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000cf01' and status = 'hidden'),
  1, 'a member sees the hidden message as a real row (placeholder is display-only)');
select is(
  (select count(*)::int from public.chat_read_state), 1,
  'a viewer sees only their own read-state row');
select is(
  (select user_id from public.chat_read_state),
  '00000000-0000-0000-0000-0000000c1002'::uuid, 'and it is their own');

select throws_ok(
  $$insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
    values ('00000000-0000-0000-0000-00000000cf01', 'participant',
            '00000000-0000-0000-0000-0000000c1002', 'direct')$$,
  null, null, 'a participant cannot INSERT a chat_messages row directly');
select throws_ok(
  $$update public.chat_messages set body = 'edited'
    where challenge_id = '00000000-0000-0000-0000-00000000cf01'$$,
  null, null, 'a participant cannot UPDATE a chat_messages row directly');
select throws_ok(
  $$delete from public.chat_messages
    where challenge_id = '00000000-0000-0000-0000-00000000cf01'$$,
  null, null, 'a participant cannot DELETE a chat_messages row directly');
select throws_ok(
  $$insert into public.chat_read_state (challenge_id, user_id, last_read_seq)
    values ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-0000000c1002', 99)$$,
  null, null, 'a participant cannot INSERT a chat_read_state row directly');
select throws_ok(
  $$update public.chat_read_state set last_read_seq = 99$$,
  null, null, 'a participant cannot UPDATE a chat_read_state row directly');

-- ========================================================================
-- Section C — RLS as Ove (member of nothing)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1003","role":"authenticated"}', true);

select is((select count(*)::int from public.chat_messages), 0,
  'a non-member reads no chat_messages at all');
select is((select count(*)::int from public.chat_read_state), 0,
  'a non-member reads no chat_read_state at all');

-- ========================================================================
-- Section D — RLS as admin
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1001","role":"authenticated"}', true);

select ok(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000cf01') >= 4,
  'an admin sees every message in every challenge');
select is(
  (select count(*)::int from public.chat_read_state), 1,
  'an admin still sees only their own read-state row (no admin bypass on chat_read_state)');

-- ========================================================================
-- Section E — cross-challenge isolation
-- ========================================================================
set local role postgres;
insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
values ('00000000-0000-0000-0000-00000000cf02', 'game_master', null, 'systemmeddelande i B');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000cf02'),
  0, 'a member of Chat-A cannot read Chat-B''s room');

select * from finish();
rollback;
