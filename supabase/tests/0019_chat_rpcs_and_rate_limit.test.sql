-- ============================================================================
-- pgTAP — Shared Chat / 0019: post_chat_message + mark_chat_read.
--
--   post_chat_message
--     * non-member rejected; active member accepted
--     * sender_user_id is ALWAYS the caller; sender_type ALWAYS 'participant'
--       (the function has exactly two params — no way to influence either)
--     * empty / whitespace body rejected; exactly 1000 chars ok; 1001 rejected
--     * 11th message inside a rolling 30s window rejected; the window is
--       rolling, not a lifetime cap
--   mark_chat_read
--     * seq from another challenge rejected
--     * last_read_seq never moves backwards; idempotent
--     * non-member rejected; last_read_message_id stays consistent with seq
--
-- (hide_chat_message is covered by additions to this file in the next task.)
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(34);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-d1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-d1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-d1003@example.test', '{"display_name":"Ove"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-d1004@example.test', '{"display_name":"Rex"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-d1005@example.test', '{"display_name":"Max"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000d1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-00000000df01', 'Chat-RPC-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000d1001'),
  ('00000000-0000-0000-0000-00000000df02', 'Chat-RPC-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000d1001');

-- Pia, Rex, Max are active members of A. Nobody is a member of B. Ove is a
-- member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-00000000df01', '00000000-0000-0000-0000-0000000d1002', current_date - 10, true, '00000000-0000-0000-0000-0000000d1001'),
  ('00000000-0000-0000-0000-00000000df01', '00000000-0000-0000-0000-0000000d1004', current_date - 10, true, '00000000-0000-0000-0000-0000000d1001'),
  ('00000000-0000-0000-0000-00000000df01', '00000000-0000-0000-0000-0000000d1005', current_date - 10, true, '00000000-0000-0000-0000-0000000d1001');

-- ========================================================================
-- Section A — post_chat_message signature and impersonation surface
-- ========================================================================
select is(
  pg_get_function_arguments('public.post_chat_message(uuid, text)'::regprocedure),
  'p_challenge_id uuid, p_body text',
  'post_chat_message takes exactly a challenge id and a body — no sender field');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1003","role":"authenticated"}', true);
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', 'hej')$$,
  null, null, 'a non-member cannot post');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1002","role":"authenticated"}', true);

select is(
  (select (public.post_chat_message('00000000-0000-0000-0000-00000000df01', '  hej Pia  ')).sender_user_id),
  '00000000-0000-0000-0000-0000000d1002'::uuid,
  'the inserted row''s sender_user_id is always the caller');
-- Read the written row back through the members' surface (a non-admin has no
-- direct SELECT on chat_messages since 20260905140200).
select is(
  (select sender_type from public.list_chat_messages('00000000-0000-0000-0000-00000000df01')
   where sender_user_id = '00000000-0000-0000-0000-0000000d1002' limit 1),
  'participant', 'and sender_type is always participant');
select is(
  (select body from public.list_chat_messages('00000000-0000-0000-0000-00000000df01')
   where sender_user_id = '00000000-0000-0000-0000-0000000d1002' limit 1),
  'hej Pia', 'the body is trimmed');

select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', '   ')$$,
  null, null, 'a whitespace-only body is rejected');
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', '')$$,
  null, null, 'an empty body is rejected');
select lives_ok(
  format($$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', %L)$$, repeat('x', 1000)),
  'a 1000-character body is accepted');
select throws_ok(
  format($$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', %L)$$, repeat('x', 1001)),
  null, null, 'a 1001-character body is rejected');

-- ========================================================================
-- Section B — rate limit: 10 / rolling 30s
-- ========================================================================
-- Rex has posted nothing yet. 10 posts in this transaction (created_at ~ now())
-- all succeed; the 11th is refused.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1004","role":"authenticated"}', true);

do $$
begin
  for i in 1..10 loop
    perform public.post_chat_message('00000000-0000-0000-0000-00000000df01', 'rex ' || i);
  end loop;
end $$;

select is(
  (select count(*)::int from public.list_chat_messages('00000000-0000-0000-0000-00000000df01')
   where sender_user_id = '00000000-0000-0000-0000-0000000d1004'),
  10, 'the first 10 messages in the window are accepted');
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', 'rex 11')$$,
  null, null, 'the 11th message inside the 30s window is refused');

-- Max's 10 messages are all older than 30 seconds -> the window is empty ->
-- an 11th succeeds. Proves the limit is a ROLLING window, not a lifetime cap.
set local role postgres;
insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, created_at)
select '00000000-0000-0000-0000-00000000df01', 'participant',
       '00000000-0000-0000-0000-0000000d1005', 'max ' || g, now() - interval '40 seconds'
from generate_series(1, 10) g;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1005","role":"authenticated"}', true);
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-00000000df01', 'max nu')$$,
  'a message succeeds when the caller''s prior 10 are all outside the 30s window');

-- ========================================================================
-- Section C — mark_chat_read
-- ========================================================================
set local role postgres;
-- capture three real seq values in Chat-RPC-A and one in Chat-RPC-B.
-- The temp table is read back later under `role authenticated` (inside the
-- format() subqueries), so it needs an explicit grant — same pattern as
-- 0017's `cancel_event` temp table.
create temp table rp (label text primary key, seq bigint not null);
grant select on rp to authenticated;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1002', 'r-a1') returning seq)
insert into rp select 'a1', seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1002', 'r-a2') returning seq)
insert into rp select 'a2', seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1002', 'r-a3') returning seq)
insert into rp select 'a3', seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000df02', 'game_master', null, 'r-b1') returning seq)
insert into rp select 'b1', seq from i;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1002","role":"authenticated"}', true);

-- seq from Chat-RPC-B, called for Chat-RPC-A -> rejected
select throws_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000df01', %s)$$,
    (select seq from rp where label = 'b1')),
  null, null, 'a seq that belongs to another challenge is rejected');

-- advance to a3, then try to regress to a1 -> stays at a3
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000df01', %s)$$,
    (select seq from rp where label = 'a3')),
  'a member can advance their read cursor');
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000df01', %s)$$,
    (select seq from rp where label = 'a1')),
  'calling again with an earlier seq does not error');
select is(
  (select last_read_seq from public.chat_read_state
   where challenge_id = '00000000-0000-0000-0000-00000000df01'
     and user_id = '00000000-0000-0000-0000-0000000d1002'),
  (select seq from rp where label = 'a3'),
  'last_read_seq never moves backwards');
-- Pia (a non-admin member) can no longer SELECT chat_messages directly; check
-- last_read_message_id points at the right row via list_chat_messages.
select is(
  (select cm.body from public.chat_read_state crs
   join public.list_chat_messages('00000000-0000-0000-0000-00000000df01') cm
     on cm.id = crs.last_read_message_id
   where crs.challenge_id = '00000000-0000-0000-0000-00000000df01'
     and crs.user_id = '00000000-0000-0000-0000-0000000d1002'),
  'r-a3', 'last_read_message_id stays consistent with last_read_seq');

-- idempotent: repeating the a3 mark leaves state unchanged
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000df01', %s)$$,
    (select seq from rp where label = 'a3')),
  'mark_chat_read is idempotent');
select is(
  (select last_read_seq from public.chat_read_state
   where challenge_id = '00000000-0000-0000-0000-00000000df01'
     and user_id = '00000000-0000-0000-0000-0000000d1002'),
  (select seq from rp where label = 'a3'),
  'and the cursor is still at a3');

-- non-member of Chat-RPC-B cannot mark read there
select throws_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000df02', %s)$$,
    (select seq from rp where label = 'b1')),
  null, null, 'a non-member cannot mark a challenge''s room read');

-- ========================================================================
-- Section D — unread count formula (spec §3.4)
-- ========================================================================
-- Pia's cursor is at a3. Add 3 fresh messages after it and hide one; the
-- unread count must be exactly 3 (a hidden row still occupies a seq and still
-- counts — the placeholder is display-only).
set local role postgres;
insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
values
  ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1004', 'd-1'),
  ('00000000-0000-0000-0000-00000000df01', 'game_master', null, 'd-2 systemmeddelande'),
  ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1004', 'd-3');
update public.chat_messages
  set status = 'hidden', hidden_at = now(),
      hidden_by = '00000000-0000-0000-0000-0000000d1001', hidden_reason = 'test'
  where challenge_id = '00000000-0000-0000-0000-00000000df01' and body = 'd-3';

select is(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000df01'
     and seq > (select coalesce(last_read_seq, 0) from public.chat_read_state
                where challenge_id = '00000000-0000-0000-0000-00000000df01'
                  and user_id = '00000000-0000-0000-0000-0000000d1002')),
  3, 'the unread count is exactly the messages after the cursor, hidden ones included');

-- ========================================================================
-- Section E — hide_chat_message (admin moderation)
-- ========================================================================
set local role postgres;
-- a plain participant message and a game_master message to moderate
insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
values
  ('00000000-0000-0000-0000-00000000df01', 'participant', '00000000-0000-0000-0000-0000000d1004', 'e-participant-msg'),
  ('00000000-0000-0000-0000-00000000df01', 'game_master', null, 'e-gm-msg');

-- participant cannot hide
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1002","role":"authenticated"}', true);
select throws_ok(
  format($$select public.hide_chat_message(%L, 'jag ogillar det')$$,
    (select id from public.list_chat_messages('00000000-0000-0000-0000-00000000df01')
     where body = 'e-participant-msg')),
  null, null, 'a participant cannot hide a message');

-- admin: empty reason rejected
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1001","role":"authenticated"}', true);
select throws_ok(
  format($$select public.hide_chat_message(%L, '   ')$$,
    (select id from public.chat_messages where body = 'e-participant-msg')),
  null, null, 'hiding with a whitespace-only reason is rejected');

-- admin: hides a game_master message is refused
select throws_ok(
  format($$select public.hide_chat_message(%L, 'fel')$$,
    (select id from public.chat_messages where body = 'e-gm-msg')),
  null, null, 'a game_master message cannot be hidden via hide_chat_message');

-- admin: hides the participant message
select lives_ok(
  format($$select public.hide_chat_message(%L, 'Bild matchar inte innehållet')$$,
    (select id from public.chat_messages where body = 'e-participant-msg')),
  'an admin can hide a participant message with a reason');

set local role postgres;
select is(
  (select status from public.chat_messages where body = 'e-participant-msg'),
  'hidden', 'the message status is now hidden');
select is(
  (select hidden_by from public.chat_messages where body = 'e-participant-msg'),
  '00000000-0000-0000-0000-0000000d1001'::uuid, 'hidden_by records the admin');
select is(
  (select hidden_reason from public.chat_messages where body = 'e-participant-msg'),
  'Bild matchar inte innehållet', 'hidden_reason records the reason');
select ok(
  (select hidden_at is not null from public.chat_messages where body = 'e-participant-msg'),
  'hidden_at is set');
select is(
  (select body from public.chat_messages where body = 'e-participant-msg'),
  'e-participant-msg', 'the original body is retained in storage, not blanked');

select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'chat_message' and action = 'chat_message_hidden'
     and entity_id = (select id from public.chat_messages where body = 'e-participant-msg')),
  1, 'exactly one audit row is written');
select is(
  (select actor_user_id from public.audit_log
   where entity_type = 'chat_message' and action = 'chat_message_hidden'
     and entity_id = (select id from public.chat_messages where body = 'e-participant-msg')),
  '00000000-0000-0000-0000-0000000d1001'::uuid, 'the audit row records the admin as actor');
select is(
  (select target_user_id from public.audit_log
   where entity_type = 'chat_message' and action = 'chat_message_hidden'
     and entity_id = (select id from public.chat_messages where body = 'e-participant-msg')),
  '00000000-0000-0000-0000-0000000d1004'::uuid, 'the audit row records the original sender as target');
select ok(
  position('e-participant-msg' in (
    select coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(note, '')
    from public.audit_log
    where entity_type = 'chat_message' and action = 'chat_message_hidden'
      and entity_id = (select id from public.chat_messages where body = 'e-participant-msg'))) = 0,
  'the audit row carries no message body text');

select * from finish();
rollback;
