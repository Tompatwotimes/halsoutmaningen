# Implementation plan — Shared Chat ❤️ Likes & ↩️ Instagram-style Replies

Date: 2026-09-07

Design: `docs/superpowers/specs/2026-09-07-chat-replies-likes-design.md`
(APPROACH A — recommended and locked).

**This plan is not executed in the design session.** Each task below is a
self-contained TDD unit: exact files, a RED test that must genuinely fail first
(record the failure — no `it.skip`, per the standing RULING 1), the
implementation, the GREEN verification, and a commit boundary.

Baseline: `main` = `production` = `b72af65793c1c11af71e27b40ef32959fdcbb0e3`,
27 migrations, latest `20260907120000_training_chat_cards`.

Branch for implementation: `feat/chat-replies-likes` off `main`.
The migration timestamp is chosen at implementation time as the next value
after `20260907120000` (e.g. `20260908120000` — **verify no newer migration
landed first**). Referred to below as `<MIG>`.

---

## Ordering & rationale

DB-first rollout (design §22.3): the migration is a benign superset for the
current production frontend and a hard prerequisite for the new one. Tasks A–B
build and prove the DB; C–I build the frontend against it; J is the rollout.

| Task | Area | Depends on |
| ---- | ---- | ---------- |
| A | DB — schema (column, table, FK, indexes, RLS) | — |
| B | DB — RPC/read model (`_create_chat_message` helper, `post_chat_message` wrapper, `set_chat_message_like`, `list_chat_messages` v4) + pgTAP `0030` | A |
| C | Frontend — types + `chat-api` mapping + backwards-compat | B (shape only; no live DB needed for unit tests) |
| D | Frontend — likes data layer (`useToggleChatMessageLike`, optimistic cache) | C |
| E | Frontend — `<LikeBadge>` + message action row + double-click like | D |
| F | Frontend — mobile gestures (swipe-to-reply, double-tap-to-like, lightbox coexistence) | E |
| G | Frontend — reply composer mode + `<ReplyQuote>` rendering | C, E |
| H | Frontend — jump-to-original (bounded) | G |
| I | Frontend — moderation/privacy + scroll regression sweep | D–H |
| J | Rollout — `db push`, `db:types`, deploy, verify | A–I merged |

---

## Task A — Database schema

**Files**

- `supabase/migrations/<MIG>_chat_replies_likes.sql` *(new — part 1 of the file;
  Task B appends the RPC section to the same file)*

**RED**

- `supabase/tests/0030_chat_replies_likes.test.sql` *(new)* — write the
  **schema-level** assertions first and run the DB test job (CI
  `Database Tests`, or `supabase test db --local` if Docker is available):
  - `has_column('chat_messages', 'reply_to_message_id')`
  - `col_is_null('chat_messages', 'reply_to_message_id')`
  - `has_table('chat_message_likes')`
  - `col_is_pk('chat_message_likes', ARRAY['message_id','user_id'])`
  - FK `chat_message_likes_message_fk` exists and is `ON DELETE CASCADE`
  - FK `chat_messages_reply_to_fk` exists and is `ON DELETE SET NULL`
  - `has_index('chat_messages', 'chat_messages_reply_to_idx')`
  - `chat_message_likes` RLS enabled; a non-admin `authenticated` role sees 0
    rows; `anon` has no privileges
  - constraint `chat_messages_reply_not_self` rejects `reply_to_message_id = id`
  - `plan(...)` set to the schema-only count for this first run.
  
  Run → these fail (`column ... does not exist`, `relation ... does not
  exist`). **Record the exact failure output in the commit message / PR.**

**Implementation** (`<MIG>` part 1)

```sql
-- 1. Reply link: nullable self-reference, composite FK to (id, challenge_id).
alter table public.chat_messages add column reply_to_message_id uuid;

alter table public.chat_messages
  add constraint chat_messages_reply_to_fk
  foreign key (reply_to_message_id, challenge_id)
  references public.chat_messages (id, challenge_id)
  on delete set null (reply_to_message_id);

alter table public.chat_messages
  add constraint chat_messages_reply_not_self
  check (reply_to_message_id is null or reply_to_message_id <> id);

create index chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- 2. Likes table.
create table public.chat_message_likes (
  message_id   uuid not null,
  challenge_id uuid not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint chat_message_likes_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id)
    on delete cascade
);

comment on table public.chat_message_likes is
  'One heart per (message, user). Written only by set_chat_message_like. '
  'Base SELECT admin-only; members read like_count/liked_by_me via '
  'list_chat_messages. Not Realtime-published.';

alter table public.chat_message_likes enable row level security;
revoke all on public.chat_message_likes from anon, authenticated;
grant select on public.chat_message_likes to authenticated;

create policy chat_message_likes_select on public.chat_message_likes
  for select to authenticated
  using (public.is_admin());
```

**GREEN**

- Re-run `0030` schema assertions → pass. Record output.
- `supabase db lint` clean (if used in CI).

**Commit**

`feat(chat): schema for replies + likes (reply_to_message_id, chat_message_likes)`

---

## Task B — Safe write RPC + read model

**Files**

- `supabase/migrations/<MIG>_chat_replies_likes.sql` *(append part 2)*
- `supabase/tests/0030_chat_replies_likes.test.sql` *(extend with §24.1–§24.4
  of the design)*

**RED**

Add the full pgTAP body from design §24 (tests 1–51). Fixtures: an admin; Pia +
Rune active members of challenge A; Vera an active member of challenge B; a GM
message and a training card in A (insert a `training_entries` row → the
`AFTER INSERT` trigger materialises the card). Run the DB test job → fails
(`function set_chat_message_like does not exist`, `post_chat_message(...,
uuid) does not exist`, `column like_count does not exist`, …). Record output.

**Implementation** (`<MIG>` part 2)

1. **`_create_chat_message(p_challenge_id, p_body, p_message_id, p_attachments,
   p_reply_to_message_id)`** — move the **entire current body** of
   `post_chat_message` (from `20260906120200`) into this private
   `SECURITY DEFINER` function verbatim, then add, right after the
   active-membership check and before the insert:

   ```sql
   if p_reply_to_message_id is not null then
     select challenge_id, status into v_parent_challenge, v_parent_status
     from public.chat_messages where id = p_reply_to_message_id;
     if v_parent_challenge is null then
       raise exception 'Meddelandet du svarar på finns inte';
     end if;
     if v_parent_challenge <> p_challenge_id then
       raise exception 'Meddelandet du svarar på tillhör en annan utmaning';
     end if;
     if v_parent_status <> 'active' then
       raise exception 'Meddelandet går inte längre att svara på';
     end if;
   end if;
   ```

   and set `reply_to_message_id => p_reply_to_message_id` in the `insert into
   public.chat_messages (...)`. Everything else (body validation, ≤4
   attachments, path prefix + real-object check, mime, size, rate limit,
   `sender_user_id := auth.uid()`, `sender_type := 'participant'`, one
   transaction) is unchanged.

   ```sql
   revoke all on function public._create_chat_message(uuid, text, uuid, jsonb, uuid)
     from public, anon, authenticated;
   ```

2. **`post_chat_message` v5** — drop the 4-arg, recreate as a thin wrapper:

   ```sql
   drop function if exists public.post_chat_message(uuid, text, uuid, jsonb);

   create function public.post_chat_message(
     p_challenge_id        uuid,
     p_body                text  default null,
     p_message_id          uuid  default null,
     p_attachments         jsonb default null,
     p_reply_to_message_id uuid  default null
   ) returns public.chat_messages
   language sql security definer set search_path = '' as $$
     select public._create_chat_message(
       p_challenge_id, p_body, p_message_id, p_attachments, p_reply_to_message_id);
   $$;

   revoke all on function public.post_chat_message(uuid, text, uuid, jsonb, uuid)
     from public, anon;
   grant execute on function public.post_chat_message(uuid, text, uuid, jsonb, uuid)
     to authenticated;
   ```

3. **`set_chat_message_like(p_message_id uuid, p_liked boolean) returns jsonb`**
   — *implemented as an idempotent state-setter, not the blind toggle design
   §10.2 sketched.* The approved product requirement is retry-safe: a
   dropped-response retry must never flip the user's intent. `p_liked = true` →
   `insert … on conflict do nothing`; `p_liked = false` → `delete … where
   user_id = auth.uid()`; repeating either is a no-op. Same guards as §10.2
   (auth, message lookup, **active** membership in the message's challenge,
   `status = 'active'` — both a new like and an unlike are refused on a hidden
   message). `chat_activity` is bumped **only when the stored state actually
   changed** (`if found` after the insert/delete). Returns
   `jsonb_build_object('liked', <committed state>, 'like_count', <count>)`.

   ```sql
   revoke all on function public.set_chat_message_like(uuid, boolean) from public, anon;
   grant execute on function public.set_chat_message_like(uuid, boolean) to authenticated;
   ```

4. **`list_chat_messages` v4** — `drop function` + recreate (same pattern as
   `20260906120200` / `20260907120000`), adding the three columns from design
   §11: `like_count integer`, `liked_by_me boolean`, `reply_preview jsonb`,
   each gated `c.status = 'active' or public.is_admin()`. The `reply_preview`
   scalar subquery reads the **direct parent only** (§11.3). EXECUTE stays
   `authenticated`-only.

**GREEN**

- DB test job → `0030` all pass; **`0018`–`0021`, `0027`, `0029` still pass**
  unchanged. Record output.
- Manual `EXPLAIN (ANALYZE, BUFFERS)` of `list_chat_messages` on a ~100-row page
  (seed via a scratch script against a local/branch DB) → no sequential scan on
  `chat_message_likes` or `chat_messages` for the per-row subqueries; index
  scans only. Paste the plan into the PR.

**Commit**

`feat(chat): reply-aware post_chat_message + set_chat_message_like + list v4`

---

## Task C — Frontend types + `chat-api` mapping

**Files**

- `src/features/chat/types.ts` — add:
  ```ts
  export type ReplyPreviewKind =
    | 'text' | 'image' | 'training_card' | 'game_master';

  export interface ReplyPreview {
    /** null => the parent was hidden; render HIDDEN_MESSAGE_PLACEHOLDER. */
    deleted: boolean;
    messageId: string | null;
    seq: number | null;
    senderType: ChatSenderType | null;
    senderUserId: string | null;
    senderDisplayName: string | null;
    kind: ReplyPreviewKind | null;
    text: string | null;        // <= 140 chars, already truncated server-side
    hasImage: boolean;
    training: { activity: string | null; durationMinutes: number } | null;
  }
  ```
  and on `ChatMessage`: `replyToMessageId: string | null`,
  `replyPreview: ReplyPreview | null`, `likeCount: number`,
  `likedByMe: boolean`.
- `src/features/chat/chat-api.ts` — `mapChatRow`: map the four new fields with
  the existing narrowing helpers; add `narrowReplyPreview(v): ReplyPreview |
  null` (returns `null` when the raw value is absent/null; returns
  `{ deleted: true, ... nulls }` when `raw.deleted === true`; otherwise the full
  object). `sendChatMessage` / `SendChatMessageInput` gain an optional
  `replyToMessageId?: string`; pass `p_reply_to_message_id` **only when set**
  (so a non-reply is still a 4-key call — matters for the NEW-frontend +
  OLD-DB window, design §22.2).
- `src/features/chat/chat-api.test.ts` — extend.

**RED**

`chat-api.test.ts` new cases:
- `mapChatRow` with a row containing `like_count: 3`, `liked_by_me: true`,
  `reply_preview: { message_id, kind: 'text', text: 'hej', ... }` →
  `likeCount 3`, `likedByMe true`, `replyPreview.kind 'text'`.
- `mapChatRow` with `reply_preview: { deleted: true }` → `replyPreview.deleted
  === true`, all content fields null.
- **backwards-compat**: `mapChatRow` with a **pre-migration** row (no
  `like_count` / `liked_by_me` / `reply_preview` / `reply_to_message_id` keys)
  → `likeCount 0`, `likedByMe false`, `replyPreview null`, `replyToMessageId
  null`, **no throw** (mirrors the PR A.5 "pre-PR-8 shape" tests).
- `sendChatMessage` without `replyToMessageId` → the `post_chat_message` rpc arg
  object has **no** `p_reply_to_message_id` key (assert via a mocked
  `chatdb.rpc`).
- `sendChatMessage` with `replyToMessageId: 'abc'` → arg object has
  `p_reply_to_message_id: 'abc'`.

Run → fail (fields undefined on the type / not mapped). Record.

**Implementation** — as above.

**GREEN** — `npm run test -- chat-api` green; `npm run typecheck` clean;
`npm run lint` clean.

**Commit** — `feat(chat): map like_count / liked_by_me / reply_preview rows`

---

## Task D — Likes data layer

**Files**

- `src/features/chat/chat-api.ts` — `setChatMessageLike(messageId, liked): Promise<{
  liked: boolean; likeCount: number }>` via `chatRpc('set_chat_message_like',
  { p_message_id, p_liked })` — the Task B RPC is an **idempotent state-setter**
  (`set_chat_message_like(uuid, boolean)`), not a toggle; the client passes the
  desired state so a retry is safe. Swedish error mapping (`chatMessageError`).
- `src/features/chat/useChat.ts` — `useToggleChatMessageLike(challengeId)`:
  a mutation with
  - `onMutate(messageId)`: cancel `chatKeys.messages`, snapshot, optimistically
    patch **every page** of the infinite-query cache — for the matching
    `message.id`, flip `likedByMe` and `likeCount += likedByMe ? -1 : +1`;
    add `messageId` to an in-flight `Set` (module ref or context).
  - `onError`: restore the snapshot; remove from in-flight; surface the Swedish
    message.
  - `onSuccess(data, messageId)`: set `likedByMe = data.liked`,
    `likeCount = data.likeCount` on the cached row (authoritative reconcile);
    remove from in-flight.
  - `onSettled`: (nothing extra — Realtime will also invalidate; that refetch
    reconciles any other client's concurrent like.)
  - export an `isLikePending(messageId)` helper reading the in-flight set.
- `src/features/chat/useChat.test.tsx` *(or a new `useToggleChatMessageLike.test.tsx`)*.

**RED**

- optimistic flip: `likedByMe false→true`, `likeCount 2→3` synchronously on
  `mutate`.
- rollback on rejection: back to `false / 2`, error exposed.
- reconcile on resolve: server says `{ liked: true, like_count: 5 }` →
  cache row shows `5`.
- two rapid `mutate` calls for the same id → the second is a no-op while the
  first is in flight (`isLikePending` true) → final state matches the last
  settled server response.

Run → fail (hook does not exist). Record.

**Implementation** — as above.

**GREEN** — targeted tests green; typecheck + lint clean.

**Commit** — `feat(chat): useToggleChatMessageLike with optimistic reconcile`

---

## Task E — `<LikeBadge>` + message action row + double-click

**Files**

- `src/components/icons.tsx` — add `HeartIcon`, `HeartFilledIcon`, `ReplyIcon`
  (stroke, `currentColor`, `{ size?: number }` prop like the others).
- `src/features/chat/LikeBadge.tsx` *(new)* + `LikeBadge.module.css` — props
  `{ likeCount: number; likedByMe: boolean; onToggle(): void; disabled?: boolean }`.
  Renders nothing for `likeCount === 0`; heart-only for `1`; heart + `tnum`
  count for `≥ 2`; `<button>` with the design §26 `aria-label` matrix;
  filled/accent glyph when `likedByMe`, else outline/muted.
- `src/features/chat/MessageActions.tsx` *(new)* + css — the always-focus-
  reachable row: a ❤️ toggle `<button>` (`Gilla meddelandet` /
  `Ta bort gilla-markering`; card variant `Gilla passet`) and a ↩️ `<button>`
  (`Svara på {sender}s meddelande`). Props include `onLike`, `onReply`,
  `likedByMe`, `likeDisabled`, `senderLabel`, `isCard`.
- `src/features/chat/ChatPanel.tsx` — `MessageRow` gains, for a **non-hidden**
  likeable message (participant / training_card / game_master):
  - `<MessageActions>` after the body/attachments, before/around `{moderation}`
  - `<LikeBadge>` overlapping the card's bottom-right (design §8.1)
  - `onDoubleClick` on the card → toggle like (+ pop unless reduced-motion)
  - wire `useToggleChatMessageLike` + `isLikePending`
  - pass `data-seq={message.seq}` on the card wrapper (needed by Task H)
- `src/features/chat/LikeBadge.test.tsx`, `MessageActions.test.tsx`,
  and `ChatPanel.test.tsx` additions.

**RED**

- `<LikeBadge>`: 0 → `container.firstChild` null; 1 → heart, no digit; 3 →
  `❤︎ 3`; `likedByMe` → filled class; aria-label strings per §26.
- `<MessageActions>`: both buttons present with roles + accessible names;
  Enter/Space on the ❤️ button calls `onLike`; disabled while pending.
- `ChatPanel`: rendering a message with `likeCount: 2` shows the badge; a
  hidden message shows **no** badge and **no** actions; a training card shows
  the badge; `fireEvent.dblClick` on the card calls the toggle; with
  `prefers-reduced-motion` the pop class is absent but the toggle still fires.

Run → fail. Record.

**Implementation** — as above.

**GREEN** — all new + existing chat component tests green; `npm run test`
full suite green; typecheck + lint clean; **no new import cycle** (MessageActions
lives in `features/chat`, not `features/admin`).

**Commit** — `feat(chat): heart badge + message action row + double-click to like`

---

## Task F — Mobile gestures

**Files**

- `src/features/chat/useMessageGestures.ts` *(new)* — a hook returning pointer
  handlers + a live `{ swipeDx, armed }` for a single message card:
  - `pointerdown` → record `startX/startY/startT`, `phase = 'idle'`
  - `pointermove` → `idle`: `|dy|>10` ⇒ `phase='vscroll'` (bail);
    `dx>12 && dx>|dy|*1.5` ⇒ `phase='swipe'` + `setPointerCapture`.
    `swipe`: `preventDefault`, expose `swipeDx = min(dx, 96)`, `armed = dx>=64`.
  - `pointerup` → `swipe` & `dx>=64` ⇒ call `onArmReply()`; else snap back.
    Non-swipe & movement `<10px` ⇒ tap-count logic: `tapCount++`, 260 ms timer;
    `tapCount===2` ⇒ `preventDefault` + `stopPropagation`, call `onToggleLike()`,
    call `onCloseLightbox()`.
  - `pointercancel` → reset.
- `src/features/chat/chat.ts` — pure helpers so the logic is unit-testable
  without a DOM: `classifyPointerMove({dx, dy})` →
  `'idle' | 'vscroll' | 'swipe'`; `isSwipeArmed(dx)`; `REPLY_SWIPE_ARM_PX = 64`,
  `REPLY_SWIPE_MAX_PX = 96`, `DOUBLE_TAP_MS = 260`.
- `src/features/chat/ChatPanel.module.css` — `.message { touch-action: pan-y; }`,
  `.list`/scroller `overscroll-behavior: contain`, swipe transform + `.reply
  Reveal` icon, heart `.pop` keyframes (all gated by
  `@media (prefers-reduced-motion: no-preference)`).
- `src/features/chat/ChatImageGrid.tsx` — accept an optional
  `onLightboxRef` / shared "close" callback so a double-tap on a photo can
  dismiss the lightbox it just opened (design §6.2).
- `src/features/chat/chat.test.ts`, `useMessageGestures.test.tsx`,
  `ChatPanel.test.tsx` additions.

**RED**

- `classifyPointerMove`: `{dx:2,dy:20}→'vscroll'`; `{dx:30,dy:5}→'swipe'`;
  `{dx:5,dy:3}→'idle'`.
- `useMessageGestures`: simulated pointer sequence past 64 px horizontal →
  `onArmReply` called once; a vertical drag → never called; `pointercancel`
  mid-swipe → `swipeDx` returns to 0.
- double-tap: two `pointerup` within 260 ms, `<10px` movement → `onToggleLike`
  once; a single `pointerup` then 300 ms → not called.
- double-tap **on an image thumb**: `onToggleLike` called **and**
  `onCloseLightbox` called (assert the lightbox is not left open).
- reduced-motion: `swipeDx` still tracks, but `ChatPanel` applies no transition
  class.

Run → fail. Record.

**Implementation** — as above. If the "lightbox flash then close" proves
janky in the test/dev pass, switch to the 260 ms *delayed* lightbox open
variant (design §6.2) — keep whichever RED test matches the chosen behaviour,
do not `skip`.

**GREEN** — new + full suite green; **PR A scroll regression tests green**
(first-open pin, media-growth re-pin, scroll-up unstick, re-stick, reopen,
upward-page anchor, near-bottom follow, "Nya meddelanden"); typecheck + lint.
Manual device check: swipe-right arms reply without triggering iOS back or
fighting vertical scroll; double-tap a photo hearts it and shows no viewer.

**Commit** — `feat(chat): swipe-to-reply + double-tap-to-like gestures`

---

## Task G — Reply composer mode + `<ReplyQuote>`

**Files**

- `src/features/chat/replyPreview.ts` *(new)* — pure: `replyQuoteText(preview:
  ReplyPreview, viewerUserId: string | null): { senderLabel: string; line:
  string }`:
  - `preview.deleted` → `{ senderLabel: '', line: HIDDEN_MESSAGE_PLACEHOLDER }`
  - sender label: own → `Du`; GM → `GAME MASTER`; else `senderDisplayName ??
    'Deltagare'`
  - line: `training` → `🏃 {activity ?? 'Träning'} · {formatMinutes(dur)}`;
    `kind==='image'` → `📷 Bild`; else `preview.text ?? ''` (+ ellipsis handled
    by CSS `line-clamp`).
- `src/features/chat/ReplyQuote.tsx` *(new)* + css — renders the quote block
  (design §8.2); a `<button>` calling `onJump(seq)`; accessible name per §7.3
  (hidden target → `Svar på ett borttaget meddelande`, **never** content).
- `src/features/chat/ChatPanel.tsx` — `MessageRow`: render `<ReplyQuote>` between
  `messageHead` and body when `message.replyPreview !== null`. Composer:
  - `replyTarget` state `{ messageId, senderLabel, line } | null`
  - a reply strip above `.composeRow` (design §8.4) with ✕ that clears
    `replyTarget` but **keeps `draft` + `files`**
  - `send()` passes `replyToMessageId: replyTarget?.messageId` to
    `post.mutate`; `onSuccess` clears `replyTarget` + draft + files;
    `onError` keeps all three; a hidden-target server error
    (`Meddelandet går inte längre att svara på`) → clear `replyTarget`, keep
    draft, show the message.
  - `MessageActions` `onReply` and the swipe `onArmReply` both call
    `setReplyTarget(...)` (deriving the label from the message).
- `src/features/chat/useChat.ts` — `PostVars` + `usePostChatMessage` thread
  `replyToMessageId` through to `sendChatMessage`.
- Tests: `replyPreview.test.ts`, `ReplyQuote.test.tsx`, `ChatPanel.test.tsx`.

**RED**

- `replyQuoteText`: text preview → shortened line + sender; image → `📷 Bild`;
  training → `🏃 Löpning · 45 min`; GM → `GAME MASTER` + text;
  `deleted` → `[Borttaget av administratör]` exactly; own message → `Du`.
- `<ReplyQuote>`: renders the line; click → `onJump(seq)`; hidden → accessible
  name is `Svar på ett borttaget meddelande` and the DOM contains **no** parent
  body text.
- `ChatPanel`: arming reply (button) shows the strip with `Svarar på {sender}`;
  ✕ hides the strip and the draft text is still in the input; sending a reply
  calls `post.mutate` with `replyToMessageId`; on mocked success the strip and
  draft clear; on mocked failure they remain; a mocked hidden-target error
  clears the strip, keeps the draft, shows the Swedish message; a message with
  `replyPreview` renders one `<ReplyQuote>` (and for `A←B←C` fixture, `C` shows
  a quote of `B` only).

Run → fail. Record.

**Implementation** — as above.

**GREEN** — new + full suite green; typecheck + lint; the composer reply strip
respects the keyboard safe-area (visual check via the existing `Sheet` footer).

**Commit** — `feat(chat): reply composer mode + quoted reply rendering`

---

## Task H — Jump-to-original (bounded)

**Files**

- `src/features/chat/chat.ts` — `REPLY_JUMP_MAX_PAGES = 10`;
  `findLoadedSeq(pages, seq): boolean`.
- `src/features/chat/ChatPanel.tsx` — `jumpToMessage(seq)`:
  1. if loaded → set `programmaticScrollTo`, `node.scrollIntoView({ block:
     'center' })`, add `.jumpHighlight` for ~1.2 s (removed via timeout).
  2. if not loaded → loop: `await fetchNextPage()`; re-check; stop at
     `REPLY_JUMP_MAX_PAGES` or when found. On found → step 1. On exhausted →
     a one-line toast `Kunde inte hitta meddelandet i historiken.`
  - must **not** clear `stickToBottom` (the `scroll` listener already ignores a
    programmatic scroll via `isProgrammaticScroll`).
- `src/features/chat/ChatPanel.module.css` — `.jumpHighlight` outline fade
  (reduced-motion: instant on, no fade).
- `ChatPanel.test.tsx` additions.

**RED**

- target already loaded → `scrollIntoView` called; `.jumpHighlight` applied then
  removed; `stickToBottom` unchanged (assert the "Nya meddelanden" behaviour is
  not triggered).
- target not loaded, present on page 3 → `fetchNextPage` called ≤ 3× then
  scroll.
- target never present → `fetchNextPage` called exactly `REPLY_JUMP_MAX_PAGES`
  times, then the toast; **no further** calls (assert bounded).

Run → fail. Record.

**Implementation** — as above.

**GREEN** — new + full suite green (esp. PR A scroll tests); typecheck + lint.

**Commit** — `feat(chat): bounded scroll-to-original from a reply quote`

---

## Task I — Moderation / privacy / regression sweep

No new product code — this task is the **explicit safety net** and any small
fixes it surfaces.

**Files** — `ChatPanel.test.tsx`, `chat-api.test.ts`, plus whatever needs a fix.

**RED / assertions** (add any missing; several may already pass — the point is
they exist and are named):

- A message whose `replyPreview.deleted === true` renders **exactly**
  `[Borttaget av administratör]` in the quote and the rendered DOM contains no
  other parent-derived string (body, note, activity, GM text).
- A hidden message: no `<LikeBadge>`, no `<MessageActions>`, `mapChatRow`
  yields `likeCount 0` / `likedByMe false`; `displayBody` still returns the
  placeholder.
- A like Realtime invalidation (simulated) that returns the **same seqs**
  does not move the viewport / does not set `showNewMessages`
  (design §19.2).
- `useToggleChatMessageLike` never calls `mark_chat_read` and never bumps the
  unread query directly (only Realtime does, and that returns an unchanged
  count).
- `chat-api` pre-migration-shape suite green (Task C) — re-assert here as a
  guard.
- `submit-training.gm` and `requestGameMasterPulse` suites unchanged/green
  (no GM coupling).

**GREEN** — `npm run test` (full), `npm run typecheck`, `npm run lint`,
`npm run build` all clean. Record the suite counts (files, tests) before/after
in the PR body.

**Commit** — `test(chat): moderation, privacy, and PR A scroll regression sweep`

---

## Task J — Rollout (DB-first, design §22.3)

**Not started until A–I are merged to `main` via a normal PR.** No approval
pauses unless an unexpected blocker appears.

1. **Fresh baseline check** — `git fetch`; confirm `origin/main` moved to the
   merge commit and `origin/production` is still the pre-feature SHA.
2. **Post-merge gates on `main`** — `npm ci`, `typecheck`, `lint`, `test`,
   `build` all green.
3. **`supabase db push --linked --dry-run`** (PAT from `~/.supabase/access-token`,
   never printed) — output **must** propose **exactly**
   `<MIG>_chat_replies_likes` and nothing else. If it proposes anything else →
   **STOP**, report.
4. **Apply** — `supabase db push --linked`. (This is the same approved
   mechanism used for `20260907120000`.)
5. **Live read-only verification** (via `scratchpad/sbq.mjs`, read-only):
   - migration count is now **28**; `<MIG>` is listed.
   - `chat_messages.reply_to_message_id` exists, nullable; both FKs present with
     the right `ON DELETE` actions; `chat_messages_reply_to_idx` present.
   - `chat_message_likes` exists; PK `(message_id, user_id)`; RLS on;
     `chat_message_likes_select` policy is `is_admin()`.
   - `set_chat_message_like(uuid, boolean)` exists, EXECUTE = `authenticated` only.
   - `post_chat_message` has **one** overload, arity 5; `_create_chat_message`
     exists and is **not** granted to `authenticated`.
   - `list_chat_messages` return type includes `like_count`, `liked_by_me`,
     `reply_preview`.
   - `pg_publication_tables` for `supabase_realtime` still lists **only**
     `chat_activity` among the chat/training tables — **not**
     `chat_message_likes`, `chat_messages`, `training_entries`,
     `training_proofs`.
6. **ZERO HISTORICAL DATA proof** (mandatory):
   - `select count(*) from chat_message_likes` → **0**.
   - `select count(*) from chat_messages where reply_to_message_id is not null`
     → **0**.
   - No backfill, no synthetic rows.
7. **Old frontend on new DB** — the current production `production` deploy is
   still live and now talks to the migrated DB. Smoke it (or reason from
   §22.1): posting a normal message, images, training cards, scroll, unread all
   work — `post_chat_message` 5-arg resolves the old 2/4-key calls; the old
   `mapChatRow` ignores the new columns. Record.
8. **`npm run db:types`** — **back up `src/types/database.ts` first**
   (`cp src/types/database.ts /tmp/.../database.ts.before`). Run with the
   working invocation:
   `SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx --no-install
   supabase gen types typescript --linked --schema public --schema
   graphql_public > src/types/database.ts`. `git diff --stat` must show an
   **additive** diff only (new table types, `reply_to_message_id`,
   `set_chat_message_like`, `list_chat_messages` return fields,
   `post_chat_message` 5th arg). If it shows mass deletions → restore the
   backup and retry (known CLI-2.116 footgun).
9. **Final gates on `main`** — `typecheck`, `lint`, `test`, `build` green with
   the regenerated types.
10. **Commit the generated types** — explicit path:
    `git add src/types/database.ts && git commit` →
    `chore: regenerate types after chat replies + likes migration`. Push
    `main` only.
11. **Promote** — fast-forward `production` to that `main` commit and push →
    Cloudflare Workers Builds deploys the new frontend against the
    already-migrated DB. Likes + replies go live here.
12. **Post-deploy checkpoint** — new frontend: runtime Supabase config present
    (do not print the anon key — verify non-empty), PR markers in the bundle;
    a real like + a real reply from a test account work end to end and appear
    over Realtime on a second session; `unread` badge does **not** move on a
    like; a hidden message drops its badge for a non-admin.

**Do NOT**: touch David, run `purge-david.sql` / `storage-rm.mjs`, synthesize
likes/replies, change Cloudflare preview config, implement avatars / @mentions /
notifications / Web Push / jury / GM changes. Leave
`claude_code_inspection_prompt_chat_weight_gamemaster.txt` untouched and
locally excluded; use explicit `git add <paths>`, never `git add -A`.

**Commit** — `chore: regenerate types after chat replies + likes migration`

---

## File inventory (new + touched)

**New**

```
supabase/migrations/<MIG>_chat_replies_likes.sql
supabase/tests/0030_chat_replies_likes.test.sql
src/features/chat/LikeBadge.tsx            + .module.css + .test.tsx
src/features/chat/MessageActions.tsx       + .module.css + .test.tsx
src/features/chat/ReplyQuote.tsx           + .module.css + .test.tsx
src/features/chat/useMessageGestures.ts    + .test.tsx
src/features/chat/replyPreview.ts          + .test.ts
```

**Touched**

```
src/components/icons.tsx                   (HeartIcon, HeartFilledIcon, ReplyIcon)
src/features/chat/types.ts                 (ReplyPreview, ChatMessage fields)
src/features/chat/chat.ts                  (gesture constants + pure helpers, REPLY_JUMP_MAX_PAGES)
src/features/chat/chat-api.ts              (mapChatRow, narrowReplyPreview, sendChatMessage, setChatMessageLike)
src/features/chat/useChat.ts               (useToggleChatMessageLike, PostVars.replyToMessageId)
src/features/chat/ChatPanel.tsx            (MessageRow: quote + badge + actions + gestures; composer reply mode; jumpToMessage)
src/features/chat/ChatPanel.module.css     (touch-action, overscroll, swipe, pop, jumpHighlight)
src/features/chat/ChatImageGrid.tsx        (shared lightbox-close for double-tap)
src/features/chat/chat-api.test.ts / ChatPanel.test.tsx / useChat.test.tsx  (extended)
src/types/database.ts                      (regenerated in Task J)
```

`hide_chat_message`, `mark_chat_read`, `unread_chat_count`, `chat_activity`,
`tg_chat_activity_fanout`, `tg_training_entry_chat_card`, `TrainingCard.tsx`
internals, the GM engine — **not modified**.

---

## Definition of done

- All of `0030` + the existing pgTAP suites green in CI `Database Tests`.
- `npm run test` / `typecheck` / `lint` / `build` green.
- Migration applied to production; **28 migrations**; zero historical likes /
  replies; Realtime publication unchanged.
- New frontend live on `production`; a like and a reply work end to end and
  propagate over Realtime; unread unaffected by likes; hidden messages leak no
  like or preview metadata.
- No change to training validity / debt / streak / ranking / KASSAN /
  Straffbanken / weight / GM.
- Design doc and this plan committed on `design/chat-replies-likes` (docs) and
  the feature on `feat/chat-replies-likes` (code).
