-- ============================================================================
-- Hälsoutmaningen — Shared Chat: ❤️ likes + ↩️ replies / 0030  (schema — part 1)
--
-- Spec: docs/superpowers/specs/2026-09-07-chat-replies-likes-design.md §9
-- Plan: docs/superpowers/plans/2026-09-07-chat-replies-likes.md (Task A)
--
-- Depends on 0018–0021 (chat), 0027 (chat_messages_id_challenge_uniq — the
-- composite FK target), 0029 (training cards). Forward-only, ADDITIVE. This
-- PART 1 adds ONLY the schema foundation; it changes no existing object's
-- behaviour and adds no function. The write RPCs (a shared _create_chat_message
-- helper, a reply-aware post_chat_message, toggle_chat_message_like) and the
-- list_chat_messages v4 read model are Task B and are appended to THIS file
-- there.
--
-- ── Replies ────────────────────────────────────────────────────────────────
--   A reply is an ordinary chat_messages row that additionally points at the
--   message it quotes — there is NO separate replies table, so a reply keeps
--   every message behaviour (seq, rate limit, moderation, unread, attachments,
--   the chat_activity Realtime signal) for free.
--
--   chat_messages.reply_to_message_id — nullable. The composite FK
--   (reply_to_message_id, challenge_id) -> chat_messages(id, challenge_id) —
--   the same (id, challenge_id) unique key chat_message_attachments already
--   uses — FK-GUARANTEES a reply's parent is in the SAME challenge; a client
--   can never quote another challenge's message. MATCH SIMPLE: a row with a
--   NULL reply_to_message_id (every existing row, every non-reply) is
--   unconstrained.
--
--   ON DELETE SET NULL (reply_to_message_id) is the PG15+ column-list form:
--   physically deleting a parent nulls ONLY the child's link and keeps the
--   child (its NOT NULL challenge_id is untouched) — the child survives as a
--   plain message with no quote. The quote shown to clients is resolved LIVE by
--   list_chat_messages from the parent's CURRENT state (Task B), never a stored
--   snapshot, so moderating the parent later retroactively hides the quote.
--
-- ── Likes ──────────────────────────────────────────────────────────────────
--   chat_message_likes — one heart per (message, user). PRIMARY KEY
--   (message_id, user_id) enforces the "at most one" invariant in the database,
--   not the app. Composite FK (message_id, challenge_id) -> chat_messages
--   (id, challenge_id) ON DELETE CASCADE: a like's challenge_id is FK-guaranteed
--   equal to its message's (no cross-challenge like), and a like on a
--   physically removed message / challenge is meaningless so it goes with it.
--   user_id -> profiles ON DELETE CASCADE: removing an account removes its
--   hearts and the counts adjust naturally.
--
-- ── Security (mirrors chat_messages / chat_message_attachments) ─────────────
--   * chat_message_likes base SELECT is ADMIN-ONLY. Ordinary members never read
--     the table directly — Task B's list_chat_messages returns like_count /
--     liked_by_me per visible row and withholds both for a hidden message, so a
--     hidden message's like metadata (count, liker identity, liked_by_me) can
--     never leak via PostgREST.
--   * NO write policy. Task B's toggle_chat_message_like (SECURITY DEFINER) is
--     the only writer; a client cannot forge (message_id, challenge_id,
--     user_id) because there is no INSERT path that accepts arbitrary values —
--     structural, not a policy check.
--   * Nothing here is added to supabase_realtime. Task B makes a like bump the
--     existing chat_activity signal row; chat_message_likes itself stays
--     unpublished. No core table gains a foreign key to a social table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_messages.reply_to_message_id — nullable self-reference
-- ----------------------------------------------------------------------------
alter table public.chat_messages
  add column reply_to_message_id uuid;

alter table public.chat_messages
  add constraint chat_messages_reply_to_fk
  foreign key (reply_to_message_id, challenge_id)
  references public.chat_messages (id, challenge_id)
  on delete set null (reply_to_message_id);

alter table public.chat_messages
  add constraint chat_messages_reply_not_self
  check (reply_to_message_id is null or reply_to_message_id <> id);

comment on column public.chat_messages.reply_to_message_id is
  'NULL for a normal message; for a reply, the message it quotes. Composite FK '
  '(reply_to_message_id, challenge_id) -> chat_messages(id, challenge_id) '
  'guarantees the parent is in the same challenge. ON DELETE SET NULL '
  '(reply_to_message_id): a physically deleted parent nulls only this link, the '
  'child reply survives. The reply_preview shown to clients is resolved LIVE by '
  'list_chat_messages from the parent''s CURRENT state (Task B) — never a stored '
  'snapshot — so moderating the parent later retroactively hides the quote.';

-- Partial: only real reply links are indexed — moderation tooling and a future
-- "X replied to your message" notification lookup. The list_chat_messages
-- preview subquery itself resolves the parent by PRIMARY KEY, not this index.
create index chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- ----------------------------------------------------------------------------
-- 2. chat_message_likes — normalized one-heart-per-(message, user)
-- ----------------------------------------------------------------------------
create table public.chat_message_likes (
  message_id   uuid not null,
  challenge_id uuid not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),

  -- One heart per user per message — the invariant lives in the database.
  primary key (message_id, user_id),

  -- The like's challenge_id is FK-guaranteed identical to its message's: a like
  -- can never be attached to a message in another challenge. ON DELETE CASCADE:
  -- a like on a physically removed message / challenge is meaningless.
  constraint chat_message_likes_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id) on delete cascade
);

comment on table public.chat_message_likes is
  'One heart per (message, user). Written only by toggle_chat_message_like '
  '(Task B). Base SELECT is admin-only — members read like_count / liked_by_me '
  'through list_chat_messages, which withholds both for a hidden message. Not '
  'Realtime-published (a like bumps the existing chat_activity row instead).';

-- The PK (message_id, user_id) already serves both read-model lookups:
--   like_count  -> count(*) WHERE message_id = $1        (leading column)
--   liked_by_me -> WHERE message_id = $1 AND user_id = $2 (full key)
-- so no secondary index is added.

-- ----------------------------------------------------------------------------
-- RLS — admin-only base read, no write policy (the RPC is the only writer)
-- ----------------------------------------------------------------------------
alter table public.chat_message_likes enable row level security;
revoke all on public.chat_message_likes from anon, authenticated;
grant select on public.chat_message_likes to authenticated;

create policy chat_message_likes_select on public.chat_message_likes
  for select to authenticated
  using (public.is_admin());

comment on policy chat_message_likes_select on public.chat_message_likes is
  'Admin-only. Ordinary members never read this table directly — they use '
  'list_chat_messages (Task B), which returns like_count = 0 / liked_by_me = '
  'false for a hidden message. Prevents a hidden message''s like metadata '
  'leaking via PostgREST.';

-- No INSERT / UPDATE / DELETE policy: toggle_chat_message_like (Task B) is the
-- only writer. A client cannot forge a (message_id, challenge_id, user_id) row
-- because there is no INSERT path that accepts arbitrary values — the same
-- structural guarantee chat_message_attachments relies on.
