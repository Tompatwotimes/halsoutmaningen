-- ============================================================================
-- pgTAP — Shared Chat: ❤️ likes + ↩️ replies / 0030
--
-- Proves docs/superpowers/specs/2026-09-07-chat-replies-likes-design.md §9-§13
-- as delivered by 20260908120000_chat_replies_likes.sql.
--
--   Task A — schema  (Sections A-E)
--     chat_messages.reply_to_message_id — nullable self-reference, composite FK
--       to (id, challenge_id) [same-challenge guaranteed], ON DELETE SET NULL
--       (reply_to_message_id) [child survives], chat_messages_reply_not_self,
--       the partial index
--     chat_message_likes — PK (message_id, user_id) [one heart], composite FK to
--       (id, challenge_id) ON DELETE CASCADE, user_id -> profiles ON DELETE
--       CASCADE; RLS base SELECT admin-only, no write policy; not published
--     additive — participant / game_master / training_card rows stay valid
--
--   Task B — write RPCs + safe read model  (Sections F-I)
--     _create_chat_message  — the one private canonical message writer
--     post_chat_message v5  — ONE public signature, additive reply param,
--       old {challenge, body}[, message_id, attachments] callers still resolve
--     set_chat_message_like(message_id, liked) — idempotent, retry-safe heart
--       state; no seq / no unread; bumps chat_activity only on a real change
--     list_chat_messages v4 — +like_count, +liked_by_me, +reply_preview, all
--       gated like body/attachments; reply_preview is a one-level server-safe
--       quote that collapses to {"deleted": true} for a hidden parent
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(147);

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


-- ############################################################################
-- ##  TASK B — write RPCs + safe read model                                  ##
-- ##  _create_chat_message helper · reply-aware post_chat_message ·           ##
-- ##  set_chat_message_like (idempotent) · list_chat_messages v4             ##
-- ##                                                                          ##
-- ##  Fresh fixtures (b0*) — independent of Task A's destructive sections.    ##
-- ##  Run as `postgres` with request.jwt.claims set per simulated caller: the ##
-- ##  RPCs are SECURITY DEFINER and gate on auth.uid()/is_admin()/            ##
-- ##  is_challenge_member(), so their body logic is exercised identically     ##
-- ##  regardless of the SQL role; base-table verification reads then bypass   ##
-- ##  RLS (chat_messages / chat_message_likes SELECT are admin-only). EXECUTE ##
-- ##  grants + direct-DML denial are covered by catalog checks (Section I)    ##
-- ##  and Task A Section C. The one genuine `authenticated`-role test is F3.  ##
-- ############################################################################
set local role postgres;
-- Clear any leftover JWT claim from Task A so the fixture inserts below run as
-- the privileged backend (auth.uid() = NULL) — the training_entries ownership
-- trigger then allows seeding an entry for another user.
select set_config('request.jwt.claims', '', true);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-b002@example.test', '{"display_name":"Tia"}', now(), now()),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-b003@example.test', '{"display_name":"Rolf"}', now(), now()),
  ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-b004@example.test', '{"display_name":"Vega"}', now(), now()),
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-b005@example.test', '{"display_name":"Ola"}', now(), now()),
  ('00000000-0000-0000-0000-00000000b006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-b006@example.test', '{"display_name":"Siv"}', now(), now());

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-0000000b0f11', 'TaskB-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-0000000b0f12', 'TaskB-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000030a1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000b0f11', '00000000-0000-0000-0000-00000000b002', current_date - 10, true,  '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-0000000b0f11', '00000000-0000-0000-0000-00000000b003', current_date - 10, true,  '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-0000000b0f11', '00000000-0000-0000-0000-00000000b005', current_date - 10, false, '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-0000000b0f11', '00000000-0000-0000-0000-00000000b006', current_date - 10, true,  '00000000-0000-0000-0000-0000000030a1'),
  ('00000000-0000-0000-0000-0000000b0f12', '00000000-0000-0000-0000-00000000b004', current_date - 10, true,  '00000000-0000-0000-0000-0000000030a1');

-- mA1 participant text (Tia) — distinctive body for the hidden-parent secret scan.
-- mA2 participant image-only (Rolf). mA3 participant text (Rolf) — hidden mid-test.
-- mGM game_master. Training entry teA (Tia) -> the trigger materialises its card.
-- mB1 participant text in TaskB-B (Vega) — the cross-challenge target.
insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values
  ('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000b0f11', 'participant', '00000000-0000-0000-0000-00000000b002', 'HEMLIG-PARENT-TEXT hej alla'),
  ('00000000-0000-0000-0000-0000000b0a02', '00000000-0000-0000-0000-0000000b0f11', 'participant', '00000000-0000-0000-0000-00000000b003', null),
  ('00000000-0000-0000-0000-0000000b0a03', '00000000-0000-0000-0000-0000000b0f11', 'participant', '00000000-0000-0000-0000-00000000b003', 'snart dold'),
  ('00000000-0000-0000-0000-0000000b0a90', '00000000-0000-0000-0000-0000000b0f11', 'game_master', null, 'GAME MASTER: kör hårt'),
  ('00000000-0000-0000-0000-0000000b0b01', '00000000-0000-0000-0000-0000000b0f12', 'participant', '00000000-0000-0000-0000-00000000b004', 'b-rummet');

insert into storage.objects (bucket_id, name)
values ('chat-media', '00000000-0000-0000-0000-0000000b0f11/00000000-0000-0000-0000-00000000b003/00000000-0000-0000-0000-0000000b0a02/1-x.jpg');
insert into public.chat_message_attachments (message_id, challenge_id, position, storage_path, mime_type, size_bytes)
values ('00000000-0000-0000-0000-0000000b0a02', '00000000-0000-0000-0000-0000000b0f11', 1,
        '00000000-0000-0000-0000-0000000b0f11/00000000-0000-0000-0000-00000000b003/00000000-0000-0000-0000-0000000b0a02/1-x.jpg',
        'image/jpeg', 1000);

insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes, activity, note)
values ('00000000-0000-0000-0000-0000000b07e1', '00000000-0000-0000-0000-0000000b0f11',
        '00000000-0000-0000-0000-00000000b002', current_date - 2, 1, 45, 'Löpning', 'HEMLIG-NOTE');

-- ========================================================================
-- Section F — post_chat_message compatibility + reply writes + validation
-- ========================================================================
-- Task B objects must exist — clean RED lines before the behavioural tests.
select ok(
  to_regprocedure('public._create_chat_message(uuid, text, uuid, jsonb, uuid)') is not null,
  'Task B: _create_chat_message(uuid, text, uuid, jsonb, uuid) exists');
select ok(
  to_regprocedure('public.post_chat_message(uuid, text, uuid, jsonb, uuid)') is not null,
  'Task B: post_chat_message has the 5-arg reply-capable signature');
select ok(
  to_regprocedure('public.set_chat_message_like(uuid, boolean)') is not null,
  'Task B: set_chat_message_like(uuid, boolean) exists');
select ok(
  pg_get_function_result('public.list_chat_messages(uuid, bigint, integer)'::regprocedure) like '%reply_preview%',
  'Task B: list_chat_messages exposes reply_preview');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);

-- F1/F2: old-client call shapes still resolve against the 5-arg function.
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'legacy 2-arg')$$,
  'legacy post_chat_message(challenge, body) still creates a message');
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'legacy 4-arg',
      '00000000-0000-0000-0000-0000000b0a04'::uuid, '[]'::jsonb)$$,
  'legacy post_chat_message(challenge, body, message_id, attachments) still works');
select is(
  (select reply_to_message_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0a04'),
  null, 'a non-reply message has reply_to_message_id = NULL (behaviour unchanged)');

-- F3: the private helper is NOT callable by an ordinary authenticated user.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select throws_ok(
  $$select public._create_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'direkt',
      null, null, null)$$,
  null, null, 'an ordinary authenticated user cannot call _create_chat_message directly');
set local role postgres;

-- F4-F9: replies to every supported target kind (as Tia unless noted).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar-ett',
      '00000000-0000-0000-0000-0000000b0c09'::uuid, null,
      '00000000-0000-0000-0000-0000000b0a01'::uuid)$$,
  'Rolf replies to a visible participant message');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på bild',
      '00000000-0000-0000-0000-0000000b0c12'::uuid, null,
      '00000000-0000-0000-0000-0000000b0a02'::uuid)$$,
  'a reply to an image message is accepted');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på passkort',
      '00000000-0000-0000-0000-0000000b0c13'::uuid, null,
      (select id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000b07e1'))$$,
  'a reply to a training_card is accepted');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på GM',
      '00000000-0000-0000-0000-0000000b0c14'::uuid, null,
      '00000000-0000-0000-0000-0000000b0a90'::uuid)$$,
  'a reply to a game_master message is accepted');
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar-två',
      '00000000-0000-0000-0000-0000000b0c15'::uuid, null,
      '00000000-0000-0000-0000-0000000b0c09'::uuid)$$,
  'a reply to a reply is accepted (flat, no thread)');
select lives_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på mig själv',
      '00000000-0000-0000-0000-0000000b0c16'::uuid, null,
      '00000000-0000-0000-0000-0000000b0a01'::uuid)$$,
  'replying to your OWN earlier message is allowed (mA1 is Tia''s)');

-- F10-F15: the reply row is an ordinary participant message.
select is(
  (select reply_to_message_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c09'),
  '00000000-0000-0000-0000-0000000b0a01'::uuid, 'reply_to_message_id is persisted on the child');
select is(
  (select sender_type from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c09'),
  'participant', 'a reply is sender_type = participant');
select is(
  (select sender_user_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c09'),
  '00000000-0000-0000-0000-00000000b003'::uuid, 'a reply''s sender is auth.uid() — not spoofable');
select is(
  (select sender_type from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c14'),
  'participant', 'a reply TO a game_master message is still sender_type = participant (no spoof)');
select ok(
  (select r.seq > m.seq
   from public.chat_messages r, public.chat_messages m
   where r.id = '00000000-0000-0000-0000-0000000b0c09' and m.id = '00000000-0000-0000-0000-0000000b0a01'),
  'a reply gets a normal seq, later than its parent');
select is(
  (select training_entry_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c13'),
  null, 'a reply to a training card does NOT copy training_entry_id');

-- F16-F18: reply-target validation (the RPC is the first line of defence).
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'korsutmaning',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0b01'::uuid)$$,
  null, 'Meddelandet du svarar på tillhör en annan utmaning',
  'a reply whose parent is in another challenge is rejected (challenge from the row, not the caller)');
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'spöke',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0eee'::uuid)$$,
  null, 'Meddelandet du svarar på finns inte',
  'a reply to a non-existent parent is rejected with a generic domain error');
select is(
  (select count(*)::int from public.chat_messages where body = 'spöke'),
  0, 'the rejected reply left no message row');

-- F19: hide mA3, then a NEW reply to it must fail server-side.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}', true);
select lives_ok(
  $$select public.hide_chat_message('00000000-0000-0000-0000-0000000b0a03', 'olämpligt')$$,
  'an admin hides mA3');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på dold',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0a03'::uuid)$$,
  null, 'Meddelandet går inte längre att svara på',
  'a NEW reply to an already-hidden message is rejected server-side');

-- F20-F21: membership gate applies to replies exactly like normal messages.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b004","role":"authenticated"}', true);
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'utomstående',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0a01'::uuid)$$,
  null, 'Du är inte aktiv deltagare i den här utmaningen',
  'a non-member cannot post a reply into the challenge');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b005","role":"authenticated"}', true);
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'inaktiv',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0a01'::uuid)$$,
  null, 'Du är inte aktiv deltagare i den här utmaningen',
  'an INACTIVE member cannot post a reply');

-- F22: replies count against the SAME 10 / rolling-30s limit — no bypass.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b006","role":"authenticated"}', true);
do $$
begin
  for i in 1..10 loop
    perform public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'siv ' || i);
  end loop;
end $$;
select throws_ok(
  $$select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'siv reply 11',
      gen_random_uuid(), null, '00000000-0000-0000-0000-0000000b0a01'::uuid)$$,
  null, 'För många meddelanden på kort tid. Vänta en liten stund.',
  'the 11th message in the window — a REPLY — is refused (replies use the same rate limit)');

-- ========================================================================
-- Section G — set_chat_message_like: idempotent, retry-safe heart state
-- ========================================================================
select is(
  pg_get_function_arguments('public.set_chat_message_like(uuid, boolean)'::regprocedure),
  'p_message_id uuid, p_liked boolean',
  'set_chat_message_like takes only (message_id, liked) — the caller can never name a user_id');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true) ->> 'liked'),
  'true', 'liked=true returns liked:true');
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true) ->> 'like_count'),
  '1', 'liked=true a second time is a no-op — still one like (retry-safe)');
select is(
  (select count(*)::int from public.chat_message_likes
   where message_id = '00000000-0000-0000-0000-0000000b0a01'
     and user_id = '00000000-0000-0000-0000-00000000b002'),
  1, 'exactly one like row for (message, user)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true) ->> 'like_count'),
  '2', 'a second user liking the same message -> like_count 2');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', false) ->> 'liked'),
  'false', 'liked=false returns liked:false');
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', false) ->> 'like_count'),
  '1', 'liked=false a second time is a no-op — still one like left (retry-safe)');
select is(
  (select user_id from public.chat_message_likes where message_id = '00000000-0000-0000-0000-0000000b0a01'),
  '00000000-0000-0000-0000-00000000b003'::uuid,
  'unlike removed ONLY the caller''s row — the other user''s like survives');

-- likes on every supported target kind, and self-like.
select is(
  (select public.set_chat_message_like(
     (select id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000b07e1'),
     true) ->> 'liked'),
  'true', 'a participant can like a training_card');
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a90', true) ->> 'liked'),
  'true', 'a participant can like a game_master message');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a02', true) ->> 'liked'),
  'true', 'a participant can like their OWN message (no special-casing)');

-- authorization failures (the RPC body enforces these regardless of SQL role).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b004","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true)$$,
  null, 'Du är inte aktiv deltagare i den här utmaningen',
  'a non-member of the message''s challenge cannot like it (cross-challenge blocked)');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b005","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true)$$,
  null, 'Du är inte aktiv deltagare i den här utmaningen',
  'an INACTIVE member cannot like');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a03', true)$$,
  null, 'Det går inte att gilla ett dolt meddelande',
  'a NEW like on a hidden message is rejected');
select throws_ok(
  $$select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a03', false)$$,
  null, 'Det går inte att gilla ett dolt meddelande',
  'unliking a hidden message is also rejected — the surface is frozen');
select throws_ok(
  $$select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0eee', true)$$,
  null, 'Meddelandet finns inte',
  'a like on a non-existent message id is rejected');

-- a like allocates no seq, creates no chat_messages row, changes no unread.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
do $$
declare
  v_msgs_before   bigint  := (select count(*) from public.chat_messages);
  v_maxseq_before bigint  := (select max(seq) from public.chat_messages);
  v_unread_before integer;
begin
  perform public.mark_chat_read('00000000-0000-0000-0000-0000000b0f11',
    (select max(seq) from public.chat_messages where challenge_id = '00000000-0000-0000-0000-0000000b0f11'));
  v_unread_before := public.unread_chat_count('00000000-0000-0000-0000-0000000b0f11');

  perform public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a01', true);

  if (select count(*) from public.chat_messages) <> v_msgs_before then
    raise exception 'like inserted a chat_messages row';
  end if;
  if (select max(seq) from public.chat_messages) <> v_maxseq_before then
    raise exception 'like allocated a seq';
  end if;
  if public.unread_chat_count('00000000-0000-0000-0000-0000000b0f11') <> v_unread_before then
    raise exception 'like changed the unread count';
  end if;
end $$;
select ok(true, 'a like allocates no seq, inserts no chat_messages row, and does not change unread_chat_count');

-- chat_activity: bump ONLY on a real state change (now() is constant in a txn,
-- so detect the bump by deleting the signal row and checking whether it returns).
delete from public.chat_activity
where challenge_id = '00000000-0000-0000-0000-0000000b0f11'
  and seq = (select seq from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0a02');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a02', true);  -- Tia not yet liking m02 -> real change
select ok(
  exists (select 1 from public.chat_activity
          where challenge_id = '00000000-0000-0000-0000-0000000b0f11'
            and seq = (select seq from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0a02')),
  'an actual like state change bumps the chat_activity signal row');
delete from public.chat_activity
where challenge_id = '00000000-0000-0000-0000-0000000b0f11'
  and seq = (select seq from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0a02');
select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0a02', true);  -- already liked -> no-op
select ok(
  not exists (select 1 from public.chat_activity
             where challenge_id = '00000000-0000-0000-0000-0000000b0f11'
               and seq = (select seq from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0a02')),
  'a no-op same-state request does NOT bump chat_activity');

-- ========================================================================
-- Section H — list_chat_messages v4: like_count / liked_by_me / reply_preview
-- ========================================================================
-- mCnt: a fresh active message with a known like set (Tia + Rolf).
insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values ('00000000-0000-0000-0000-0000000b0c0e', '00000000-0000-0000-0000-0000000b0f11',
        'participant', '00000000-0000-0000-0000-00000000b002', 'räkna mig');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select like_count from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e'),
  0, 'like_count is 0 for a message with no likes');
select is(
  (select liked_by_me from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e')::text,
  'false', 'liked_by_me is false when the viewer has not liked');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0c0e', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select public.set_chat_message_like('00000000-0000-0000-0000-0000000b0c0e', true);

select is(
  (select like_count from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e'),
  2, 'like_count aggregates all likers');
select is(
  (select liked_by_me from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e')::text,
  'true', 'liked_by_me is true for a viewer who liked (Rolf)');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
select is(
  (select liked_by_me from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e')::text,
  'true', 'liked_by_me is true for the other viewer who liked (Tia)');

-- additive on existing rows: GM message + training card carry the new fields.
select ok(
  (select like_count >= 0 and reply_preview is null
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0a90'),
  'a game_master row gains like_count and a NULL reply_preview safely');
select ok(
  (select like_count >= 0 and reply_preview is null
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where training_card is not null),
  'a training_card row gains like_count and a NULL reply_preview safely');

-- reply_preview per parent kind (as Rolf, a member).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select reply_preview ->> 'kind' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'text', 'reply to a text message -> reply_preview.kind = text');
select is(
  (select reply_preview ->> 'text' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'HEMLIG-PARENT-TEXT hej alla', 'reply_preview carries a short parent-text excerpt');
select is(
  (select reply_preview ->> 'message_id' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  '00000000-0000-0000-0000-0000000b0a01', 'reply_preview identifies the parent message');
select is(
  (select reply_preview ->> 'kind' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c12'),
  'image', 'reply to an image-only message -> reply_preview.kind = image');
select ok(
  (select (reply_preview ->> 'text') is null and (reply_preview ->> 'has_image') = 'true'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c12'),
  'an image parent preview has has_image=true and no text');
select ok(
  (select reply_preview::text not like '%1-x.jpg%' and reply_preview::text not like '%storage%'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c12'),
  'the image reply_preview payload contains no chat-media path / signed URL');
select is(
  (select reply_preview ->> 'kind' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c13'),
  'training_card', 'reply to a training card -> reply_preview.kind = training_card');
select is(
  (select reply_preview -> 'training' ->> 'activity' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c13'),
  'Löpning', 'a training-card preview carries the activity');
select is(
  (select reply_preview -> 'training' ->> 'duration_minutes' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c13'),
  '45', 'a training-card preview carries the duration');
select ok(
  (select reply_preview::text not like '%HEMLIG-NOTE%' and reply_preview::text not like '%proof%'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c13'),
  'a training-card preview does NOT leak the note or any proof reference');
select is(
  (select reply_preview ->> 'kind' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c14'),
  'game_master', 'reply to a GM message -> reply_preview.kind = game_master');
select is(
  (select reply_preview ->> 'text' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c14'),
  'GAME MASTER: kör hårt', 'a GM preview carries the visible message text only');

-- one level only: reply-to-a-reply previews its DIRECT parent, never the grandparent.
select is(
  (select reply_preview ->> 'message_id' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c15'),
  '00000000-0000-0000-0000-0000000b0c09', 'reply-to-reply previews the direct parent (r09)');
select is(
  (select reply_preview ->> 'text' from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c15'),
  'svar-ett', 'reply-to-reply preview text is the direct parent''s body');
select ok(
  (select reply_preview::text not like '%HEMLIG-PARENT-TEXT%'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c15'),
  'reply-to-reply preview contains NOTHING from the grandparent (no recursion)');

-- physical parent delete -> child survives, reply_preview NULL.
insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
values ('00000000-0000-0000-0000-0000000b0dd1', '00000000-0000-0000-0000-0000000b0f11',
        'participant', '00000000-0000-0000-0000-00000000b002', 'ska raderas fysiskt');
select public.post_chat_message('00000000-0000-0000-0000-0000000b0f11'::uuid, 'svar på raderad',
  '00000000-0000-0000-0000-0000000b0cd1'::uuid, null, '00000000-0000-0000-0000-0000000b0dd1'::uuid);
select ok(
  (select reply_preview is not null from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0cd1'),
  'the reply has a preview while its parent exists');
delete from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0dd1';
select ok(
  (select count(*)::int from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0cd1') = 1,
  'the child reply survives a physical parent delete');
select ok(
  (select reply_preview is null from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0cd1'),
  'a physically-deleted parent -> reply_preview is NULL (FK SET NULL, graceful)');
select is(
  (select reply_to_message_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0cd1'),
  null, 'the FK SET NULL cleared the child''s reply_to_message_id column');

-- hidden parent -> tombstone; child row unchanged; secret text absent.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}', true);
select lives_ok(
  $$select public.hide_chat_message('00000000-0000-0000-0000-0000000b0a01', 'modererad')$$,
  'an admin hides the parent message mA1');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select reply_preview from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  '{"deleted": true}'::jsonb,
  'once the parent is hidden, an ordinary member''s reply_preview is exactly {"deleted": true}');
select ok(
  (select not (reply_preview ? 'message_id') and not (reply_preview ? 'text')
        and not (reply_preview ? 'sender_display_name') and not (reply_preview ? 'kind')
        and not (reply_preview ? 'training')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'the tombstone preview has NO message_id / text / sender / kind / training key');
select ok(
  (select reply_preview::text not like '%HEMLIG-PARENT-TEXT%'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'the now-hidden parent''s body text is absent from the child payload');
select ok(
  (select body = 'svar-ett' and status = 'active'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'the child reply itself is untouched — still visible with its own body');
select is(
  (select reply_to_message_id from public.chat_messages where id = '00000000-0000-0000-0000-0000000b0c09'),
  '00000000-0000-0000-0000-0000000b0a01'::uuid,
  'hiding the parent did not modify the child row (link intact)');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}', true);
select ok(
  (select (reply_preview ? 'message_id')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c09'),
  'an ADMIN still resolves the real parent in reply_preview (moderation context)');

-- hidden message -> neutral reaction metadata for a non-admin, real for admin.
select lives_ok(
  $$select public.hide_chat_message('00000000-0000-0000-0000-0000000b0c0e', 'räknat och dolt')$$,
  'an admin hides mCnt (which has 2 likes)');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(
  (select like_count from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e'),
  0, 'a hidden message exposes like_count = 0 to a non-admin (no leak)');
select is(
  (select liked_by_me from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e')::text,
  'false', 'a hidden message exposes liked_by_me = false to a non-admin');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}', true);
select is(
  (select like_count from public.list_chat_messages('00000000-0000-0000-0000-0000000b0f11')
   where id = '00000000-0000-0000-0000-0000000b0c0e'),
  2, 'an admin still sees the hidden message''s real like_count (moderation)');
select is(
  (select count(*)::int from public.chat_message_likes where message_id = '00000000-0000-0000-0000-0000000b0c0e'),
  2, 'the like rows are RETAINED when a message is hidden');

-- ========================================================================
-- Section I — catalog / grants / no overload ambiguity / realtime
-- ========================================================================
select is(
  (select count(*)::int from pg_proc
   where proname = 'post_chat_message' and pronamespace = 'public'::regnamespace),
  1, 'exactly ONE post_chat_message function — no PostgREST overload ambiguity');
select is(
  (select pronargs::int from pg_proc
   where proname = 'post_chat_message' and pronamespace = 'public'::regnamespace),
  5, 'post_chat_message has arity 5 (additive reply param)');
select ok(
  has_function_privilege('authenticated', 'public.post_chat_message(uuid, text, uuid, jsonb, uuid)', 'execute'),
  'authenticated may EXECUTE post_chat_message');
select ok(
  not has_function_privilege('anon', 'public.post_chat_message(uuid, text, uuid, jsonb, uuid)', 'execute'),
  'anon may NOT EXECUTE post_chat_message');
select ok(
  not has_function_privilege('authenticated', 'public._create_chat_message(uuid, text, uuid, jsonb, uuid)', 'execute'),
  'authenticated may NOT EXECUTE the private _create_chat_message helper');
select ok(
  not has_function_privilege('anon', 'public._create_chat_message(uuid, text, uuid, jsonb, uuid)', 'execute'),
  'anon may NOT EXECUTE _create_chat_message');
select ok(
  (select prosecdef from pg_proc where proname = '_create_chat_message' and pronamespace = 'public'::regnamespace),
  '_create_chat_message is SECURITY DEFINER');
select ok(
  (select array_to_string(proconfig, ',') like 'search_path=%'
   from pg_proc where proname = '_create_chat_message' and pronamespace = 'public'::regnamespace),
  '_create_chat_message pins search_path');
select ok(
  (select prosecdef from pg_proc where proname = 'set_chat_message_like' and pronamespace = 'public'::regnamespace),
  'set_chat_message_like is SECURITY DEFINER');
select ok(
  (select array_to_string(proconfig, ',') like 'search_path=%'
   from pg_proc where proname = 'set_chat_message_like' and pronamespace = 'public'::regnamespace),
  'set_chat_message_like pins search_path');
select ok(
  not has_function_privilege('anon', 'public.set_chat_message_like(uuid, boolean)', 'execute'),
  'anon may NOT EXECUTE set_chat_message_like');
select ok(
  has_function_privilege('authenticated', 'public.set_chat_message_like(uuid, boolean)', 'execute'),
  'authenticated may EXECUTE set_chat_message_like');
select ok(
  pg_get_function_result('public.list_chat_messages(uuid, bigint, integer)'::regprocedure) like '%like_count integer%',
  'list_chat_messages v4 returns like_count integer');
select ok(
  pg_get_function_result('public.list_chat_messages(uuid, bigint, integer)'::regprocedure) like '%liked_by_me boolean%',
  'list_chat_messages v4 returns liked_by_me boolean');
select ok(
  pg_get_function_result('public.list_chat_messages(uuid, bigint, integer)'::regprocedure) like '%reply_preview jsonb%',
  'list_chat_messages v4 returns reply_preview jsonb');
select ok(
  not has_function_privilege('anon', 'public.list_chat_messages(uuid, bigint, integer)', 'execute'),
  'anon may NOT EXECUTE list_chat_messages');
select ok(
  not exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename in ('chat_message_likes', 'chat_messages',
                                 'training_entries', 'training_proofs')),
  'Task B published nothing new to supabase_realtime (likes/messages/training stay off)');

select * from finish();
rollback;
