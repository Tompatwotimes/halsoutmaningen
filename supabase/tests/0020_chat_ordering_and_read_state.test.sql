-- ============================================================================
-- pgTAP — Shared Chat / 0020: seq ordering, upward pagination, read-state.
--
-- A standalone, from-scratch proof of the ordering / pagination / unread
-- contract that 0018–0019's schema and RPCs establish (spec §2.2, §3.2, §3.4).
-- It documents the contract independently of the feature commits, the same way
-- 0017 is a dedicated isolation proof for Game Master.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(9);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000e2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-e2001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000e2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-e2002@example.test', '{"display_name":"Pia"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000e2001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-00000000ef01', 'Chat-Order', current_date - 10, current_date + 20,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000e2001');
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000ef01', '00000000-0000-0000-0000-0000000e2002',
  current_date - 10, true, '00000000-0000-0000-0000-0000000e2001');

-- ---- 5 messages, capture each seq in insertion order --------------------
-- Read back later under `role authenticated` (inside format() subqueries),
-- so the temp table needs an explicit grant — same pattern as 0017's
-- `cancel_event` temp table.
create temp table m (n int primary key, seq bigint not null, id uuid not null);
grant select on m to authenticated;

with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ef01', 'participant', '00000000-0000-0000-0000-0000000e2002', 'm1')
  returning seq, id)
insert into m select 1, seq, id from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ef01', 'participant', '00000000-0000-0000-0000-0000000e2002', 'm2')
  returning seq, id)
insert into m select 2, seq, id from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ef01', 'game_master', null, 'm3 systemmeddelande')
  returning seq, id)
insert into m select 3, seq, id from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ef01', 'participant', '00000000-0000-0000-0000-0000000e2002', 'm4')
  returning seq, id)
insert into m select 4, seq, id from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ef01', 'participant', '00000000-0000-0000-0000-0000000e2002', 'm5')
  returning seq, id)
insert into m select 5, seq, id from i;

-- m4 is moderated after the fact — it keeps its seq and still counts.
update public.chat_messages
  set status = 'hidden', hidden_at = now(),
      hidden_by = '00000000-0000-0000-0000-0000000e2001', hidden_reason = 'test'
  where id = (select id from m where n = 4);

-- ---- ordering -----------------------------------------------------------
select ok(
  (select bool_and(later.seq > earlier.seq)
   from m earlier join m later on later.n = earlier.n + 1),
  'seq is strictly increasing in insertion order across all five rows');

-- ---- upward pagination -------------------------------------------------
-- "load the two messages immediately before m4" -> m3, then m2 (seq desc).
select is(
  (select array_agg(body order by seq desc)
   from (
     select body, seq from public.chat_messages
     where challenge_id = '00000000-0000-0000-0000-00000000ef01'
       and seq < (select seq from m where n = 4)
     order by seq desc
     limit 2
   ) page),
  array['m3 systemmeddelande', 'm2'],
  'upward pagination (seq < cursor, seq desc, limit 2) returns the two prior messages in order');

select is(
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000ef01'
     and seq < (select seq from m where n = 1)),
  0, 'there is nothing before the first message');

-- ---- unread count (spec §3.4) ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000e2002","role":"authenticated"}', true);

-- cursor at m2 -> unread is m3, m4 (hidden, still counts), m5 = 3
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000ef01', %s)$$,
    (select seq from m where n = 2)),
  'a member advances their cursor to m2');
-- A non-admin member has no direct read of chat_messages — the exact unread
-- count comes from unread_chat_count (which reads their own cursor server-side).
select is(
  public.unread_chat_count('00000000-0000-0000-0000-00000000ef01'),
  3, 'unread = 3 (m3, hidden m4, m5) — a hidden row still occupies a seq and counts');

-- ---- read state never regresses -------------------------------------
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000ef01', %s)$$,
    (select seq from m where n = 5)),
  'the member advances to m5');
select lives_ok(
  format($$select public.mark_chat_read('00000000-0000-0000-0000-00000000ef01', %s)$$,
    (select seq from m where n = 1)),
  'calling again with m1''s seq does not error');
select is(
  (select last_read_seq from public.chat_read_state
   where challenge_id = '00000000-0000-0000-0000-00000000ef01'
     and user_id = '00000000-0000-0000-0000-0000000e2002'),
  (select seq from m where n = 5),
  'last_read_seq stays at m5 — never regresses to m1');

-- ---- a seq that was never allocated to any row ---------------------
select throws_ok(
  $$select public.mark_chat_read('00000000-0000-0000-0000-00000000ef01', 999999999)$$,
  null, null, 'a seq that belongs to no message anywhere is rejected');

select * from finish();
rollback;
