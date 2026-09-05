# Hälsoutmaningen — Shared Chat

One shared conversation per challenge. Every active member of a challenge
reads and writes the same room; there are no threads, no direct messages and
no second room. Chat is social glue around the product
(**träna varje dag → registrera → se gruppen → streak/skuld/ranking → final**),
never part of challenge logic — a chat failure cannot touch training logging,
day states, streaks, liability/KASSAN, ranking, Straffbanken or
efterregistrering.

Design source of truth:
[`docs/superpowers/specs/2026-09-05-shared-chat-design.md`](./superpowers/specs/2026-09-05-shared-chat-design.md).
Implementation plan:
[`docs/superpowers/plans/2026-09-05-shared-chat-implementation.md`](./superpowers/plans/2026-09-05-shared-chat-implementation.md).

Migrations:
[`supabase/migrations/20260905140000_chat_schema.sql`](../supabase/migrations/20260905140000_chat_schema.sql),
[`supabase/migrations/20260905140100_chat_rpcs.sql`](../supabase/migrations/20260905140100_chat_rpcs.sql).
pgTAP coverage:
[`supabase/tests/0018…0020`](../supabase/tests/) (26 + 34 + 9 = 69 assertions).

---

## 1. Data model

Two tables (`public`):

| Table             | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `chat_messages`   | One row per posted message. Never physically deleted.                 |
| `chat_read_state` | One row per `(challenge_id, user_id)` — the reader's `last_read_seq`. |

`chat_messages` columns of note:

- `seq bigint generated always as identity` — the canonical order/cursor key
  (see §2).
- `sender_type` — `'participant'` or `'game_master'`. A participant row must
  have a `sender_user_id`; a Game Master row must not
  (`chat_messages_sender_coherent`).
- `body text` — `1..1000` characters, enforced by `chat_messages_body_len`.
  The client trims before counting; the RPC trims and re-checks.
- `status` — `'active'` or `'hidden'`. A hidden row keeps its original `body`
  in storage and gains `hidden_by` / `hidden_at` / `hidden_reason`
  (`chat_messages_hidden_coherent`).
- `game_master_event_id` — nullable link to the originating
  `game_master_event`; unused by v1 chat itself, present for the Game Master
  output channel work that follows.

`audit_log_entity_type_valid` was widened with `'chat_message'`.

---

## 2. Ordering: `seq`, not `created_at`

**`seq` is the only authority for order, pagination and the unread cursor.**
`created_at` is display metadata (date separators, timestamps) and nothing
else.

`seq` is a Postgres identity column. Identity values are handed out in
**allocation order, which is not the same as transaction commit order** —
under concurrency, a transaction that acquired a lower `seq` can commit after
one that acquired a higher `seq`. The app does **not** claim `seq` equals
commit order. What it relies on is weaker and true: `seq` is a stable,
strictly increasing, gap-tolerant total order that every client sorts by, so
every client renders the same sequence.

Consequences, all implemented:

- The message list is always sorted by `seq` client-side
  (`sortBySeq` in `src/features/chat/chat.ts`), after flattening every loaded
  page — never by API row order, never by `created_at`.
- Upward pagination is `seq < <oldest loaded seq>`, ordered `seq desc`,
  `limit N` (`fetchOlderChatMessages`).
- Unread count is `count(*) where seq > last_read_seq` (`fetchUnreadCount`),
  a hidden message still counts.
- `mark_chat_read` only ever moves `last_read_seq` **forward**
  (`greatest(existing, incoming)`), so a late-arriving "mark read" for an
  older position can never regress the cursor.
- A `seq` that belongs to another challenge, or was never allocated at all,
  is rejected by `mark_chat_read`.

---

## 3. Write path — RPCs only

All writes go through `SECURITY DEFINER` functions
(`20260905140100_chat_rpcs.sql`); `chat_messages` and `chat_read_state` have
**no INSERT/UPDATE/DELETE RLS policies**, so a client cannot write a row
directly.

### `post_chat_message(p_challenge_id uuid, p_body text) returns chat_messages`

- Caller must have an **active** membership in the challenge.
- The server sets `sender_user_id` to `auth.uid()` and `sender_type` to
  `'participant'` itself — the client passes only the challenge id and the
  body, so it **cannot impersonate another user and cannot post as Game
  Master**.
- Body is trimmed and must be `1..1000` characters.
- **Rate limit: 10 messages per rolling 30 seconds per user.** Checked as a
  `count(*)` of the caller's own participant messages with
  `created_at > now() - interval '30 seconds'`. The 11th within the window is
  rejected with a Swedish message.

### `mark_chat_read(p_challenge_id uuid, p_seq bigint) returns void`

- Caller must be a challenge member.
- `p_seq` must be a real `seq` in that challenge.
- Upserts `chat_read_state`, advancing `last_read_seq` forward only (§2).

### `hide_chat_message(p_message_id uuid, p_reason text) returns void` (admin)

- Rejects a non-admin caller.
- Requires a non-empty `p_reason`.
- Refuses a `game_master` row (those are withdrawn by cancelling the event,
  not here) and an already-hidden row.
- Sets `status='hidden'` + `hidden_by`/`hidden_at`/`hidden_reason`; the
  original `body` stays in the row.
- Writes **exactly one** `audit_log` row (`entity_type='chat_message'`,
  `action='chat_message_hidden'`, actor, target, reason). The audit payload
  never contains the message body.

There is **no participant edit and no participant delete** — neither an RPC
nor a UI affordance.

---

## 4. Read path & RLS

Reads are plain `select`s constrained by RLS:

- `chat_messages` SELECT: `is_admin() or is_challenge_member(challenge_id)`.
- `chat_read_state` SELECT: `user_id = auth.uid()` (your own cursor only).
- `anon` has no access to either table.

A hidden message is still returned by the select (the row is retained); the
client renders it as the fixed string `[Borttaget av administratör]` and
never shows the retained body (`displayBody` in `chat.ts`).

---

## 5. Realtime

**First Supabase Realtime consumer in this codebase.**

- `20260905140000_chat_schema.sql` adds `chat_messages` to the
  `supabase_realtime` publication (guarded `do $$ … $$` so a re-run or a
  project where it is already present does not error). **This is the first
  table this project has added to `supabase_realtime` — verify replication is
  actually enabled on the hosted project during rollout.**
- `useChatMessages` opens **one** channel per open challenge —
  `supabase.channel('chat:' + challengeId)` with a `postgres_changes`
  listener for `INSERT` on `public.chat_messages` filtered to
  `challenge_id=eq.<id>` — and removes it (`supabase.removeChannel`) on
  unmount or challenge change.
- Realtime enforces the same `chat_messages_select` RLS for the connected
  JWT, so a non-member's subscription simply receives nothing.
- **The handler is a signal only.** It calls `invalidateQueries` on the
  message-list and unread keys and does nothing else — it never reads the
  payload and never trusts arrival order. TanStack Query stays the single
  canonical cache; the refetch it triggers is re-sorted by `seq`. An
  out-of-order or dropped delivery is repaired by the next refetch.
- A socket disconnect degrades to the existing `staleTime` (15 s) /
  refetch-on-focus polling — chat is never solely dependent on the socket.
- `chat_read_state` is deliberately **not** Realtime-subscribed in v1.

---

## 6. UI

- A floating **chat bubble** (`ChatBubble`) mounted once in `AppShell`,
  sibling of `GameMasterAmbush`. It is **not** a sixth bottom-nav item — the
  five-item nav is unchanged. It renders nothing until there is both a
  challenge and a signed-in user, and shows the unread count (capped `99+`
  for display; `last_read_seq` remains the authority).
- Tapping it opens `ChatPanel` inside the shared `Sheet` (portal, focus
  trap, Esc) at both breakpoints.
- `ChatPanel` renders messages in the `seq` order the hook provides, one
  date separator per challenge-local day, a distinct `GAME MASTER` label for
  Game Master rows, and a composer that disables send for an
  empty/whitespace/over-limit body and keeps the draft text if a post fails.
- Load/empty/error states stay understated **inside** the panel — a chat
  failure never raises a page-level error.
- Admin only: a per-message **Dölj** affordance (`ChatModerationSheet`)
  reusing the mandatory-reason `ConfirmSheet` pattern. Wired through
  `ChatPanel`'s `renderModeration` prop so the chat feature imports no
  admin API.

---

## 7. Non-goals (v1)

Explicitly out of scope, by spec §16:

- images, file attachments
- reactions / likes
- threads / replies
- direct messages, multiple rooms
- message editing
- physical message deletion
- push notifications
- per-message read receipts beyond the single `last_read_seq` cursor
- keyword / phrase / name auto-triggers for Game Master (only a literal
  `@gm`, defined in the Game Master spec — not built here)
- Realtime on `chat_read_state`
