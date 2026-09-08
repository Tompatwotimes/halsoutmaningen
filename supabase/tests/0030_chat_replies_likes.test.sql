-- ============================================================================
-- pgTAP — Shared Chat: ❤️ likes + ↩️ replies / 0030  (Task A — schema only).
--
-- Proves docs/superpowers/specs/2026-09-07-chat-replies-likes-design.md §9
-- as delivered by 20260908120000_chat_replies_likes.sql PART 1 (the schema
-- foundation). The write RPCs, toggle_chat_message_like and the
-- list_chat_messages v4 read model are Task B and are NOT exercised here.
--
--   Section A  chat_messages.reply_to_message_id — nullable self-reference,
--              composite FK to (id, challenge_id) [same-challenge guaranteed],
--              ON DELETE SET NULL (reply_to_message_id) [child survives],
--              chat_messages_reply_not_self, the partial index
--   Section B  chat_message_likes — PK (message_id, user_id) [one heart],
--              composite FK to (id, challenge_id) ON DELETE CASCADE
--              [no cross-challenge like; like dies with the message],
--              user_id -> profiles ON DELETE CASCADE
--   Section C  RLS — base SELECT admin-only; a member / non-member reads 0
--              rows; anon has no privilege; no write policy for any app role
--   Section D  additive — participant / game_master / training_card rows stay
--              valid; chat_messages_id_challenge_uniq (the FK target) intact;
--              FK ON DELETE actions are exactly cascade / set null
--   Section E  Realtime — chat_message_likes is NOT published; the existing
--              chat_activity-only signal is unchanged
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(45);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Fixtures: an admin, two active members of challenge A (Pia, Rune), one
-- active member of challenge B (Vera), and a throwaway liker (Nils, member of
-- A, authors nothing) for the profile-cascade test.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000030a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-30a1@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000030a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-30a2@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000030a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-30a3@example.test', '{"display_name":"Rune"}', now(), now()),
  ('00000000-0000-0000-0000-0000000030a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-30a4@example.test', '{"display_name":"Vera"}', now(), now()),
  ('00000000-0000-0000-0000-0000000030a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-30a5@example.test', '{"display_name":"Nils"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000030a1';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-000000030f01', 'Replies-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-000000030f02', 'Replies-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000030a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-000000030f01', '00000000-0000-0000-0000-0000000030a2', current_date - 10, true, '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-000000030f01', '00000000-0000-0000-0000-0000000030a3', current_date - 10, true, '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-000000030f01', '00000000-0000-0000-0000-0000000030a5', current_date - 10, true, '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-000000030f02', '00000000-0000-0000-0000-0000000030a4', current_date - 10, true, '00000000-0000-0000-0000-0000000030a1');

-- Plain participant messages (inserted directly — the RPCs are Task B):
--   c1, c2 in challenge A; b1 in challenge B.
insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values
  ('00000000-0000-0000-0000-0000000030c1', '00000000-0000-0000-0000-000000030f01', 'participant', '00000000-0000-0000-0000-0000000030a2', 'första'),
  ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-000000030f01', 'participant', '00000000-0000-0000-0000-0000000030a3', 'andra'),
  ('00000000-0000-0000-0000-0000000030b1', '00000000-0000-0000-0000-000000030f02', 'participant', '00000000-0000-0000-0000-0000000030a4', 'b-meddelande');

-- ========================================================================
-- Section pre — pure catalog checks (fail cleanly even before the migration)
-- ========================================================================
select ok(
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'chat_messages'
     and column_name = 'reply_to_message_id' and data_type = 'uuid'
     and is_nullable = 'YES'),
  'chat_messages.reply_to_message_id exists, is uuid, is nullable');

select ok(
  to_regclass('public.chat_message_likes') is not null,
  'chat_message_likes table exists');

select ok(
  (select conname is not null from pg_constraint
   where conname = 'chat_messages_reply_to_fk'
     and conrelid = 'public.chat_messages'::regclass and contype = 'f'),
  'chat_messages_reply_to_fk foreign key exists');

select is(
  (select confdeltype::text from pg_constraint
   where conname = 'chat_messages_reply_to_fk'),
  'n', 'chat_messages_reply_to_fk is ON DELETE SET NULL');

select ok(
  (select confrelid = 'public.chat_messages'::regclass from pg_constraint
   where conname = 'chat_messages_reply_to_fk'),
  'chat_messages_reply_to_fk references chat_messages (a self-reference)');

select ok(
  (select conname is not null from pg_constraint
   where conname = 'chat_messages_reply_not_self'
     and conrelid = 'public.chat_messages'::regclass and contype = 'c'),
  'chat_messages_reply_not_self CHECK exists');

select ok(
  (select conname is not null from pg_constraint
   where conname = 'chat_message_likes_message_fk'
     and conrelid = 'public.chat_message_likes'::regclass and contype = 'f'),
  'chat_message_likes_message_fk foreign key exists');

select is(
  (select confdeltype::text from pg_constraint
   where conname = 'chat_message_likes_message_fk'),
  'c', 'chat_message_likes_message_fk is ON DELETE CASCADE');

select is(
  (select confdeltype::text from pg_constraint c
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.chat_message_likes'::regclass and c.contype = 'f'
     and a.attname = 'user_id'),
  'c', 'chat_message_likes.user_id -> profiles is ON DELETE CASCADE');

select ok(
  (select indexdef ilike '%WHERE (reply_to_message_id IS NOT NULL)%'
   from pg_indexes
   where schemaname = 'public' and tablename = 'chat_messages'
     and indexname = 'chat_messages_reply_to_idx'),
  'chat_messages_reply_to_idx is a partial index on the reply link');

select ok(
  (select conname is not null from pg_constraint
   where conname = 'chat_messages_id_challenge_uniq'
     and conrelid = 'public.chat_messages'::regclass and contype = 'u'),
  'chat_messages_id_challenge_uniq (the composite FK target) is still present');

-- ========================================================================
-- Section A — reply link behaviour
-- ========================================================================
-- The migration synthesized no reply history.
select is(
  (select count(*)::int from public.chat_messages where reply_to_message_id is not null),
  0, 'no chat_messages row carries a reply link — no reply history synthesized');

select lives_ok($$
  insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
  values ('00000000-0000-0000-0000-0000000030d1', '00000000-0000-0000-0000-000000030f01',
          'participant', '00000000-0000-0000-0000-0000000030a3', 'svar på första',
          '00000000-0000-0000-0000-0000000030c1')
$$, 'a reply to a same-challenge message is accepted');

select is(
  (select reply_to_message_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000030d1'),
  '00000000-0000-0000-0000-0000000030c1'::uuid,
  'the reply link is stored on the child row');

select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
  values ('00000000-0000-0000-0000-000000030f01', 'participant',
          '00000000-0000-0000-0000-0000000030a2', 'olagligt korsutmanings-svar',
          '00000000-0000-0000-0000-0000000030b1')
$$, null, null,
  'a reply whose parent is in another challenge is rejected by the composite FK');

select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
  values ('00000000-0000-0000-0000-000000030f01', 'participant',
          '00000000-0000-0000-0000-0000000030a2', 'svar på spöke',
          '00000000-0000-0000-0000-0000000030ee')
$$, null, null,
  'a reply to a non-existent message id is rejected by the FK');

select throws_ok($$
  update public.chat_messages
  set reply_to_message_id = id
  where id = '00000000-0000-0000-0000-0000000030c2'
$$, null, null,
  'chat_messages_reply_not_self rejects a row replying to itself');

-- ON DELETE SET NULL (reply_to_message_id): physically delete the parent →
-- the child reply SURVIVES, its link is nulled, its challenge_id is intact.
delete from public.chat_messages where id = '00000000-0000-0000-0000-0000000030c1';
select is(
  (select count(*)::int from public.chat_messages where id = '00000000-0000-0000-0000-0000000030d1'),
  1, 'deleting the parent does NOT delete the child reply');
select ok(
  (select reply_to_message_id is null from public.chat_messages where id = '00000000-0000-0000-0000-0000000030d1'),
  'the child reply''s link is set to NULL when the parent is deleted');
select is(
  (select challenge_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000030d1'),
  '00000000-0000-0000-0000-000000030f01'::uuid,
  'the child reply''s NOT NULL challenge_id is untouched by ON DELETE SET NULL');

-- ========================================================================
-- Section B — chat_message_likes behaviour
-- ========================================================================
-- The migration synthesized no like history.
select is(
  (select count(*)::int from public.chat_message_likes),
  0, 'chat_message_likes is empty — no like history synthesized');

select lives_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a2')
$$, 'a like row is accepted');

select throws_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a2')
$$, null, null,
  'PK (message_id, user_id): the same user cannot like the same message twice');

select lives_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a3')
$$, 'a different user may like the same message');

select lives_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030d1', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a2')
$$, 'the same user may like a different message');

select throws_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-000000030f02',
          '00000000-0000-0000-0000-0000000030a2')
$$, null, null,
  'composite FK: a like whose challenge_id != its message''s is rejected');

select throws_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030ee', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a2')
$$, null, null,
  'composite FK: a like on a non-existent message is rejected');

-- ON DELETE CASCADE (message): deleting a message removes its likes.
select is(
  (select count(*)::int from public.chat_message_likes where message_id = '00000000-0000-0000-0000-0000000030c2'),
  2, 'message c2 has two likes before it is deleted');
delete from public.chat_messages where id = '00000000-0000-0000-0000-0000000030c2';
select is(
  (select count(*)::int from public.chat_message_likes where message_id = '00000000-0000-0000-0000-0000000030c2'),
  0, 'deleting the message cascades its likes away');

-- ON DELETE CASCADE (user_id -> profiles -> auth.users): removing an account
-- removes that account's likes. Nils authored nothing, so the delete is clean.
select is(
  (select count(*)::int from public.chat_message_likes where user_id = '00000000-0000-0000-0000-0000000030a2'),
  1, 'Pia still has one like (on the surviving reply d1)');
insert into public.chat_message_likes (message_id, challenge_id, user_id)
values ('00000000-0000-0000-0000-0000000030d1', '00000000-0000-0000-0000-000000030f01',
        '00000000-0000-0000-0000-0000000030a5');
delete from auth.users where id = '00000000-0000-0000-0000-0000000030a5';
select is(
  (select count(*)::int from public.chat_message_likes where user_id = '00000000-0000-0000-0000-0000000030a5'),
  0, 'removing an account cascades its likes away');

-- ========================================================================
-- Section C — RLS / grants
-- ========================================================================
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_message_likes'::regclass),
  'RLS is enabled on chat_message_likes');

select ok(
  has_table_privilege('authenticated', 'public.chat_message_likes', 'SELECT'),
  'authenticated is GRANTed SELECT (RLS still filters the rows)');
select ok(
  not has_table_privilege('anon', 'public.chat_message_likes', 'SELECT'),
  'anon has NO privilege on chat_message_likes');
select ok(
  not has_table_privilege('authenticated', 'public.chat_message_likes', 'INSERT'),
  'authenticated has NO direct INSERT on chat_message_likes');

-- one like remains: Pia's like on the surviving reply d1
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}', true);
select isnt(
  (select count(*)::int from public.chat_message_likes),
  0, 'an admin reads chat_message_likes rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.chat_message_likes),
  0, 'an ordinary member (even the liker) reads 0 rows from the base table');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a4","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.chat_message_likes),
  0, 'a non-member of the challenge reads 0 rows from the base table');

select throws_ok($$
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values ('00000000-0000-0000-0000-0000000030d1', '00000000-0000-0000-0000-000000030f01',
          '00000000-0000-0000-0000-0000000030a2')
$$, null, null,
  'a member cannot INSERT chat_message_likes directly (no write policy)');

-- ========================================================================
-- Section D — additive: existing sender types stay valid
-- ========================================================================
set local role postgres;

select lives_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-000000030f01', 'participant',
          '00000000-0000-0000-0000-0000000030a2', 'fortfarande giltigt')
$$, 'a normal participant message is still accepted after the migration');

select lives_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-000000030f01', 'game_master', null, 'GM lever')
$$, 'a game_master message is still accepted after the migration');

select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values ('00000000-0000-0000-0000-000000030f01', 'training_card',
          '00000000-0000-0000-0000-0000000030a2', 'text på kort')
$$, null, null,
  'training_card coherence is intact (a card with a body / no entry is still rejected)');

-- ========================================================================
-- Section E — Realtime publication unchanged
-- ========================================================================
select ok(
  not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_message_likes'),
  'chat_message_likes is NOT in the supabase_realtime publication');

select ok(
  not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('chat_messages', 'chat_message_attachments',
                        'training_entries', 'training_proofs')),
  'chat_messages / attachments / training tables are still NOT Realtime-published');

select ok(
  (not exists (select 1 from pg_publication where pubname = 'supabase_realtime'))
  or exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_activity'),
  'chat_activity is still the Realtime signal table');

select * from finish();
rollback;
