-- ============================================================================
-- Hälsoutmaningen — Chat images / 0027  chat_message_attachments + storage
--
-- Spec: docs/superpowers/specs/2026-09-06-chat-proof-media-polish-design.md §B3
-- Plan: docs/superpowers/plans/2026-09-06-chat-proof-media-polish-implementation.md (Task 7)
--
-- Depends on 0018–0021 (chat) + 0002 (storage / try_cast_uuid). Forward-only,
-- ADDITIVE. Adds one table, one private Storage bucket + its policies, and one
-- SECURITY DEFINER predicate. It also:
--   * makes chat_messages.body NULLABLE (an image-only message has no text) —
--     the "text OR >=1 image" rule moves into post_chat_message (next
--     migration), exactly like the "no INSERT policy" guarantee: the RPC is
--     the only writer, so the invariant lives there;
--   * adds a UNIQUE (id, challenge_id) on chat_messages so an attachment's
--     challenge_id is FK-guaranteed equal to its message's, not merely trusted.
--
-- Security model mirrors the corrected chat body model (20260905140200):
--   * chat_message_attachments base SELECT is ADMIN-ONLY. Members read
--     attachment info only through list_chat_messages (next migration), which
--     withholds it for a hidden message.
--   * The image bytes live in a PRIVATE bucket. The storage read policy lets a
--     member fetch an object only while its message is status='active' — hiding
--     a message instantly makes its images unreachable, even with a
--     previously-obtained path. Admin keeps moderation access.
--   * Nothing here is added to supabase_realtime.
-- ============================================================================

-- (No audit-vocabulary change: this migration writes no audit rows. Hiding a
-- message with images still goes through hide_chat_message, whose existing
-- 'chat_message' / 'chat_message_hidden' audit row already covers it.)

-- ----------------------------------------------------------------------------
-- chat_messages — body nullable + composite unique key
-- ----------------------------------------------------------------------------
alter table public.chat_messages
  drop constraint if exists chat_messages_body_len;
alter table public.chat_messages
  alter column body drop not null;
alter table public.chat_messages
  add constraint chat_messages_body_len
  check (body is null or char_length(body) between 1 and 1000);

comment on column public.chat_messages.body is
  'Message text. NULL for an image-only message. The "text OR >=1 attachment" '
  'rule is enforced in post_chat_message (the only writer), not by a CHECK '
  '(attachments are inserted in the same transaction, after the message row).';

alter table public.chat_messages
  add constraint chat_messages_id_challenge_uniq unique (id, challenge_id);

-- ----------------------------------------------------------------------------
-- chat_message_attachments
-- ----------------------------------------------------------------------------
create table public.chat_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  -- 1..4, display order. UNIQUE (message_id, position) + this CHECK => at most
  -- four attachments per message, deterministic order. post_chat_message also
  -- rejects > 4 before the insert (belt and braces).
  position     smallint not null
                 constraint chat_message_attachments_position_valid
                 check (position between 1 and 4),
  storage_path text not null unique
                 constraint chat_message_attachments_path_len
                 check (char_length(storage_path) between 1 and 400),
  mime_type    text not null
                 constraint chat_message_attachments_mime_valid
                 check (mime_type in ('image/jpeg', 'image/png', 'image/webp',
                                      'image/heic', 'image/heif')),
  size_bytes   bigint not null
                 constraint chat_message_attachments_size_valid
                 check (size_bytes > 0 and size_bytes <= 15728640), -- 15 MiB
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  created_at   timestamptz not null default now(),

  -- The attachment's challenge_id is FK-guaranteed identical to its message's:
  -- an attachment can never be linked to a message in a different challenge.
  constraint chat_message_attachments_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id) on delete cascade,
  constraint chat_message_attachments_one_per_slot unique (message_id, position)
);

comment on table public.chat_message_attachments is
  'Up to 4 private image attachments per chat message. Base SELECT is '
  'admin-only (like chat_messages since 20260905140200) — members read '
  'attachment info through list_chat_messages, which withholds it for a hidden '
  'message. The bytes are in the private "chat-media" bucket; the storage read '
  'policy additionally requires the message to be status=''active''.';

create index chat_message_attachments_message_idx
  on public.chat_message_attachments (message_id, position);
create index chat_message_attachments_challenge_idx
  on public.chat_message_attachments (challenge_id);

-- ----------------------------------------------------------------------------
-- RLS — read-only for the app; admin-only base read. RPC is the only writer.
-- ----------------------------------------------------------------------------
alter table public.chat_message_attachments enable row level security;
revoke all on public.chat_message_attachments from anon, authenticated;
grant select on public.chat_message_attachments to authenticated;

create policy chat_message_attachments_select on public.chat_message_attachments
  for select to authenticated
  using (public.is_admin());

comment on policy chat_message_attachments_select on public.chat_message_attachments is
  'Admin-only. Ordinary members never read this table directly — they use '
  'list_chat_messages, which returns [] for a hidden message. Prevents a '
  'hidden message''s image paths leaking via PostgREST.';

-- No INSERT / UPDATE / DELETE policy: post_chat_message (next migration) is the
-- only writer. A client cannot forge a message_id/challenge_id link because
-- there is no INSERT path that accepts arbitrary values — structural, not a
-- policy check.

-- ----------------------------------------------------------------------------
-- _chat_attachment_readable — the storage-policy predicate
-- ----------------------------------------------------------------------------
-- One boolean, same shape/rationale as _weight_is_hidden / is_challenge_member:
-- SECURITY DEFINER so it can see the admin-only chat_message_attachments /
-- chat_messages rows an inline sub-select in the storage policy could not.
-- True iff the path backs an attachment of an ACTIVE message in a challenge the
-- current caller belongs to. Never returns a path, name or any content.
create or replace function public._chat_attachment_readable(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_message_attachments a
    join public.chat_messages m on m.id = a.message_id
    where a.storage_path = p_path
      and m.status = 'active'
      and public.is_challenge_member(a.challenge_id)
  );
$$;

revoke all on function public._chat_attachment_readable(text) from public, anon;
grant execute on function public._chat_attachment_readable(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Private Storage bucket "chat-media"
--   path: {challenge_id}/{user_id}/{message_id}/{position}-{uuid}.{ext}
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Upload: into your own folder ([2] = auth.uid()), in a challenge you belong to
-- ([1]). post_chat_message then links only paths under
-- {challenge}/{your uid}/{message id}/.
create policy "chat-media: member uploads into own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_challenge_member(
          public.try_cast_uuid((storage.foldername(name))[1])
        )
  );

-- Read: admin always; otherwise only while the object backs an attachment of an
-- ACTIVE message in a challenge the reader belongs to (via the SECURITY DEFINER
-- predicate). A hidden message => the predicate is false => no signed URL, even
-- with a path obtained earlier.
create policy "chat-media: read active-message attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (public.is_admin() or public._chat_attachment_readable(name))
  );

-- Owner or admin may replace / delete (failed-send cleanup, moderation).
create policy "chat-media: owner or admin update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'chat-media'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  )
  with check (
    bucket_id = 'chat-media'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  );

create policy "chat-media: owner or admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_admin())
  );
