-- ============================================================================
-- pgTAP — Training activity cards in Shared Chat / 0029
--
-- Proves supabase/migrations/20260907120000_training_chat_cards.sql:
--   * an INSERT into training_entries creates exactly one sender_type=
--     'training_card' chat_messages row (trainer as sender_user_id, NULL body,
--     training_entry_id set) — for the normal path, add_training_session and
--     approve_retroactive_registration alike
--   * idempotent: training_entry_id is UNIQUE; a second card for the same entry
--     is rejected; editing the entry (UPDATE) does NOT create a second card
--   * chat_messages_sender_coherent enforces the 'training_card' shape
--   * chat_activity gets a row when a card is created (Realtime signal)
--   * list_chat_messages returns a `training_card` jsonb resolved LIVE from the
--     entry (activity, duration, note, date, entry_status, proof paths) for a
--     member; NULL for a hidden card seen by a non-admin; full to an admin
--   * an invalidated entry keeps its card, which now reports entry_status
--     'invalidated'
--   * a participant cannot forge a card — post_chat_message always writes
--     sender_type='participant', training_entry_id NULL
--   * a SUBMITTED (pending) retroactive request creates NO card; APPROVAL does;
--     a REJECTED request creates none
--   * ON DELETE CASCADE: physically deleting the entry removes its card
--   * regression: anon has no EXECUTE on list_chat_messages; chat_messages /
--     chat_message_attachments / training tables still not Realtime-published;
--     chat_activity is
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(36);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000002901', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tc2901@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000002902', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tc2902@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-000000002903', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tc2903@example.test', '{"display_name":"Ove"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000002901';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000029f1', 'TrainingCards', current_date - 30, current_date + 30,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-000000002901');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000029f1', '00000000-0000-0000-0000-000000002902',
        current_date - 30, true, '00000000-0000-0000-0000-000000002901');

create or replace function pg_temp.obj(p_path text)
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values ('proofs', p_path);
$$;

-- ========================================================================
-- Section A — a training entry creates exactly one card
-- ========================================================================
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes, activity)
values ('00000000-0000-0000-0000-0000000029e1', '00000000-0000-0000-0000-0000000029f1',
        '00000000-0000-0000-0000-000000002902', current_date, 1, 45, 'Löpning');

select is(
  (select count(*)::int from public.chat_messages
   where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  1, 'one training_card row was created for the new entry');
select is(
  (select sender_type from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  'training_card', 'the card row has sender_type=training_card');
select is(
  (select sender_user_id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  '00000000-0000-0000-0000-000000002902'::uuid, 'the card is attributed to the trainer');
select ok(
  (select body is null from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  'the card has a NULL body (rendered from the entry, never free text)');
select is(
  (select status from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  'active', 'the card starts active');
select ok(
  exists (select 1 from public.chat_activity a
          join public.chat_messages c on c.challenge_id = a.challenge_id and c.seq = a.seq
          where c.training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  'a chat_activity signal row exists for the card (Realtime fan-out)');

-- ========================================================================
-- Section B — idempotency
-- ========================================================================
select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, training_entry_id)
  values ('00000000-0000-0000-0000-0000000029f1', 'training_card',
          '00000000-0000-0000-0000-000000002902', '00000000-0000-0000-0000-0000000029e1')
$$, null, null, 'a second card for the same training_entry_id is rejected (UNIQUE)');

update public.training_entries set duration_minutes = 60, note = 'kändes bra'
  where id = '00000000-0000-0000-0000-0000000029e1';
select is(
  (select count(*)::int from public.chat_messages
   where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  1, 'editing the entry (UPDATE) does not create a second card');

-- ========================================================================
-- Section C — chat_messages_sender_coherent enforces the card shape
-- ========================================================================
select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, training_entry_id)
  values ('00000000-0000-0000-0000-0000000029f1', 'training_card',
          '00000000-0000-0000-0000-000000002902', null)
$$, null, null, 'a training_card row without a training_entry_id is rejected');
select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, training_entry_id)
  values ('00000000-0000-0000-0000-0000000029f1', 'training_card',
          '00000000-0000-0000-0000-000000002902', 'fusk', gen_random_uuid())
$$, null, null, 'a training_card row with a free-text body is rejected');
select throws_ok($$
  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body, training_entry_id)
  values ('00000000-0000-0000-0000-0000000029f1', 'participant',
          '00000000-0000-0000-0000-000000002902', 'hej', gen_random_uuid())
$$, null, null, 'a participant row cannot carry a training_entry_id');

-- ========================================================================
-- Section D — list_chat_messages resolves the card live (as Pia, a member)
-- ========================================================================
select pg_temp.obj('00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
  || current_date::text || '/p1.jpg');
select pg_temp.obj('00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
  || current_date::text || '/p2.jpg');
insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes, position)
values
  ('00000000-0000-0000-0000-0000000029e1', '00000000-0000-0000-0000-0000000029f1',
   '00000000-0000-0000-0000-000000002902',
   '00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/' || current_date::text || '/p1.jpg',
   'image/jpeg', 1000, 1),
  ('00000000-0000-0000-0000-0000000029e1', '00000000-0000-0000-0000-0000000029f1',
   '00000000-0000-0000-0000-000000002902',
   '00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/' || current_date::text || '/p2.jpg',
   'image/webp', 1200, 2);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);

select is(
  (select (training_card ->> 'activity')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'Löpning', 'training_card.activity is resolved from the entry');
select is(
  (select (training_card ->> 'duration_minutes')::int
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  60, 'training_card.duration_minutes reflects the current (edited) entry');
select is(
  (select (training_card ->> 'note')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'kändes bra', 'training_card.note is resolved from the entry');
select is(
  (select (training_card ->> 'entry_status')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'active', 'training_card.entry_status is active');
select is(
  (select jsonb_array_length(training_card -> 'proofs')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  2, 'training_card.proofs lists both proof objects');
select is(
  (select string_agg(elem ->> 'position', ',' order by (elem ->> 'position')::int)
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1') m,
        lateral jsonb_array_elements(m.training_card -> 'proofs') elem
   where m.training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  '1,2', 'proofs come back ordered by position');
select ok(
  (select (training_card -> 'proofs' -> 0 ->> 'path') like '%/p1.jpg'
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'training_card.proofs carries the storage path (for a member-minted signed URL)');

-- ========================================================================
-- Section E — Dubbelpass / add_training_session gets its own card
-- ========================================================================
select public.add_training_session('00000000-0000-0000-0000-0000000029f1'::uuid, 40, 'Simning', null);
set local role postgres;
select is(
  (select count(*)::int from public.chat_messages c
   join public.training_entries te on te.id = c.training_entry_id
   where te.challenge_id = '00000000-0000-0000-0000-0000000029f1'
     and te.user_id = '00000000-0000-0000-0000-000000002902'
     and te.challenge_date = current_date),
  2, 'a second same-day session (Dubbelpass) produces its own card');

-- ========================================================================
-- Section F — non-member / admin visibility
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002903","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')),
  0, 'a non-member gets no rows (and thus no card payloads)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}', true);
select ok(
  (select (training_card -> 'proofs') is not null
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'an admin sees the resolved card payload');

-- ========================================================================
-- Section G — invalidation keeps the card, flips entry_status
-- ========================================================================
set local role postgres;
update public.training_entries
  set status = 'invalidated', invalidated_by = '00000000-0000-0000-0000-000000002901',
      invalidated_at = now(), invalidated_reason = 'dubbelloggat'
  where id = '00000000-0000-0000-0000-0000000029e1';
select is(
  (select count(*)::int from public.chat_messages
   where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
  1, 'the card is NOT deleted when the entry is invalidated');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);
select is(
  (select (training_card ->> 'entry_status')
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where training_card ->> 'entry_id' = '00000000-0000-0000-0000-0000000029e1'),
  'invalidated', 'the card now reports entry_status=invalidated (rendered as "underkänts")');

-- ========================================================================
-- Section H — moderation: hiding a card withholds its payload from members
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}', true);
select lives_ok($$
  select public.hide_chat_message(
    (select id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1'),
    'olämplig bild')
$$, 'an admin can hide a training card');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);
select ok(
  (select training_card is null and body is null
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where id = (select id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1')),
  'a hidden card returns training_card NULL and body NULL to a member');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}', true);
select ok(
  (select training_card is not null
   from public.list_chat_messages('00000000-0000-0000-0000-0000000029f1')
   where id = (select id from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e1')),
  'an admin still sees the hidden card payload (moderation context)');

-- ========================================================================
-- Section I — a participant cannot forge a card
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);
select is(
  (select sender_type from public.post_chat_message(
     '00000000-0000-0000-0000-0000000029f1'::uuid, 'vanligt meddelande')),
  'participant', 'post_chat_message always writes a participant row');
set local role postgres;
select ok(
  (select training_entry_id is null from public.chat_messages
   where sender_type = 'participant' and body = 'vanligt meddelande'),
  'a participant message never carries a training_entry_id');

-- ========================================================================
-- Section J — retroactive: submit = no card, approve = card, reject = none
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);
select pg_temp.obj('00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
  || (current_date - 8)::text || '/r.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000029f1'::uuid,
  (current_date - 8)::date, 'ingen täckning',
  jsonb_build_array(jsonb_build_object('duration_minutes', 40, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
      || (current_date - 8)::text || '/r.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));

set local role postgres;
select is(
  (select count(*)::int from public.chat_messages c
   join public.training_entries te on te.id = c.training_entry_id
   where te.challenge_date = current_date - 8),
  0, 'SUBMITTING a retroactive request creates no card');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}', true);
select public.approve_retroactive_registration(
  (select id from public.retroactive_training_requests where challenge_date = current_date - 8));

set local role postgres;
select is(
  (select count(*)::int from public.chat_messages c
   join public.training_entries te on te.id = c.training_entry_id
   where te.challenge_date = current_date - 8),
  1, 'APPROVING the request creates the card when the real entry is materialised');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}', true);
select pg_temp.obj('00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
  || (current_date - 9)::text || '/r9.jpg');
select public.submit_retroactive_registration('00000000-0000-0000-0000-0000000029f1'::uuid,
  (current_date - 9)::date, 'test',
  jsonb_build_array(jsonb_build_object('duration_minutes', 40, 'sort_order', 1,
    'proof_storage_path', '00000000-0000-0000-0000-0000000029f1/00000000-0000-0000-0000-000000002902/'
      || (current_date - 9)::text || '/r9.jpg',
    'proof_mime_type', 'image/jpeg', 'proof_size_bytes', 1000)));
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}', true);
select public.reject_retroactive_registration(
  (select id from public.retroactive_training_requests where challenge_date = current_date - 9),
  'inte trovärdigt');
set local role postgres;
select is(
  (select count(*)::int from public.chat_messages c
   join public.training_entries te on te.id = c.training_entry_id
   where te.challenge_date = current_date - 9),
  0, 'a REJECTED request creates no card (no entry materialised)');

-- ========================================================================
-- Section K — ON DELETE CASCADE + regression
-- ========================================================================
insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
values ('00000000-0000-0000-0000-0000000029e9', '00000000-0000-0000-0000-0000000029f1',
        '00000000-0000-0000-0000-000000002902', current_date - 1, 1, 30);
select is(
  (select count(*)::int from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e9'),
  1, 'a fresh entry has its card');
delete from public.training_entries where id = '00000000-0000-0000-0000-0000000029e9';
select is(
  (select count(*)::int from public.chat_messages where training_entry_id = '00000000-0000-0000-0000-0000000029e9'),
  0, 'physically deleting the entry cascades its card away');

select ok(
  not has_function_privilege('anon', 'public.list_chat_messages(uuid, bigint, integer)', 'execute'),
  'anon has no EXECUTE on list_chat_messages');
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename in ('chat_messages', 'chat_message_attachments', 'training_entries', 'training_proofs')),
  'chat_messages / attachments / training tables are still NOT Realtime-published');
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_activity'),
  'chat_activity is still the Realtime signal');

select * from finish();
rollback;
