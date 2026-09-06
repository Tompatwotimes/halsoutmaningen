-- ============================================================================
-- pgTAP — Chat images / 0027: chat_message_attachments + storage gate.
--
-- Proves docs/superpowers/specs/2026-09-06-chat-proof-media-polish-design.md §B3:
--   * chat_message_attachments base SELECT is admin-only; members read
--     attachment info only through list_chat_messages
--   * an active message's attachments come back to a co-member (paths present);
--     a hidden message's come back as '[]' to a member, full to an admin
--   * _chat_attachment_readable() (the storage-policy predicate): true for a
--     member while the message is active, false once hidden, false for a
--     non-member — and the storage.objects SELECT policy follows it
--   * post_chat_message: atomic message+attachments; > 4 rejected; text-or-image
--     required; a path outside {challenge}/{uid}/{message}/ rejected
--   * position 1..4 CHECK; (message_id, position) unique; composite FK stops a
--     cross-challenge attachment
--   * anon has no EXECUTE; a member cannot write the table directly
--   * chat_message_attachments is not Realtime-published; chat_activity still is
--   * regression: hidden body still withheld from members, retained for admins
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(33);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-ca01@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-ca02@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm-ca03@example.test', '{"display_name":"Ove"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000ca01';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-0000000caf01', 'ChatMedia-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-00000000ca01'),
  ('00000000-0000-0000-0000-0000000caf02', 'ChatMedia-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-00000000ca01');

-- Pia is a member of ChatMedia-A only. Ove is a member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000caf01', '00000000-0000-0000-0000-00000000ca02',
        current_date - 10, true, '00000000-0000-0000-0000-00000000ca01');

-- storage objects the RPC will look for (client uploads before calling it).
create or replace function pg_temp.obj(p_path text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values ('chat-media', p_path);
$$;

-- msg1: active, two images. msg2: one image, will be hidden.
select pg_temp.obj('00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg');
select pg_temp.obj('00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/2-b.jpg');
select pg_temp.obj('00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca20/1-c.jpg');
-- an object under someone else's / a different message's folder, for the path check
select pg_temp.obj('00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca03/00000000-0000-0000-0000-00000000ca10/x.jpg');

-- ========================================================================
-- Section A — post_chat_message: atomic message + attachments (as Pia)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);

select lives_ok($$
  select public.post_chat_message(
    '00000000-0000-0000-0000-0000000caf01'::uuid,
    'kolla dessa',
    '00000000-0000-0000-0000-00000000ca10'::uuid,
    jsonb_build_array(
      jsonb_build_object('path', '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg',
        'mime_type', 'image/jpeg', 'size_bytes', 2000),
      jsonb_build_object('path', '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/2-b.jpg',
        'mime_type', 'image/png', 'size_bytes', 3000)
    ))
$$, 'a member posts a message with two images atomically');

set local role postgres;
select is(
  (select count(*)::int from public.chat_message_attachments
   where message_id = '00000000-0000-0000-0000-00000000ca10'),
  2, 'both attachment rows were written in the same call');
select is(
  (select string_agg(position::text, ',' order by position)
   from public.chat_message_attachments where message_id = '00000000-0000-0000-0000-00000000ca10'),
  '1,2', 'positions are assigned by array order');
select is(
  (select body from public.chat_messages where id = '00000000-0000-0000-0000-00000000ca10'),
  'kolla dessa', 'the message row carries the text');

-- image-only message
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select lives_ok($$
  select public.post_chat_message(
    '00000000-0000-0000-0000-0000000caf01'::uuid,
    null,
    '00000000-0000-0000-0000-00000000ca20'::uuid,
    jsonb_build_array(
      jsonb_build_object('path', '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca20/1-c.jpg',
        'mime_type', 'image/jpeg', 'size_bytes', 1500))
    )
$$, 'an image-only message (no text) is accepted');
set local role postgres;
select ok(
  (select body is null from public.chat_messages where id = '00000000-0000-0000-0000-00000000ca20'),
  'the image-only message has a NULL body');

-- ========================================================================
-- Section B — post_chat_message rejections
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);

select throws_ok($$
  select public.post_chat_message('00000000-0000-0000-0000-0000000caf01'::uuid, null, gen_random_uuid(), '[]'::jsonb)
$$, null, null, 'a message with no text and no images is rejected');

select throws_ok($$
  select public.post_chat_message('00000000-0000-0000-0000-0000000caf01'::uuid, 'x', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('path','p1','mime_type','image/jpeg','size_bytes',1),
      jsonb_build_object('path','p2','mime_type','image/jpeg','size_bytes',1),
      jsonb_build_object('path','p3','mime_type','image/jpeg','size_bytes',1),
      jsonb_build_object('path','p4','mime_type','image/jpeg','size_bytes',1),
      jsonb_build_object('path','p5','mime_type','image/jpeg','size_bytes',1)))
$$, null, null, 'a message with five images is rejected');

select throws_ok($$
  select public.post_chat_message('00000000-0000-0000-0000-0000000caf01'::uuid, 'x',
    '00000000-0000-0000-0000-00000000ca30'::uuid,
    jsonb_build_array(jsonb_build_object(
      'path','00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca03/00000000-0000-0000-0000-00000000ca10/x.jpg',
      'mime_type','image/jpeg','size_bytes',1000)))
$$, null, null, 'an attachment path outside {challenge}/{caller}/{message}/ is rejected');

select is(
  (select count(*)::int from public.chat_messages where id = '00000000-0000-0000-0000-00000000ca30'),
  0, 'the rejected send left no message row (atomic)');

-- ========================================================================
-- Section C — list_chat_messages: attachments visible for an active message
-- ========================================================================
select is(
  (select jsonb_array_length(attachments)
   from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')
   where id = '00000000-0000-0000-0000-00000000ca10'),
  2, 'a co-member sees both attachments of an active message via list_chat_messages');
select ok(
  (select attachments -> 0 ->> 'path'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')
   where id = '00000000-0000-0000-0000-00000000ca10')
  like '%/1-a.jpg',
  'the attachment entry carries position + path');

-- a non-member: base table + read model both empty
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca03","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.chat_message_attachments),
  0, 'a non-member reads no chat_message_attachments (admin-only base policy)');
select is(
  (select count(*)::int from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')),
  0, 'a non-member gets no rows from list_chat_messages');
select ok(
  not public._chat_attachment_readable(
    '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg'),
  '_chat_attachment_readable is false for a non-member');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'chat-media'
     and name = '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg'),
  0, 'a non-member cannot read the storage object either');

-- a member CAN read the active object
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select ok(
  public._chat_attachment_readable(
    '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg'),
  '_chat_attachment_readable is true for a co-member while the message is active');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'chat-media'
     and name = '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca10/1-a.jpg'),
  1, 'a co-member can read the active-message storage object');

-- ========================================================================
-- Section D — hide the image-only message; images become unreachable
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}', true);
select lives_ok(
  $$select public.hide_chat_message('00000000-0000-0000-0000-00000000ca20', 'olämplig bild')$$,
  'an admin hides the image-only message');

-- member: attachments now '[]', object unreadable, predicate false
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select is(
  (select attachments
   from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')
   where id = '00000000-0000-0000-0000-00000000ca20'),
  '[]'::jsonb, 'a member gets attachments = [] for the hidden message');
select ok(
  not public._chat_attachment_readable(
    '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca20/1-c.jpg'),
  '_chat_attachment_readable is false once the message is hidden');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'chat-media'
     and name = '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca20/1-c.jpg'),
  0, 'a member can no longer read the hidden message''s storage object (path reuse blocked)');

-- admin: still full
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}', true);
select is(
  (select jsonb_array_length(attachments)
   from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')
   where id = '00000000-0000-0000-0000-00000000ca20'),
  1, 'an admin still sees the hidden message''s attachment (moderation context)');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'chat-media'
     and name = '00000000-0000-0000-0000-0000000caf01/00000000-0000-0000-0000-00000000ca02/00000000-0000-0000-0000-00000000ca20/1-c.jpg'),
  1, 'an admin can still read the hidden message''s storage object');
-- the hidden row is still present in the read model (visible as status=hidden),
-- just gutted of body + attachments for a member — the existing body-privacy
-- gate for a message WITH text is regression-covered by 0021.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select is(
  (select status from public.list_chat_messages('00000000-0000-0000-0000-0000000caf01')
   where id = '00000000-0000-0000-0000-00000000ca20'),
  'hidden', 'a member still sees the hidden message as a row with status=hidden');

-- ========================================================================
-- Section E — constraints, direct writes, anon, Realtime (as postgres)
-- ========================================================================
set local role postgres;

select throws_ok($$
  insert into public.chat_message_attachments (message_id, challenge_id, position, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000ca10', '00000000-0000-0000-0000-0000000caf01', 5,
          'zz', 'image/jpeg', 10)
$$, null, null, 'position 5 is rejected by the CHECK');

select throws_ok($$
  insert into public.chat_message_attachments (message_id, challenge_id, position, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000ca10', '00000000-0000-0000-0000-0000000caf01', 1,
          'dup', 'image/jpeg', 10)
$$, null, null, '(message_id, position) is unique — a second row at position 1 is rejected');

select throws_ok($$
  insert into public.chat_message_attachments (message_id, challenge_id, position, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000ca10', '00000000-0000-0000-0000-0000000caf02', 3,
          'xchallenge', 'image/jpeg', 10)
$$, null, null, 'composite FK: an attachment whose challenge_id != its message''s is rejected');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);
select throws_ok($$
  insert into public.chat_message_attachments (message_id, challenge_id, position, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000ca10', '00000000-0000-0000-0000-0000000caf01', 3,
          'member-write', 'image/jpeg', 10)
$$, null, null, 'a member cannot INSERT chat_message_attachments directly');

set local role postgres;
select ok(
  not has_function_privilege('anon', 'public._chat_attachment_readable(text)', 'execute'),
  'anon has NO EXECUTE on _chat_attachment_readable');
select ok(
  not has_function_privilege('anon', 'public.post_chat_message(uuid, text, uuid, jsonb)', 'execute'),
  'anon has NO EXECUTE on post_chat_message');

select ok(
  not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_message_attachments'
  ),
  'chat_message_attachments is NOT in the supabase_realtime publication');
select ok(
  (not exists (select 1 from pg_publication where pubname = 'supabase_realtime'))
  or exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_activity'
  ),
  'chat_activity is still the Realtime signal table');

select * from finish();
rollback;
