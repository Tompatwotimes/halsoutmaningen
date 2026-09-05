-- ============================================================================
-- pgTAP — Shared Chat / 0021: moderated-content read isolation + sender names.
--
-- Proves the corrected security model from 20260905140200_chat_safe_read.sql
-- (PR #3 finding I-1) and the sender-name completion (finding I-2):
--
--   * an ordinary member CAN see that a hidden message exists, but CANNOT read
--     its original body or hidden_reason — not via list_chat_messages, and not
--     via a direct SELECT on chat_messages (that path is admin-only now)
--   * an admin CAN still read the retained original body + moderation trail
--   * list_chat_messages resolves the participant sender's display name in the
--     same query (no N+1), NULL for a Game Master row, preserved on a hidden row
--   * a non-member gets nothing from list_chat_messages / unread_chat_count
--   * upward pagination via list_chat_messages(p_before_seq) is a strict bound
--   * anon cannot EXECUTE any chat RPC
--   * the Realtime signal table chat_activity carries no message content, is
--     membership-scoped, and chat_messages is no longer in the publication
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(29);

set local role postgres;

-- ---- fixtures ----------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000f2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-f2001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000f2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-f2002@example.test', '{"display_name":"Pia Nyström"}', now(), now()),
  ('00000000-0000-0000-0000-0000000f2003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chat-f2003@example.test', '{"display_name":"Ove"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000f2001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-00000000ff01', 'Chat-Safe', current_date - 10, current_date + 20,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000f2001');

-- Pia is a member; Ove is a member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-0000000f2002',
        current_date - 10, true, '00000000-0000-0000-0000-0000000f2001');

-- 4 messages; m3 will be moderated. Capture each seq (read back under
-- role authenticated later, so grant SELECT — same pattern as 0017/0019/0020).
create temp table s (n int primary key, seq bigint not null);
grant select on s to authenticated;

with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ff01', 'participant', '00000000-0000-0000-0000-0000000f2002', 'första')
  returning seq)
insert into s select 1, seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ff01', 'participant', '00000000-0000-0000-0000-0000000f2002', 'andra')
  returning seq)
insert into s select 2, seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ff01', 'participant', '00000000-0000-0000-0000-0000000f2002', 'HEMLIG ORIGINALTEXT')
  returning seq)
insert into s select 3, seq from i;
with i as (insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-00000000ff01', 'game_master', null, 'systemmeddelande')
  returning seq)
insert into s select 4, seq from i;

-- Moderate m3 (direct update as postgres — hide_chat_message itself is covered by 0019).
update public.chat_messages
  set status = 'hidden', hidden_at = now(),
      hidden_by = '00000000-0000-0000-0000-0000000f2001',
      hidden_reason = 'Innehöll en annan deltagares namn'
  where challenge_id = '00000000-0000-0000-0000-00000000ff01' and body = 'HEMLIG ORIGINALTEXT';

-- ========================================================================
-- Section A — a member sees the hidden row but not its content
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2002","role":"authenticated"}', true);

select ok(
  exists (select 1 from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
          where status = 'hidden'),
  'a member can see that a hidden message exists (it still occupies a seq)');
select ok(
  (select body from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where status = 'hidden') is null,
  'a member cannot read the original body of a hidden message (withheld server-side)');
select is(
  (select body from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where body is not null and sender_type = 'participant' order by seq limit 1),
  'första',
  'an active message''s body IS returned to a member (not over-restricted)');
select is(
  (select count(*)::int from public.chat_messages),
  0,
  'a member has NO direct SELECT on chat_messages — the safe projection cannot be bypassed');
select is(
  (select count(*)::int from public.chat_messages where hidden_reason is not null),
  0,
  'a member cannot read hidden_reason through any direct query');

-- ========================================================================
-- Section B — an admin retains the full retained row
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2001","role":"authenticated"}', true);

select is(
  (select body from public.chat_messages where status = 'hidden'),
  'HEMLIG ORIGINALTEXT',
  'an admin still reads the retained original body of a hidden message');
select is(
  (select hidden_reason from public.chat_messages where status = 'hidden'),
  'Innehöll en annan deltagares namn',
  'an admin still reads the moderation reason');
select is(
  (select body from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where status = 'hidden'),
  'HEMLIG ORIGINALTEXT',
  'list_chat_messages returns the real body to an admin caller (moderator context)');

-- ========================================================================
-- Section C — sender display names (finding I-2)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2002","role":"authenticated"}', true);

select is(
  (select sender_display_name from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where sender_type = 'participant' and status = 'active' order by seq limit 1),
  'Pia Nyström',
  'a participant message carries its sender''s display name, resolved in the same query');
select ok(
  (select sender_display_name from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where sender_type = 'game_master') is null,
  'a Game Master message has a null sender_display_name (rendered as "GAME MASTER")');
select is(
  (select sender_display_name from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')
   where status = 'hidden'),
  'Pia Nyström',
  'a hidden participant message keeps its sender label even though the body is withheld');

-- ========================================================================
-- Section D — a non-member gets nothing
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2003","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.list_chat_messages('00000000-0000-0000-0000-00000000ff01')),
  0, 'a non-member gets zero rows from list_chat_messages');
select is(
  public.unread_chat_count('00000000-0000-0000-0000-00000000ff01'),
  0, 'a non-member gets 0 from unread_chat_count');

-- ========================================================================
-- Section E — pagination + unread via the RPC surface
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2002","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.list_chat_messages(
     '00000000-0000-0000-0000-00000000ff01', null, 2)),
  2, 'list_chat_messages respects p_limit');
select is(
  (select min(seq) from public.list_chat_messages(
     '00000000-0000-0000-0000-00000000ff01', null, 2)),
  (select seq from s where n = 3),
  'p_limit keeps the NEWEST rows (order by seq desc) — the oldest of the page is m3');
select is(
  (select array_agg(seq order by seq)
   from (select seq from public.list_chat_messages(
           '00000000-0000-0000-0000-00000000ff01', (select seq from s where n = 3))) page),
  array[(select seq from s where n = 1), (select seq from s where n = 2)]::bigint[],
  'p_before_seq is a strict upper bound — exactly the two messages older than m3');
-- Pia has no read-state row yet → cursor 0 → everything is unread.
select is(
  public.unread_chat_count('00000000-0000-0000-0000-00000000ff01'),
  4, 'unread_chat_count with no read-state row counts every message, hidden included');

-- ========================================================================
-- Section F — the Realtime signal table leaks nothing
-- ========================================================================
set local role postgres;

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'chat_activity'
     and column_name in ('body', 'sender_user_id', 'sender_type', 'hidden_reason', 'hidden_by')),
  0, 'chat_activity carries no message content, sender identity or moderation data');
select ok(
  (select count(*)::int from public.chat_activity
   where challenge_id = '00000000-0000-0000-0000-00000000ff01') >= 4,
  'the AFTER trigger populates chat_activity for every chat_messages row');
select is(
  (select count(*)::int from public.chat_activity
   where challenge_id = '00000000-0000-0000-0000-00000000ff01'),
  (select count(*)::int from public.chat_messages
   where challenge_id = '00000000-0000-0000-0000-00000000ff01'),
  'exactly one chat_activity row per message — the hide (status change) upserts, never duplicates');
select ok(
  (select coalesce(bool_or(puballtables), false)
     from pg_publication where pubname = 'supabase_realtime')
  or not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_messages'
  ),
  'chat_messages is not individually published for Realtime (moderated text stays off the socket)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2002","role":"authenticated"}', true);
select ok(
  (select count(*)::int from public.chat_activity
   where challenge_id = '00000000-0000-0000-0000-00000000ff01') >= 4,
  'a member may read chat_activity for their own challenge (the Realtime signal)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000f2003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.chat_activity),
  0, 'a non-member reads no chat_activity');

-- ========================================================================
-- Section G — anon (and PUBLIC) have no EXECUTE on any chat RPC
-- (same has_function_privilege pattern as 0017 Section A/B)
-- ========================================================================
set local role postgres;

select ok(
  not has_function_privilege('anon', 'public.post_chat_message(uuid, text)', 'execute'),
  'anon has NO EXECUTE on post_chat_message');
select ok(
  not has_function_privilege('anon', 'public.mark_chat_read(uuid, bigint)', 'execute'),
  'anon has NO EXECUTE on mark_chat_read');
select ok(
  not has_function_privilege('anon', 'public.hide_chat_message(uuid, text)', 'execute'),
  'anon has NO EXECUTE on hide_chat_message');
select ok(
  not has_function_privilege('anon', 'public.list_chat_messages(uuid, bigint, integer)', 'execute'),
  'anon has NO EXECUTE on list_chat_messages');
select ok(
  not has_function_privilege('anon', 'public.unread_chat_count(uuid)', 'execute'),
  'anon has NO EXECUTE on unread_chat_count');
select ok(
  not has_function_privilege('public', 'public.hide_chat_message(uuid, text)', 'execute')
  and not has_function_privilege('public', 'public.list_chat_messages(uuid, bigint, integer)', 'execute'),
  'the PUBLIC pseudo-role has NO EXECUTE on the chat RPCs');

select * from finish();
rollback;
