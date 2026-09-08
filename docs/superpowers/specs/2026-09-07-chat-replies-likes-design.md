# Hälsoutmaningen — Shared Chat: ❤️ Likes & ↩️ Instagram-style Replies

Date: 2026-09-07

Status: **APPROVED DESIGN — implementation not started**

Supersedes the "replies + likes" portion of
`docs/superpowers/specs/2026-09-06-social-chat-notifications-design.md` §8–§9
(that document's PR C also bundled `@mentions` + a notification layer; this
slice is **likes + replies only**). `@mentions`, notifications, Web Push,
profile avatars and jury / "Bedöm pass" are explicitly **out of scope** and are
each kept architecturally reachable (§27–§29).

---

## 1. Scope

Add two social interactions to the existing single-room Shared Chat, keeping
the conversation flat and chronological:

1. **❤️ Likes** — exactly one reaction (a heart). Any participant may like any
   visible chat item once. A compact reaction badge is attached to the message.
   Double-tap to like (mobile), plus an explicit accessible control.
2. **↩️ Replies** — a reply is an ordinary chat message that *quotes* an
   earlier one. Swipe-right to arm a reply (mobile), plus an explicit "Svara"
   action. The sent reply shows a compact, subordinate quote of the target.
   Tapping the quote jumps to the original.

Both interactions apply to **all five** message kinds that exist in the stream
today:

| Kind | Likeable | Replyable |
| ---- | -------- | --------- |
| participant text message | ✅ | ✅ |
| participant image message (1–4 images) | ✅ | ✅ |
| participant text + image message | ✅ | ✅ |
| automatic **training card** (`sender_type = 'training_card'`) | ✅ | ✅ |
| **Game Master** message (`sender_type = 'game_master'`) | ✅ | ✅ |

Liking / replying to **your own** message or training card is allowed (§4.6,
§5.2). A hidden (moderated) message is neither likeable nor replyable by an
ordinary participant, and never exposes its like or preview metadata (§12–§13).

### Verified current state (2026-09-07)

- `origin/main` = `origin/production` = `b72af65793c1c11af71e27b40ef32959fdcbb0e3`.
- Production DB: **27 migrations**, latest `20260907120000_training_chat_cards`.
- PostgreSQL **17.6** (column-list `ON DELETE SET NULL (col)` is available).
- Chat schema / RPCs inspected live — see §3.

---

## 2. Non-goals

- Any reaction other than a heart — no emoji picker, no 👍 / 😂, no reaction
  palette, no stickers.
- A "Liked by …" list / bottom sheet (§4.7 — YAGNI; architecture leaves room).
- Threads, thread pages, nested/indented reply trees, Slack side-threads,
  Reddit trees. Replies are **flat** (§5.4).
- Copying the parent's body/notes/training payload into the reply row (§12 —
  this would leak after moderation). Everything resolves live.
- `@mentions`, `chat_message_mentions`, autocomplete.
- Notifications (in-app or push), `notification_*` tables, service workers,
  VAPID.
- Profile avatars, `profile-media`, stable handles.
- Jury / "Bedöm pass" — completely separate from hearts (§29).
- Game Master behaviour change of any kind. No `@gm`, no AI, no reaction
  consumption by the GM engine in this slice.
- Message editing, physical participant delete, DMs, multiple rooms.
- Changing the moderation placeholder string. It stays **exactly**
  `[Borttaget av administratör]`
  (`HIDDEN_MESSAGE_PLACEHOLDER` in `src/features/chat/chat.ts`).
- Any effect on training validity / completed / missed / debt / streak /
  ranking / KASSAN / Straffbanken / weight / challenge finalization / Game
  Master (§ "core isolation" throughout; hard boundary).
- Historical backfill — every existing message simply starts at `like_count = 0`,
  `reply_to = null` (§22).

---

## 3. Current architecture (verified live)

### 3.1 `chat_messages`

```
id                uuid pk default gen_random_uuid()
seq               bigint generated always as identity   -- canonical order/cursor
challenge_id      uuid not null -> challenges(id) on delete cascade
sender_type       text not null  check in ('participant','game_master','training_card')
sender_user_id    uuid           -> profiles(id)         -- null only for game_master
body              text           -- nullable (image-only / card); check null or 1..1000 chars
status            text not null default 'active' check in ('active','hidden')
hidden_at/by/reason  -- the moderation trail (coherence-checked)
created_at        timestamptz not null default now()     -- DISPLAY ONLY
training_entry_id uuid           -> training_entries(id) on delete cascade, UNIQUE
```

Constraints of note:

- `chat_messages_sender_coherent` — 3-branch: `participant` ⇒
  `sender_user_id not null and training_entry_id is null`; `game_master` ⇒ both
  null; `training_card` ⇒ `sender_user_id not null and training_entry_id not
  null and body is null`.
- `chat_messages_id_challenge_uniq UNIQUE (id, challenge_id)` — the target of
  `chat_message_attachments`' composite FK. **Reused for the reply and like
  composite FKs (§9).**
- Indexes: `(challenge_id, seq desc)`, `(id, challenge_id)` unique,
  `(sender_user_id, created_at desc) where sender_type='participant'`,
  `(training_entry_id)` unique.

### 3.2 RLS / read surface

- `chat_messages` base **SELECT is admin-only** (`using (public.is_admin())`).
  Ordinary members have **no direct read** of the table.
- `chat_message_attachments` base SELECT is also admin-only.
- Members read through **`list_chat_messages(p_challenge_id, p_before_seq,
  p_limit)`** (`SECURITY DEFINER`, `search_path=''`, EXECUTE → `authenticated`
  only). Current return shape:

  ```
  id, seq, challenge_id, sender_type, sender_user_id, sender_display_name,
  body, status, attachments jsonb, training_card jsonb, created_at
  ```

  A hidden row is returned as a real row with `body = null`, `attachments =
  '[]'`, `training_card = null` for a non-admin (the same gate); the moderation
  trail is never projected. Newest-`seq`-first; `p_before_seq` is the strict
  upper bound for upward pagination; `limit` clamped to 1..100.
- `unread_chat_count(p_challenge_id)` — `count(*)` of `chat_messages` with
  `seq > last_read_seq` (from `chat_read_state`). A hidden message still counts.

### 3.3 Write path

- **`post_chat_message(p_challenge_id uuid, p_body text default null,
  p_message_id uuid default null, p_attachments jsonb default null) returns
  chat_messages`** — `SECURITY DEFINER`, the **only** writer of a participant
  message. Enforces: `auth.uid()` present; **active** membership
  (`challenge_memberships … and m.active`); `sender_user_id := auth.uid()`,
  `sender_type := 'participant'` (never parameters — not spoofable); body
  `null` or 1..1000 chars; ≤ 4 attachments; text-OR-≥1-image; each attachment
  path `starts_with('{challenge}/{uid}/{message_id}/')` **and** names a real
  `chat-media` object; **rate limit 10 participant messages / rolling 30 s**
  (`count(*)` of the caller's own `sender_type='participant'` rows with
  `created_at > now() - interval '30 seconds'`). Message + attachment rows in
  one transaction. The client generates `p_message_id` so it can upload the
  images to that folder first; on RPC failure it removes the objects.
- **`mark_chat_read(p_challenge_id, p_seq)`** — advance the caller's read
  cursor, forward-only; `p_seq` must be a real message in that challenge.
- **`hide_chat_message(p_message_id, p_reason)`** — admin only; sets
  `status='hidden'` + trail; **refuses a `game_master` row**; writes exactly
  one `audit_log` row (`entity_type='chat_message'`); the original `body` is
  retained.
- `training_entries_chat_card` — `AFTER INSERT ON training_entries` →
  `tg_training_entry_chat_card()` inserts one `sender_type='training_card'`
  row. INSERT-only, idempotent (`on conflict (training_entry_id) do nothing`).

### 3.4 Realtime

`supabase_realtime` publishes **only `public.chat_activity`** among the
chat/training tables. `chat_activity(challenge_id, seq, at)` — PK
`(challenge_id, seq)`, **one row per message**, upserted by
`chat_messages_activity_fanout` (`AFTER INSERT OR UPDATE OF status ON
chat_messages`) via `tg_chat_activity_fanout()`:

```sql
insert into public.chat_activity (challenge_id, seq, at)
values (new.challenge_id, new.seq, now())
on conflict (challenge_id, seq) do update set at = excluded.at;
```

`chat_messages`, `chat_message_attachments`, `training_entries`,
`training_proofs`, `storage.objects` are **not** published. The client
(`useChatMessages`) opens **one** channel per open challenge on `chat_activity`
filtered by `challenge_id=eq.<id>` and, on any change, invalidates the
`['chat','messages',challengeId]` and `['chat','unread',challengeId]` query
keys — never trusts the payload.

### 3.5 Frontend

- `ChatPanel.tsx` (574 lines) — the panel. Scroll container = the `Sheet` body
  (`scrollRef`); `listRef` on the message list; a **`stickToBottom` latch** +
  **`ResizeObserver`** re-pin + `programmaticScrollTo` guard + `scroll`
  listener that auto-loads older history near the top and tracks user intent
  (PR A). `useLayoutEffect` orchestration branches: (a) upward-page anchor,
  (b) first-open pin, (c) new message follow / "Nya meddelanden".
- `MessageRow` (inside `ChatPanel.tsx`) — renders one message as a
  full-width **card** (`.message`; `.self` only changes border/background — no
  left/right alignment), or delegates to `<TrainingCard>` for an active
  training card. Renders `messageHead` (sender label + `<time>`), `body`,
  `<ChatImageGrid>`, and a `{moderation}` slot (admin-only "Dölj" via
  `ChatModerationSheet`, passed as `renderModeration` from `ChatBubble`).
- `TrainingCard.tsx` — the activity card; own header, `Löpning · 45 min`, date,
  `<SignedProofImage>` proof(s), optional note, "Passet har underkänts" badge
  when `entryStatus === 'invalidated'`.
- `ChatImageGrid.tsx` — 1–4 thumbnails; each `Thumb` is a `<button
  onClick={onOpen}>` around an `<img loading="lazy">`; opens `ChatLightbox`.
- `useChat.ts` — `useChatMessages` (infinite query, `staleTime 15_000`,
  Realtime channel), `useUnreadChatCount`, `usePostChatMessage`
  (`PostVars { challengeId, userId, body, files?, onPhase? }`),
  `useChatImageUrls`, `useTrainingCardProofUrls`, `useMarkChatRead`.
- `chat-api.ts` — `chatdb = supabase as unknown as SupabaseClient` (the
  deliberately-untyped RPC boundary), `mapChatRow(raw)` hand-narrows every
  field from `unknown`, `sendChatMessage`, `fetchRecentChatMessages` /
  `fetchOlderChatMessages` / `fetchUnreadCount`, `markChatRead`.
- `chat.ts` — `HIDDEN_MESSAGE_PLACEHOLDER`, `CHAT_BODY_MAX_LENGTH = 1000`,
  `displayBody`, scroll helpers (`isNearBottom`, `scrollAnchorAdjustment`,
  `isProgrammaticScroll`, `NEAR_BOTTOM_PX = 96`).
- `types.ts` — `ChatSenderType`, `ChatMessage`, `ChatAttachment`,
  `TrainingCardData`.

---

## 4. Product behaviour — ❤️ Likes

### 4.1 One reaction only

The heart is the only reaction. There is no picker and no palette. This is a
permanent product decision (§2).

### 4.2 One user = one like, DB-enforced

Each participant has **at most one** active heart per `chat_messages` row.
Enforced by a `UNIQUE (message_id, user_id)` constraint on `chat_message_likes`
(§9.2) — never by client state.

### 4.3 Toggle is server-authoritative and race-safe

One RPC — **`toggle_chat_message_like(p_message_id uuid) returns jsonb`** — the
server flips based on the **current DB state**, not a client claim (§10.2). It
returns `{ "liked": boolean, "like_count": integer }`. The client's optimistic
UI reconciles to this response. The like control is disabled while its own RPC
is in flight, so the displayed state always matches the last server answer
(§18). There is **no** client-side "SELECT-exists then INSERT/DELETE".

### 4.4 Like indicator (badge)

A small **reaction micro-badge** is attached to the bottom-right corner of the
message card / training card, slightly overlapping the bottom edge so it reads
as *attached to* the message, **not** as another chat bubble.

| `like_count` | Rendered |
| ------------ | -------- |
| `0` | **nothing** — no badge, no reserved space |
| `1` | a small heart glyph only: `❤︎` |
| `≥ 2` | heart + compact number: `❤︎ 4`, `❤︎ 7` |

Never the words "7 likes" / "7 personer". Compact only. Same visual language on
a training card.

### 4.5 Current-viewer state

When `liked_by_me` is true, the badge's heart is **filled** and tinted with the
project accent (`var(--c-accent)`); when others liked but the viewer has not,
the heart is an **outline** in `var(--c-text-muted)` with the count. It is the
**same shared count** — there is no second reaction. No strong Instagram red;
the project's semantic/accent tokens only.

Tapping the badge itself also toggles the viewer's like (a redundant, discoverable
control — see §4.6).

### 4.6 Ways to like (redundant, layered)

| Path | Platform | Notes |
| ---- | -------- | ----- |
| **Double-tap** the message card | touch + mouse (double-click) | Instagram shortcut. A subtle heart "pop" (scale 1 → 1.15 → 1, ~160 ms, `prefers-reduced-motion` respected — §6.4). Not the only control. |
| Tap the **reaction badge** | all | Toggles the viewer's like. Only present when `like_count ≥ 1`. |
| **"Gilla" / "Ta bort gilla-markering"** in the message action row | all | The explicit, always-available, keyboard-reachable control. Present on every non-hidden likeable message (§7). This is the accessibility anchor. |

Double-tap and swipe are **shortcuts**; the action-row button is the canonical
control and must always be reachable by keyboard and screen reader (§7).

### 4.7 No "Liked by" list

Out of scope. The badge shows count only. The data model (rows in
`chat_message_likes` with `user_id`) does not preclude adding an admin- or
member-gated "who liked" RPC later, but it is not built and not tested now.

### 4.8 Likes never allocate a `seq` and never touch unread

A like is metadata. It does **not** insert a `chat_messages` row, does **not**
allocate `seq`, and does **not** change `unread_chat_count` (§17). Adding or
removing a like therefore cannot reorder the chat or make something show as
unread.

### 4.9 Likes on training cards

A training card **is** a `chat_messages` row (`sender_type='training_card'`), so
it uses the **same** `chat_message_likes` model — **no training-specific likes
table**. The badge renders on the card exactly as on a message.

### 4.10 Likes and invalidated training cards

If the linked `training_entries` row is later `status='invalidated'`, the card
stays visible as "Passet har underkänts". Existing likes are **not destroyed**;
the card still shows its heart count. **New likes remain allowed** after
invalidation — a heart is social reaction/support/mockery, not a validation
vote, and is completely separate from the future jury mechanic (§29).

### 4.11 Likes on Game Master messages

Participants may heart a GM message. The GM is not a participant and never
toggles a reaction. **No GM behaviour changes** based on likes in this slice.
A future GM iteration may read reaction rows; nothing here prevents that
(§15, §27).

### 4.12 Likes and admin-hidden content

The instant a message is hidden, `list_chat_messages` returns `like_count = 0`
and `liked_by_me = false` to every ordinary participant (§11, §13) — the count,
the `liked_by_me` flag and any liker identity are withheld alongside the
withheld body. The `chat_message_likes` **rows are retained** in the database
(not physically deleted on moderation); an admin read surface may still see
them if one is ever built. New likes on a hidden message are rejected
server-side (§10.2).

---

## 5. Product behaviour — ↩️ Replies

### 5.1 A reply is a normal message that quotes another

Replies stay **in the same single Shared Chat**, chronological. A reply is an
ordinary participant `chat_messages` row with all existing behaviour (body
validation, image attachments via the existing `chat-media` + PR A compression
path, rate limit, `seq`, timestamps, moderation, unread, `chat_activity`
signal). It additionally carries a nullable **`reply_to_message_id`**
(§9.1). There is **no** separate replies table and **no** copied reply body.

### 5.2 Reply targets

Reply to any of the five kinds in §1, **including your own** message or card.
The server rejects a reply whose target is in another challenge, hidden,
non-existent, or otherwise inaccessible (§10.3, §20).

### 5.3 Sent reply appearance

The reply is a normal card. **Inside the card, above the body**, a compact
**quote block** shows the target's current safe preview:

```
┌─────────────────────────────┐
│ Filip                   14:02│   ← reply's own sender + time
│ ┌─────────────────────────┐ │
│ │ Anna                    │ │   ← quote: target sender (viewer-relative, §5.7)
│ │ Golf räknas inte som…   │ │   ← quote: compact preview (§5.5)
│ └─────────────────────────┘ │
│ Det gör det visst.          │   ← reply body
└─────────────────────────────┘
                          ❤︎ 2
```

The quote is visually **subordinate** — a thin left border / muted background,
smaller type, one to two lines, truncated. It must **not** look like a second
full chat message.

### 5.4 Replies are flat — no recursion

Given `A` ← `B` (B replies to A) ← `C` (C replies to B): store
`B.reply_to_message_id = A.id`, `C.reply_to_message_id = B.id`. Render `C` with
**one** quote of `B`. **Never** expand `A` inside `B` inside `C`. No
indentation, no quote chains. The read model resolves **exactly one** level
(§11.3).

### 5.5 Quote preview per target kind (server-produced, §12)

| Target | `reply_preview` payload (non-admin) | Rendered |
| ------ | ----------------------------------- | -------- |
| text message | `{kind:'text', sender_*, text:left(body,140)}` | sender label + shortened text |
| image-only message | `{kind:'image', sender_*, text:null, has_image:true}` | sender label + `📷 Bild` |
| text + image message | `{kind:'text', sender_*, text:left(body,140), has_image:true}` | sender label + shortened text (small 📷 affordance optional) |
| training card | `{kind:'training_card', sender_*, training:{activity,duration_minutes}}` | `🏃 Löpning · 45 min` (activity + `formatMinutes`); no proof image |
| Game Master | `{kind:'game_master', sender_display_name:'GAME MASTER', text:left(body,140)}` | `GAME MASTER` + shortened text |
| **hidden** (target hidden after the reply was sent) | `{deleted:true}` | **`[Borttaget av administratör]`** — the client renders the canonical constant; the server sends **only** a boolean, never a snapshot (§12) |
| `reply_to_message_id` is `null` (FK `SET NULL` after physical parent delete, §9.1) | `null` | no quote — the reply degrades to a plain message |

The quote **never** contains: a full 1000-char body, a training proof path, an
image signed URL, GM internals, or any like metadata. Text/icon only. **No new
signed URL is minted** to render a preview.

### 5.6 Tap / click the quote → jump to the original

Tapping the quote attempts to bring the original into view: locate it, scroll
it into view, briefly highlight it (~1.2 s outline fade). Behaviour by whether
the target `seq` is already loaded (§19.3):

- **loaded** → scroll + highlight, no fetch.
- **not loaded** → the client pages upward (`fetchNextPage`, the existing
  bounded mechanism) **at most a small, capped number of pages** (default: up to
  **10** pages of 50 = 500 messages) until the target `seq` is present, then
  scroll + highlight. If still not reached, show a one-line toast
  *"Kunde inte hitta meddelandet i historiken."* and stop. **No unbounded
  loop.** The scroll-anchor / `stickToBottom` logic from PR A is preserved
  (§19).

### 5.7 Viewer-relative sender label in the quote

The quote sender label is computed **client-side, viewer-relative**, from the
`sender_type` + `sender_user_id` in the preview payload:

- target is the **current viewer's own** message → `Du`
- another participant → their `sender_display_name`
- Game Master → `GAME MASTER`
- training card → the trainer's current safe display label (same rule chat
  already uses for a card's header)

The string `Du` is **never** persisted. The DB stores `sender_user_id`; the
client renders the label.

### 5.8 Composer reply mode

Selecting a reply target puts the composer into **reply mode** — a compact
strip directly **above** the existing composer input (not a modal):

```
┌──────────────────────────────────────┐
│ Svarar på Anna                    ✕   │
│ Golf räknas inte som träning…        │   ← 1-line preview
├──────────────────────────────────────┤
│ Skriv ett meddelande…         [Skicka]│   ← unchanged composer
└──────────────────────────────────────┘
```

Requirements:

- shows the target sender (viewer-relative) and a one-line preview
- clear **✕** cancel (returns to normal compose; the current text draft is
  **kept**)
- image attachment flow unchanged and usable in reply mode
- the current text draft is preserved when toggling reply mode on/off and when
  re-targeting to a different message
- **on successful send** → reply mode clears, draft + attachments clear (as
  today)
- **on failed send** → reply mode **stays**, draft + attachments **stay** — the
  user retries without losing anything (§26)
- if the target became hidden between arming and sending, the server rejects
  the create (§10.3); the client surfaces
  *"Meddelandet går inte längre att svara på."*, keeps the draft, and drops
  reply mode

### 5.9 Ways to reply (redundant, layered)

| Path | Platform | Notes |
| ---- | -------- | ----- |
| **Swipe right** on the message card past a threshold | touch (and trackpad drag) | Instagram gesture. Immediate visual feedback during drag; ↩️ icon reveals; release past threshold arms reply (§6.1–§6.3). |
| **"Svara"** in the message action row | all | The explicit, always-available, keyboard-reachable control (§7). |

### 5.10 A reply is itself a first-class message

The reply card can be **liked** and **replied to** like any message — no
special case. Example: Anna: "Golf räknas inte." → Tomas replies "Det gör
det." → Alexander likes Tomas's reply → Tomas's card shows the quote of Anna
*and* a `❤︎ 1` badge.

---

## 6. Mobile gestures

### 6.1 The scroll-vs-swipe rule

The vertical scroll container is the `Sheet` body; vertical scrolling stays
**native**. Each message card gets `touch-action: pan-y` so the browser owns
the vertical axis and delivers horizontal pointer moves to JS. The app handles
horizontal via **Pointer Events** on the card:

- `pointerdown` → record `startX`, `startY`, `startT`, `pointerId`; `phase = 'idle'`.
- `pointermove`:
  - `phase === 'idle'`: if `|dy| > 10` → `phase = 'vscroll'` (bail — never
    interfere with the chat scroll). Else if `dx > 12 && dx > |dy| * 1.5` →
    `phase = 'swipe'`, `element.setPointerCapture(pointerId)`.
  - `phase === 'swipe'`: `e.preventDefault()`; translate the card by
    `min(dx, 96)px`; fade the ↩️ icon in from ~24 px; a small resistance curve
    past ~64 px; a subtle "armed" state (icon solid / faint haptic-style scale)
    at the threshold.
- `pointerup`:
  - `phase === 'swipe'` and `dx ≥ 64` → **arm reply** for this message
    (composer enters reply mode); animate the card snapping back to 0.
  - otherwise animate snap-back, no action.
- `pointercancel` → snap back, reset.

### 6.2 Double-tap to like (coexisting with the swipe + the lightbox)

A separate tap-count detector on the same card:

- `pointerup` with `phase !== 'swipe'` **and** total movement `< 10 px`:
  `tapCount += 1`; start / restart a **260 ms** timer.
  - timer elapses with `tapCount === 1` → single tap; the card does nothing
    (a child, e.g. an image `<button>`, may have already handled it — opening
    the lightbox on a single tap is intended).
  - `tapCount === 2` within 260 ms → **double-tap** → `e.preventDefault()` +
    `e.stopPropagation()` on this pointer/click so the child's synthetic click
    is suppressed → **toggle like** + heart "pop" → if the image lightbox was
    opened by the first tap, **close it** (a shared `closeLightbox` ref, so a
    double-tap on a photo hearts it and does not leave the viewer open).
- The lightbox flash on the double-tap-a-photo path is < 260 ms and only on
  that path. The implementer may instead choose a 260 ms *delayed* lightbox
  open (no flash, slight latency) — decided during implementation with a RED
  test either way (§25, Task F).

### 6.3 No conflict with

- **vertical chat scroll** — `touch-action: pan-y` + the `|dy| > 10` bail.
- **image lightbox tap** — single tap still opens it; double-tap suppresses the
  child click (§6.2).
- **training-card interaction** — the card renders inside the same `.message`
  wrapper; the swipe/tap handlers live on the wrapper. Training-card proof
  images are plain `<img>` (no lightbox today), so no conflict.
- **long-press** — the action sheet / context affordance (§7) is a distinct,
  slower gesture; the pointer detectors above ignore a stationary hold.
- **browser back-swipe** (iOS Safari edge swipe) — the gesture must **start on
  a message card**, not the panel edge; `overscroll-behavior: contain` on the
  scroll container; the Sheet is already a modal overlay with
  `document.body.style.overflow='hidden'`.

### 6.4 Motion

Subtle and fast, ~120–200 ms, easing consistent with existing components. Heart
pop: `scale(1) → scale(1.15) → scale(1)` ~160 ms. Swipe translate follows the
finger 1:1 up to the cap; snap-back ~180 ms. **Respect
`prefers-reduced-motion`** — under it, no pop and no translate animation; the
like state and reply-arm still apply instantly.

---

## 7. Desktop / accessibility interactions

Gestures are shortcuts. Every action has a real semantic control.

### 7.1 Message action row

A compact action row on each **non-hidden, likeable/replyable** message card,
rendered by `MessageRow` (for **all** participants — not the admin-only
`renderModeration` slot). On mobile it is a small always-visible ghost row at
the bottom of the card; on desktop it may reveal on hover/focus but must be
**focus-reachable** regardless:

| Control | `aria-label` | Behaviour |
| ------- | ------------ | --------- |
| ❤️ toggle `<button>` | `Gilla meddelandet` / `Ta bort gilla-markering` (state-dependent); on a training card: `Gilla passet` / `Ta bort gilla-markering` | toggles the viewer's like |
| ↩️ `<button>` | `Svara på {sender}s meddelande` (viewer-relative sender; on a card: `Svara på {trainer}s pass`) | arms reply mode |
| (admin only) Dölj | unchanged | unchanged `ChatModerationSheet` |

### 7.2 Desktop pointers

- **click** the heart button / badge → toggle like.
- **click** ↩️ → reply mode.
- **double-click** the card **may** map to like if it does not conflict with
  text selection — implementer's call, RED-tested; the button is the guaranteed
  path.
- **click** the reply quote → jump-to-original (§5.6).
- no swipe on desktop (it is a touch shortcut); the ↩️ button covers it.

### 7.3 Screen reader / keyboard

- Heart / reply / quote controls are real `<button>`s with visible
  `:focus-visible` and keyboard activation (Enter / Space).
- The reaction badge, when present, is announced as e.g.
  **`aria-label="3 personer gillar meddelandet"`** (or
  `"1 person gillar meddelandet"`; `"Du och 2 andra gillar meddelandet"` when
  `liked_by_me`). It is a `<button>` (toggles the viewer's like) with that
  label.
- The reply quote block has an accessible name announcing the reply
  relationship, e.g. **`Svar på Annas meddelande: "Golf räknas inte…"`**; when
  the target is hidden the accessible name is **`Svar på ett borttaget
  meddelande`** — the quote's accessible name **must not** expose hidden
  original content (§12).
- Reduced motion respected (§6.4).
- The swipe / double-tap gestures are **not** the only way to reach any
  function.

---

## 8. Visual treatment

Existing design tokens only. No gradients, no neon, no giant emoji, no loud
animation, no rounded-everything. Instagram *mechanics*, Scandinavian-premium
*look*.

### 8.1 Reaction micro-badge

- A tiny rounded pill: `border-radius: var(--radius-full)`, ~`22 px` tall,
  `padding: 1px 6px`, `background: var(--c-surface-raised)`, `border: 1px solid
  var(--c-border)`, subtle `box-shadow` so it lifts off the card.
- `position: relative; align-self: flex-end; margin-top: -10px; margin-right:
  var(--sp-2)` — overlaps the card's bottom-right edge; **not** its own row,
  **no** large vertical gap when absent (0 likes → element not rendered).
- Heart glyph ~`13 px`. Number in `var(--fs-2xs)` `tnum`.
- `liked_by_me` → filled heart, `var(--c-accent)`. else → outline heart,
  `var(--c-text-muted)`.
- Training card: identical badge, same corner.

### 8.2 Reply quote block

- Inside the card, between `messageHead` and `body`.
- `border-left: 2px solid var(--c-border)`, `padding-left: var(--sp-2)`,
  `background: var(--c-surface-sunken)` (a hair darker than the card), small
  `border-radius`.
- Sender label: `var(--fs-2xs)` `var(--fw-semibold)` `var(--c-text-muted)`.
- Preview text / semantic line: `var(--fs-xs)` `var(--c-text-muted)`, **one to
  two lines**, `-webkit-line-clamp: 2`, ellipsis.
- A hidden-target quote shows the placeholder in italic muted text, same box.
- Whole box is a `<button>` (jump-to-original).

### 8.3 Message action row

`var(--fs-2xs)` ghost icon buttons, `var(--c-text-faint)` → `var(--c-text-
muted)` on hover/focus, `gap: var(--sp-2)`, right-aligned, ~`28 px` tap
targets on touch (visually smaller, hit-area padded).

### 8.4 Composer reply strip

`background: var(--c-surface-sunken)`, thin top border, `padding: var(--sp-1)
var(--sp-2)`, sender label + 1-line clamp + a `var(--c-text-faint)` ✕ button,
sits flush above `.composeRow`. No modal. Keyboard-open safe-area preserved
(the `Sheet` footer already handles this).

### 8.5 Visual hierarchy inside a card (top → bottom)

1. `messageHead` — sender / metadata / time
2. **reply quote** (if any)
3. body text
4. images (`ChatImageGrid`) / training-card content
5. message action row
6. reaction micro-badge (overlapping the bottom-right edge)

`TrainingCard` internals are **not** redesigned — the card only gains (a) the
swipe/double-tap affordance on its wrapper, (b) the action row, (c) the badge.

### 8.6 New icons required

`src/components/icons.tsx` currently has no heart or reply glyph. Add:
`HeartIcon` (outline), `HeartFilledIcon` (or one `HeartIcon` with a `filled`
prop), `ReplyIcon` (a small curved-arrow / corner-turn) to that file. Keep them
stroke-based, `currentColor`, matching the existing icon set weight and the
`{ size?: number }`-style prop the other icons use.

---

## 9. Data model

### 9.1 Replies — a nullable self-reference on `chat_messages`

```sql
alter table public.chat_messages
  add column reply_to_message_id uuid;

-- Composite FK to the (id, challenge_id) unique key => the parent is
-- FK-GUARANTEED to be in the SAME challenge; a physically deleted parent
-- nulls ONLY the reply link (the child survives as a plain message).
alter table public.chat_messages
  add constraint chat_messages_reply_to_fk
  foreign key (reply_to_message_id, challenge_id)
  references public.chat_messages (id, challenge_id)
  on delete set null (reply_to_message_id);

-- A reply may not point at itself.
alter table public.chat_messages
  add constraint chat_messages_reply_not_self
  check (reply_to_message_id is null or reply_to_message_id <> id);

-- For "replies to message X" (moderation tooling, future notifications).
create index chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;
```

- **PostgreSQL 17.6** supports the column-list `on delete set null
  (reply_to_message_id)` form (PG 15+). It nulls **only** `reply_to_message_id`,
  leaving the `NOT NULL` `challenge_id` untouched — the child row stays valid.
- Same-challenge is FK-guaranteed (the composite references
  `chat_messages_id_challenge_uniq`), **and** re-validated in the reply RPC
  (§10.3) so a clear Swedish error is returned rather than a raw FK violation.
- No `chat_messages_reply_not_self` cycle beyond depth 1 is possible to *render*
  — the read model only resolves one level (§11.3) — but two rows replying to
  each other is still nonsensical; a deeper cycle guard is unnecessary because
  `reply_to_message_id` can only ever be set at INSERT to an **already
  existing** row, so no cycle can form.
- `training_card` and `game_master` rows may be **targets** (`reply_to_message_id`
  on the *child*, which is always a `participant` row). A `training_card` /
  `game_master` row never itself carries `reply_to_message_id` because only
  `post_chat_message` (participant path) sets it.

### 9.2 Likes — `chat_message_likes`

```sql
create table public.chat_message_likes (
  message_id   uuid not null,
  challenge_id uuid not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),

  primary key (message_id, user_id),                    -- one like per user per message
  constraint chat_message_likes_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id)   -- FK-guaranteed same challenge
    on delete cascade                                    -- a like on a deleted message is meaningless
);

comment on table public.chat_message_likes is
  'One heart per (message, user). Written only by toggle_chat_message_like. '
  'Base SELECT is admin-only; members read like_count / liked_by_me through '
  'list_chat_messages. Not Realtime-published.';

-- PK (message_id, user_id) already covers: like_count `where message_id = X`
-- (leading column) AND liked_by_me `where message_id = X and user_id = Y`.
-- No additional index needed for this scale.
```

- `challenge_id` is **carried** (not derived on every read) — justification:
  (a) matches the `chat_message_attachments` precedent exactly; (b) the
  composite FK `(message_id, challenge_id)` FK-guarantees the like's challenge
  equals the message's — impossible to attach a like to a message and claim a
  different challenge; (c) `on delete cascade` cleans likes when a message /
  challenge is physically removed. The toggle RPC sets `challenge_id` from the
  looked-up `chat_messages` row, never from the client.
- **No `NOT NULL`/CHECK linking to `sender`** — a user can like any message,
  including their own and the GM's.
- `user_id → profiles(id) on delete cascade` — removing an account removes its
  likes; `like_count` adjusts down naturally (threat #17).

### 9.3 RLS / grants

```sql
alter table public.chat_message_likes enable row level security;
revoke all on public.chat_message_likes from anon, authenticated;
grant select on public.chat_message_likes to authenticated;

-- Admin-only base SELECT, exactly like chat_messages / chat_message_attachments.
create policy chat_message_likes_select on public.chat_message_likes
  for select to authenticated
  using (public.is_admin());
-- NO insert/update/delete policy — toggle_chat_message_like is the only writer.
```

Ordinary participants get **no direct SELECT** — `like_count` / `liked_by_me`
come from `list_chat_messages` (§11). This mirrors the established pattern and
means a hidden message's like metadata cannot leak via PostgREST.

---

## 10. Write RPC architecture

### 10.1 Canonical internal helper — keep `post_chat_message` compatible

`post_chat_message` is battle-tested and called by the **current production
frontend**. Rather than fork its logic or introduce a second public reply RPC,
extract a private helper and make `post_chat_message` a thin, **signature-
additive** wrapper:

```sql
-- Private: ALL message-creation logic (validation, rate limit, sender identity,
-- attachment linking, reply-target validation). Not granted to anon/authenticated.
create function public._create_chat_message(
  p_challenge_id        uuid,
  p_body                text,
  p_message_id          uuid,
  p_attachments         jsonb,
  p_reply_to_message_id uuid
) returns public.chat_messages
language plpgsql security definer set search_path = '' as $$ … $$;

revoke all on function public._create_chat_message(uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated;

-- Public: drop the current 4-arg version, recreate with an additive 5th
-- default param. Old callers ({p_challenge_id,p_body} or
-- {…,p_message_id,p_attachments}) still resolve — the new param defaults null.
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

There is exactly **one** `post_chat_message` function after this migration (the
4-arg is dropped and replaced by the 5-arg), so there is **no PostgREST
overload ambiguity**. The precedent is `20260906120200`, which dropped the
2-arg and created the 4-arg and whose own comment states *"a call with only
`{p_challenge_id, p_body}` still resolves — the new params default to NULL."*
A pgTAP test (§24) explicitly exercises **both** a `{p_challenge_id, p_body}`
call and a full 5-arg call to lock this.

### 10.2 the like write RPC

> **Task B implementation note (2026-09-08).** Shipped as an **idempotent
> state-setter**, not the toggle sketched below:
> `set_chat_message_like(p_message_id uuid, p_liked boolean) returns jsonb`.
> `p_liked = true` → `insert … on conflict do nothing`; `p_liked = false` →
> `delete … where user_id = auth.uid()`; repeating either call is a no-op, so a
> dropped-response retry can never flip the user's intent. Same guards
> (auth · **active** membership in the message's challenge · target exists ·
> `status = 'active'` — a new like *and* an unlike are refused on a hidden
> message). `chat_activity` is bumped **only when the stored state actually
> changed** (`if found` after the insert/delete). Returns
> `{ "liked": <committed state>, "like_count": <int> }`. The frontend passes
> the desired state (`setChatMessageLike(messageId, liked)`), which also removes
> the client-side "flip based on current cache" step from §18.1.

The original toggle sketch (superseded):

```sql
create function public.toggle_chat_message_like(p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid        uuid := (select auth.uid());
  v_challenge uuid;
  v_seq      bigint;
  v_status   text;
  v_liked    boolean;
  v_count    integer;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  select challenge_id, seq, status
    into v_challenge, v_seq, v_status
  from public.chat_messages
  where id = p_message_id;

  if v_challenge is null then
    raise exception 'Meddelandet finns inte';
  end if;

  -- ACTIVE membership in the message's challenge (mirror post_chat_message).
  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = v_challenge and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  -- Cannot newly like a hidden message (existing likes are retained but no
  -- new interaction with withheld content).
  if v_status <> 'active' then
    raise exception 'Det går inte att gilla ett dolt meddelande';
  end if;

  -- Atomic flip based on CURRENT DB state (never a client claim).
  insert into public.chat_message_likes (message_id, challenge_id, user_id)
  values (p_message_id, v_challenge, uid)
  on conflict (message_id, user_id) do nothing;

  if found then
    v_liked := true;                       -- a row was inserted → now liked
  else
    delete from public.chat_message_likes
      where message_id = p_message_id and user_id = uid;   -- existed → now unliked
    v_liked := false;
  end if;

  select count(*)::integer into v_count
  from public.chat_message_likes where message_id = p_message_id;

  -- Safe Realtime nudge: touch the target message's chat_activity row. This
  -- does NOT allocate a seq, does NOT create a chat_messages row, does NOT
  -- affect unread. Same mechanism the message fanout trigger uses.
  insert into public.chat_activity (challenge_id, seq, at)
  values (v_challenge, v_seq, now())
  on conflict (challenge_id, seq) do update set at = excluded.at;

  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

revoke all on function public.toggle_chat_message_like(uuid) from public, anon;
grant execute on function public.toggle_chat_message_like(uuid) to authenticated;
```

- Server-side verified: `auth.uid()` present · **active** challenge membership ·
  target exists · target belongs to a challenge the caller is an **active**
  member of · target `status='active'` · identity is `auth.uid()` (never a
  parameter) · uniqueness (`on conflict`).
- Returns `{liked, like_count}` so the client reconciles optimistic UI without
  trusting a client-supplied count.
- **No like rate limit** for this ~20-participant app (§21) — the
  `PRIMARY KEY (message_id, user_id)` + `on conflict` makes rapid like/unlike
  idempotent and race-safe; the client disables the control while its RPC is in
  flight (§18) so it cannot spam. A future add is trivial (a `count(*)` on
  `created_at > now() - interval` like `post_chat_message`) if abuse appears.

### 10.3 Reply-target validation inside `_create_chat_message`

When `p_reply_to_message_id is not null`, before inserting the child:

```sql
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
```

(The composite FK also enforces same-challenge; this yields a clean message
instead of `23503`.) A non-member / inactive-member caller is already rejected
by the existing active-membership check at the top of the helper. The child
row then inserts with `reply_to_message_id = p_reply_to_message_id` and every
other rule (body, attachments, rate limit, `seq`, sender identity) unchanged —
one shared code path, no weaker validation.

---

## 11. Safe read model

Extend `list_chat_messages` (drop + recreate — return shape widens, exactly as
`20260906120200` added `attachments` and `20260907120000` added
`training_card`) with **three additive columns**:

```
… existing columns … ,
like_count     integer,   -- 0 for a hidden row seen by a non-admin
liked_by_me    boolean,   -- false for a hidden row seen by a non-admin
reply_preview  jsonb      -- null when not a reply OR when reply_to is null;
                          -- {deleted:true} when the parent is hidden (non-admin);
                          -- else the safe preview object (§5.5)
```

### 11.1 `like_count` / `liked_by_me`

```sql
case when c.status = 'active' or public.is_admin() then (
       select count(*)::integer from public.chat_message_likes l
       where l.message_id = c.id)
     else 0 end as like_count,

case when c.status = 'active' or public.is_admin() then exists (
       select 1 from public.chat_message_likes l
       where l.message_id = c.id and l.user_id = (select auth.uid()))
     else false end as liked_by_me,
```

Same visibility gate as `body` / `attachments` / `training_card`. Both use the
`chat_message_likes` PK (`message_id` leading) — index lookups, no full scan.
The page is bounded ≤ 100 rows, so this is ≤ 200 index probes per page — well
within budget for this scale (§21). Source of truth stays the **rows**; no
materialized counter.

### 11.2 `reply_preview` — server-produced, one level, hidden-safe

```sql
case
  when c.reply_to_message_id is null then null
  else (
    select case
      when p.status = 'hidden' and not public.is_admin()
        then jsonb_build_object('deleted', true)
      else jsonb_build_object(
        'message_id',          p.id,
        'seq',                 p.seq,
        'sender_type',         p.sender_type,
        'sender_user_id',      p.sender_user_id,
        'sender_display_name', pp.display_name,
        'kind', case
          when p.sender_type = 'training_card' then 'training_card'
          when p.sender_type = 'game_master'   then 'game_master'
          when p.body is not null               then 'text'
          when exists (select 1 from public.chat_message_attachments a
                       where a.message_id = p.id) then 'image'
          else 'text' end,
        'text', case when p.status = 'hidden' then null
                     else left(p.body, 140) end,
        'has_image', exists (select 1 from public.chat_message_attachments a
                             where a.message_id = p.id),
        'training', case when p.training_entry_id is not null then (
                      select jsonb_build_object(
                               'activity', te.activity,
                               'duration_minutes', te.duration_minutes)
                      from public.training_entries te
                      where te.id = p.training_entry_id) end
      )
    end
    from public.chat_messages p
    left join public.profiles pp on pp.id = p.sender_user_id
    where p.id = c.reply_to_message_id
  )
end as reply_preview
```

- **The client never receives the full parent row.** The server projects only
  the allowed fields. For a hidden parent seen by a non-admin the payload is
  literally `{"deleted": true}` — no `text`, no `training`, no `has_image`, no
  `sender_display_name`, no GM content, no like metadata.
- `text` is `left(body, 140)` — a compact truncation, never the full 1000
  chars. Client adds an ellipsis.
- Resolved **live** every read — moderation applied after the reply was created
  is automatically reflected (§13).
- One `LEFT JOIN`-style scalar subquery per row; `p.id = c.reply_to_message_id`
  is a PK lookup; `attachments`-exists and `training_entries` are index lookups.
  Bounded page → fine (§21).
- `reply_to_message_id` null (never a reply, or FK `SET NULL` after physical
  parent delete) → `reply_preview = null` → the child renders as a plain
  message.

### 11.3 Exactly one level

The subquery reads **`p` (the direct parent) only**. It does **not** read
`p.reply_to_message_id`. `C` replying to `B` replying to `A` yields, for `C`, a
preview of `B` and nothing of `A`. Flat, non-recursive, bounded cost.

### 11.4 Backwards compatibility of the read model

Adding three columns to a `RETURNS TABLE` is additive. Every existing
`list_chat_messages` caller (pgTAP `0018–0021`, `0027`, `0029`; the frontend's
`mapChatRow`) selects **named columns** — verified. The old frontend's
`mapChatRow` ignores the three new keys; `like_count` / `liked_by_me` /
`reply_preview` simply are not read. See §22.

---

## 12. Reply-preview privacy (locked)

**The reply row must never contain a snapshot of the parent.** Replies are
implemented as a live `reply_to_message_id` FK + a **server-resolved** preview,
so:

- If the parent is hidden **after** the reply was created, the very next
  `list_chat_messages` page returns `reply_preview = {deleted:true}` for every
  ordinary participant — **without touching the child row**. The client renders
  the canonical `[Borttaget av administratör]`.
- No admin has to walk and scrub each reply.
- The child reply is **not** hidden just because its parent was (§13).
- `aria-label` / screen-reader text for the quote also degrades to
  "ett borttaget meddelande" — hidden content never crosses the trust boundary
  through an accessibility string either (§7.3).
- The server sends a **boolean marker** (`{deleted:true}`), not the placeholder
  string, so the exact copy stays in one place (`chat.ts`) and there is zero
  chance of leaking a hidden field alongside it.

Admins keep intended moderation visibility: for an admin caller the
`reply_preview` resolves the real parent even when hidden (consistent with
`list_chat_messages` returning the real `body` / `attachments` to admins).

---

## 13. Moderation semantics

| Event | Effect |
| ----- | ------ |
| Admin hides a **normal message** | unchanged: `list_chat_messages` returns `body=null`, `attachments='[]'`, `training_card=null`; **now also** `like_count=0`, `liked_by_me=false`. The client renders `[Borttaget av administratör]`. `chat_message_likes` rows are **retained** in the DB. |
| Admin hides a **child reply** | the child becomes `[Borttaget av administratör]` exactly like any hidden message; its own `reply_preview` is still computed (its parent may be fine) but the child's body/attachments/likes are withheld. |
| Admin hides a **parent** that has replies | every reply's `reply_preview` becomes `{deleted:true}` on the next read — **automatically, no child modification**. The replies themselves remain visible. |
| New like on a hidden message | **rejected** server-side — `Det går inte att gilla ett dolt meddelande` (§10.2). |
| New reply to a hidden message | **rejected** server-side — `Meddelandet går inte längre att svara på` (§10.3). The composer keeps the draft; reply mode drops. |
| `hide_chat_message` on a training card | already supported (§ current state); the card's `training_card` payload is withheld, and now `like_count`/`liked_by_me` too. |
| `hide_chat_message` on a Game Master row | still **refused** (unchanged). GM messages are withdrawn by cancelling the event, not hidden. This is unaffected by likes/replies. |

`hide_chat_message` itself is **not modified** — the read model does all the
work. `chat_message_likes` rows are not physically deleted on moderation (only
on a message/challenge/account physical cascade).

---

## 14. Training-card integration

- Likes: a training card is a `chat_messages` row → the **same**
  `chat_message_likes` model, the **same** badge. **No `training_entry_id` on
  the like row** and no training-specific likes table.
- Replies: a reply **to** a training card is an ordinary participant
  `chat_messages` row whose `reply_to_message_id` points at the
  `sender_type='training_card'` row. The reply **does not** copy
  `training_entry_id` — the relation stays `reply → parent chat message →
  training card → training_entry`, keeping the social and training layers
  cleanly separated (§ user constraint).
- Quote preview of a card: `🏃 {activity} · {formatMinutes(duration)}` from the
  **live** `training_entries` row (§5.5, §11.2). No proof image, no upload, no
  stored payload copy.
- Invalidated card: still likeable, still replyable, quote still resolves
  (`entryStatus='invalidated'` is not `hidden`); the card shows "Passet har
  underkänts" as today (§4.10).
- `TrainingCard.tsx` internals unchanged — it only gains the wrapper
  swipe/double-tap affordance, the action row, and the badge (§8.5).

---

## 15. Game Master integration

- GM messages are **likeable** and **replyable** (§1). The GM is not a
  participant; it never toggles anything.
- The reply quote of a GM message shows `GAME MASTER` + `left(body,140)` (a
  safe visible portion; GM message bodies are already the participant-visible
  roast/summary text — there is no separate "internal" GM body on
  `chat_messages`).
- **No GM behaviour change.** `requestGameMasterPulse`, the GM engine, the
  event/template tables — untouched. No `@gm` trigger, no AI. The GM engine
  does **not** read `chat_message_likes` in this slice; the table is available
  for a future GM iteration to consume without a schema change (§27).
- `hide_chat_message` still refuses GM rows — unchanged.

---

## 16. Realtime

| Interaction | Signal |
| ----------- | ------ |
| **Reply sent** | it is a `chat_messages` INSERT → the **existing** `chat_messages_activity_fanout` trigger upserts `chat_activity(challenge_id, new.seq)` → subscribed clients invalidate the message list → refetch `list_chat_messages` → the reply appears with its quote. **Nothing new.** |
| **Like / unlike** | `toggle_chat_message_like` **touches** the *target message's* existing `chat_activity` row (`on conflict … do update set at = now()`) → the client's channel fires an UPDATE → the message list is invalidated → refetch → new `like_count` / `liked_by_me`. |

- `chat_message_likes` is **not** published to `supabase_realtime`. No new
  publication. `chat_messages`, `training_entries`, `training_proofs`,
  `storage.objects` stay unpublished.
- The like `chat_activity` touch does **not** change `chat_read_state` or
  `unread_chat_count` — those are computed from `chat_messages.seq` vs
  `last_read_seq`, not from `chat_activity` (§17).
- **Known minor:** a like touch invalidates both the message-list *and* the
  unread query key (the client cannot tell a like-signal from a message-signal
  because `chat_activity` carries no "kind"). The unread refetch returns an
  **unchanged** value — a redundant round-trip, no correctness impact. If it
  ever matters, a nullable `kind` column on `chat_activity` (`'message'` /
  `'like'`) lets the client skip the unread refetch — deferred, YAGNI.

---

## 17. Read / unread

| Action | `seq` allocated? | affects `unread_chat_count`? |
| ------ | ---------------- | --------------------------- |
| send a reply | **yes** (it is a normal message) | **yes** — for other users, exactly like any new message |
| like / unlike anything | **no** | **no** |

The `unread_chat_count` RPC is **not modified**. A pgTAP test asserts a like
does not change it (§24). `mark_chat_read` is unchanged; a like never becomes a
read-cursor position.

---

## 18. Optimistic UI

### 18.1 Likes — instant

On tap (double-tap / badge / action button):

1. Immediately update the local cache: flip `liked_by_me`, `like_count += ±1`,
   heart "pop" (unless reduced-motion). Disable that message's like control.
2. Call `toggle_chat_message_like`.
3. On success → set `liked_by_me` / `like_count` to the RPC's authoritative
   response; re-enable the control.
4. On failure → **roll back** to the pre-tap values; re-enable; show a small
   inline Swedish message *"Kunde inte gilla meddelandet. Försök igen."*
5. Because the control is disabled during the in-flight RPC, frantic double-taps
   cannot make local state drift — each toggle completes before the next is
   accepted. (The DB is atomic regardless — §10.2.)

Implementation: a `useToggleChatMessageLike` mutation with
`onMutate` (optimistic patch of the `['chat','messages',challengeId]` infinite-
query cache), `onError` (rollback via the snapshot), `onSuccess` (reconcile
from response). A per-`message_id` in-flight set gates the UI.

### 18.2 Replies — composer clears only on success

- The composer enters reply mode on arm; the draft/attachments are preserved
  across arm / re-target / cancel.
- On **successful** send → reply mode clears, draft + attachments clear (as
  today).
- On **failed** send (network, rate limit, hidden target, …) → reply mode
  **stays**, draft + attachments **stay**, a Swedish error shows
  (*"Kunde inte skicka svaret. Försök igen."* / the server's exact message for
  rate-limit / hidden-target). The user retries or edits.
- A reply message may also be optimistically appended (as `usePostChatMessage`
  does today for normal messages, if it does) — no change to that behaviour;
  the quote is rendered from the reply's own `reply_to_message_id` + a
  best-effort local lookup of the parent, falling back to the server
  `reply_preview` on the refetch.

---

## 19. Pagination / scroll interaction

The PR A scroll model (`stickToBottom` latch, `ResizeObserver` re-pin,
`programmaticScrollTo` guard, `useLayoutEffect` branches (a)/(b)/(c),
`isProgrammaticScroll`) is **preserved**. This feature must not regress any of
its tests (§25 regression list).

### 19.1 New content within a message must not fight the anchor

A reply quote block and a reaction badge add height. When they appear:

- On the **initial load** → they are part of the first render; the first-open
  pin + `ResizeObserver` re-pin (PR A branch (b) + the RO) already land on the
  newest message after async growth. No change needed.
- On a **like arriving over Realtime** while the viewer is stuck to the bottom →
  the badge appears → `ResizeObserver` fires → re-pin to bottom (correct).
- On a **like arriving** while the viewer has scrolled up reading history →
  `stickToBottom` is false → the RO does **not** re-pin → the viewport stays
  put (correct). A tiny height change from a badge higher up is absorbed by the
  browser; if it visibly shifts, that is the same accepted behaviour as an
  image loading higher up in history today.
- **Upward pagination** (branch (a)): `scrollAnchorAdjustment(prev, next)` uses
  `el.scrollHeight` deltas — badges/quotes on the newly prepended page are
  included in `next` automatically. No change needed.

### 19.2 A like refetch must not re-trigger the follow logic

`useLayoutEffect` branch (c) fires only when `maxSeq > reactedMaxSeq`. A like
refetch returns the **same** seqs (no new message) → branch (c) is a no-op →
the viewport is not moved. Verified against the current code (§25).

### 19.3 Jump-to-original

- **Target loaded** → find the DOM node by `data-seq`, `scrollIntoView({block:
  'center'})` (set `programmaticScrollTo` first so the `scroll` listener treats
  it as programmatic and does not unstick the latch), then a ~1.2 s highlight
  class.
- **Target not loaded** → repeatedly `fetchNextPage()` (the existing upward
  pager), **capped at 10 pages** (`REPLY_JUMP_MAX_PAGES`), checking after each
  page whether the target `seq` is in `query.data`. On found → scroll +
  highlight. On cap reached without the target → a one-line toast
  *"Kunde inte hitta meddelandet i historiken."* and stop. Never an unbounded
  loop.
- **Alternative considered (documented, not chosen for v1):** a
  `chat_message_context(p_message_id, p_radius)` RPC returning the page around
  a specific message in one call. Cleaner for very deep jumps, but adds a
  second read RPC and a cache-merge problem (the infinite query is a linear
  `seq`-descending list; splicing a non-contiguous window in is awkward).
  Bounded upward paging reuses the existing, tested mechanism and is enough for
  a 20-person chat. The RPC can be added later without changing the data model.

---

## 20. Security threat model

Every ordinary participant read of like/preview data goes through
`list_chat_messages` (membership-gated, hidden-safe). Every write goes through a
`SECURITY DEFINER` RPC that derives identity from `auth.uid()`.

| # | Threat | Prevented by |
| - | ------ | ------------ |
| 1 | **Forged `message_id`** (like or reply target) | RPC `select … from chat_messages where id = $1`; if not found → `Meddelandet finns inte`. |
| 2 | **Reply to another challenge's message** | `_create_chat_message` checks `v_parent_challenge = p_challenge_id`; **and** the composite FK `(reply_to_message_id, challenge_id) → chat_messages(id, challenge_id)`. |
| 3 | **Like another challenge's message** | `toggle_chat_message_like` derives `v_challenge` from the message row, then requires the caller to be an **active** member of `v_challenge`; the composite FK `(message_id, challenge_id)` on `chat_message_likes` prevents a mismatched insert. |
| 4 | **Reply to a hidden message** | `_create_chat_message` rejects `v_parent_status <> 'active'` → `Meddelandet går inte längre att svara på`. Re-checked at send, never trusting stale client state. |
| 5 | **Like a hidden message** | `toggle_chat_message_like` rejects `v_status <> 'active'`. |
| 6 | **`user_id` spoof** (like as someone else) | `user_id := auth.uid()` in the RPC — never a parameter. The `PRIMARY KEY (message_id, user_id)` is on the derived id. |
| 7 | **Duplicate concurrent likes** | `PRIMARY KEY (message_id, user_id)` + `insert … on conflict do nothing` — atomic; a second concurrent insert is a no-op. |
| 8 | **Unlike someone else's like** | the `delete` is `where message_id = $1 and user_id = auth.uid()` — you can only remove your own row. |
| 9 | **Direct table SELECT** of `chat_message_likes` | base RLS SELECT is `using (public.is_admin())`; `authenticated` non-admins match no policy → 0 rows. Members never need direct access — aggregates come from `list_chat_messages`. |
| 10 | **Reply preview leaks hidden parent text** | the preview is **server-produced**; a hidden parent seen by a non-admin returns `{deleted:true}` — no `text`, `training`, `sender_display_name`, or GM content. The client never receives the full parent row. |
| 11 | **Training proof path leaks through a preview** | the `training_card` preview returns only `activity` + `duration_minutes` (numbers/short text) — **never** a `storage_path`, never a signed URL. |
| 12 | **Game Master row spoof** (post a GM message via the reply path) | `_create_chat_message` always sets `sender_type := 'participant'`, `sender_user_id := auth.uid()` — `sender_type` is not a parameter (unchanged from today). |
| 13 | **`training_card` row spoof** | same — a participant cannot set `sender_type` or `training_entry_id`; the training-card row is written only by the `AFTER INSERT` trigger (unchanged). |
| 14 | **Stale client replies after moderation** | §4 above — the target's `status` is re-checked **inside the transaction** at send; a race between the admin's `hide` and the participant's `send` resolves at the DB (row-level ordering). |
| 15 | **Rapid like/unlike race** | atomic `insert … on conflict` + `delete where user_id = auth.uid()`; the final DB state is deterministic given commit order; the client disables the control while its RPC is in flight so its display matches the last response (§18.1). |
| 16 | **Deleted parent** (physical, via cascade) | `on delete set null (reply_to_message_id)` — the child survives as a plain message; `reply_preview` becomes `null`; no dangling reference, no leak. |
| 17 | **Account removed while likes remain** | `chat_message_likes.user_id → profiles(id) on delete cascade` — the person's likes vanish, `like_count` drops naturally. |
| 18 | **Membership deactivated while chat open** | `toggle_chat_message_like` and `_create_chat_message` both require `m.active` — a deactivated member's like/reply is rejected with a Swedish error; reads still work (they can still view history). |

Additional: **anon** has no EXECUTE on `toggle_chat_message_like` /
`post_chat_message` / `list_chat_messages` (revoked; granted to `authenticated`
only). `chat_message_likes` is not Realtime-published, so a socket subscriber
cannot enumerate likers.

---

## 21. Index / performance design

- `chat_message_likes` **`PRIMARY KEY (message_id, user_id)`** serves:
  - the one-like invariant,
  - `like_count`: `count(*) where message_id = X` (leading column),
  - `liked_by_me`: `where message_id = X and user_id = Y` (full key).
  No secondary index is added. (A `(user_id)` index for "all my likes" is YAGNI.)
- `chat_messages` **`chat_messages_reply_to_idx (reply_to_message_id) where
  reply_to_message_id is not null`** — partial, tiny; for "replies to X"
  (moderation tooling, future notifications). The read-model preview subquery
  itself uses the parent **PK** (`p.id = c.reply_to_message_id`), so it does
  not need this index.
- `list_chat_messages` aggregates over a **bounded page (≤ 100 rows)**: per
  row, one `count(*)` + one `exists` on `chat_message_likes` (PK), one PK
  lookup for the parent, one `exists` on `chat_message_attachments` (existing
  `chat_message_attachments_message_idx`), optionally one PK lookup on
  `training_entries`. All index-backed. No correlated sequential scan.
- **No materialized like counter.** The source of truth is the rows. At this
  scale (≈ 20 participants, low message volume) a denormalized counter would be
  drift risk for no measurable gain. If the chat ever grows 100×, a
  `chat_messages.like_count` column maintained by an `AFTER INSERT/DELETE`
  trigger on `chat_message_likes` is a clean, isolated follow-up — the read
  model would just read the column. Not now.
- `EXPLAIN` sanity of the new `list_chat_messages` on a realistic page is a
  Task-B verification step (§25 / plan).

---

## 22. Backwards compatibility

The migration is a **pure superset**: a nullable column, a new table, a new
RPC, a helper, and three additive read-model columns. Nothing existing is
removed or narrowed.

### 22.1 OLD frontend + NEW database — **safe**

- `post_chat_message` old calls (`{p_challenge_id, p_body}` or `{…,
  p_message_id, p_attachments}`) resolve against the 5-arg function —
  `p_reply_to_message_id` defaults `null` → a normal message. (Precedent:
  `20260906120200`.) A pgTAP test locks both call shapes.
- `list_chat_messages` gains 3 columns; the old `mapChatRow` reads by name and
  ignores them. `like_count` / `liked_by_me` / `reply_preview` are simply not
  used → no badge, no quote, no crash. Existing chat behaves exactly as before.
- `unread_chat_count`, `mark_chat_read`, `hide_chat_message` — untouched.
- The old client never calls `toggle_chat_message_like`.
- **Conclusion: the migration can land first with no broken window.**

### 22.2 NEW frontend + OLD database — **NOT safe** for the new features

- The new client's `sendChatMessage`, when *not* replying, can (and should)
  **omit** `p_reply_to_message_id` → a 4-arg call → resolves against the OLD
  4-arg `post_chat_message` → normal messages still work.
- A **reply** attempt from the new client sends `p_reply_to_message_id` → the
  OLD 4-arg function → PostgREST "no function matches" → the reply **fails**.
- `toggle_chat_message_like` does not exist on the old DB → every like **fails**.
- `list_chat_messages` returns no `like_count` / `liked_by_me` / `reply_preview`
  → `mapChatRow` yields `likeCount = 0`, `likedByMe = false`, `replyPreview =
  null` → **no badges, no quotes** (graceful — the UI simply shows nothing).
  Normal chat, images, training cards, scroll, unread all still work.
- **Conclusion: the new frontend degrades gracefully for reads but its write
  features are broken against the old DB.**

### 22.3 Recommended rollout order — **DB-FIRST**

Unlike PR A.5 (which was code-first because the migration *added* behaviour the
old client would mis-render), here the migration is a benign superset for the
old client and a hard prerequisite for the new one. Therefore:

1. Merge the PR to `main`; run all merged-main gates.
2. **`supabase db push --linked --dry-run`** — must propose **exactly** the one
   new migration.
3. **Apply the migration.** The old production frontend keeps working
   unchanged (§22.1) — no broken window.
4. Read-only verify live: 28 migrations, the column / table / FK / RPC / helper
   / read-model shape / RLS / grants / Realtime publication unchanged (still
   `chat_activity` only) / **zero historical likes or replies** (§ NO DATA
   SYNTHESIS).
5. `npm run db:types`; commit the additive generated-type diff to `main`; full
   gates.
6. Fast-forward `production` to that commit → Cloudflare deploys the **new
   frontend** against the **already-migrated** DB. Likes + replies activate at
   this deploy.
7. Live-verify the new frontend: env config valid, PR markers present, and a
   read-only DB re-check.

No synthetic likes/replies. The next real user interaction is the first one.

The full ordered runbook is in the implementation plan (§ "Task J").

---

## 23. Production rollout strategy

See §22.3. Key points for the plan:

- One migration file: `2026090XNNNNNN_chat_replies_likes.sql` (timestamp chosen
  at implementation time, after `20260907120000`).
- One pgTAP file: `0030_chat_replies_likes.test.sql`.
- The migration is **additive-only**; DB-first is the no-broken-window order.
- `db:types` regeneration expected diff: `chat_messages.reply_to_message_id`,
  the `chat_message_likes` table + its relationships, `toggle_chat_message_like`
  in `Functions`, `like_count` / `liked_by_me` / `reply_preview` on
  `list_chat_messages`' Returns, and `post_chat_message`'s new 5th arg + its
  `chat_messages` Return picking up `reply_to_message_id`. All additive.
- The `chatdb = supabase as unknown as SupabaseClient` cast in `chat-api.ts`
  stays (established convention); no hand-edit of generated types.
- Cloudflare preview stays unusable (known preview-trigger env-var gap — not a
  code defect).
- David is not touched. `purge-david.sql` / `storage-rm.mjs` are not executed.

---

## 24. Database tests (pgTAP `0030_chat_replies_likes.test.sql`)

Fixtures: an admin, two members of challenge A (Pia, Ove-as-non-member of A but
member of B), one member of a second challenge B. A GM message and a training
card (insert a `training_entries` row → the trigger makes the card) in A.

### 24.1 Like security

1. active member can `toggle_chat_message_like` a visible same-challenge
   **participant** message → `{liked:true, like_count:1}`.
2. can like an **image** message.
3. can like a **training card**.
4. can like a **Game Master** message.
5. can like **their own** message.
6. toggling again → `{liked:false, like_count:0}` (unlike).
7. a **non-member** (member of B only) cannot like an A message → throws.
8. an **inactive** member (`active=false`) cannot like → throws.
9. **cross-challenge**: a B member liking an A message → throws.
10. a caller **cannot supply another `user_id`** — the RPC takes only
    `p_message_id`; the like row's `user_id` is always `auth.uid()`.
11. **duplicate** like impossible — `PRIMARY KEY (message_id, user_id)`;
    a direct second `insert` throws `23505`; via the RPC it toggles to unlike.
12. **unlike only removes own** — Pia likes, Ove likes; Ove toggles →
    Pia's like remains, `like_count` = 1.
13. `list_chat_messages` returns `like_count` correct (0 / 1 / many).
14. `liked_by_me` is **viewer-relative** — true for the liker, false for a
    co-member who did not like.
15. **hidden message** → `list_chat_messages` returns `like_count = 0`,
    `liked_by_me = false` to a non-admin even though rows exist; **admin** sees
    the real count.
16. a like **does not change `unread_chat_count`** (before/after equal).
17. a like **touches `chat_activity`** for the target `(challenge_id, seq)`
    (`at` advances) and does **not** insert a `chat_messages` row.
18. `toggle_chat_message_like` on a hidden message → throws
    `Det går inte att gilla ett dolt meddelande`.
19. `chat_message_likes` base SELECT: a non-admin `authenticated` gets 0 rows;
    admin sees rows.
20. anon has **no EXECUTE** on `toggle_chat_message_like`.

### 24.2 Reply security

21. reply to a **participant** message (via `post_chat_message` 5-arg) → child
    row with `reply_to_message_id` set, normal `seq`, `sender_type='participant'`.
22. reply to an **image** message.
23. reply to a **training card** — child's `reply_to_message_id` = the card's
    id; child's `training_entry_id` is **null**.
24. reply to a **Game Master** message.
25. reply to **own** message.
26. **cross-challenge** reply rejected — `p_reply_to_message_id` in B, message
    in A → throws `… tillhör en annan utmaning`; the composite FK also rejects a
    direct mismatched insert (`23503`).
27. reply to a **hidden** target rejected → `Meddelandet går inte längre att
    svara på`.
28. reply to a **non-existent** target rejected.
29. **non-member / inactive** member cannot reply (existing active-membership
    check).
30. sender **cannot be spoofed** — `sender_user_id = auth.uid()`,
    `sender_type = 'participant'`.
31. the child reply gets a **normal `seq`** (contiguous with other messages).
32. the **existing rate limit** applies to replies — the 11th message
    (reply or not) in 30 s throws.
33. a reply's **image attachments** use the existing validation (path prefix,
    real object, ≤ 4, mime) — reuse `_create_chat_message`.
34. **parent hidden after the reply was sent** → `list_chat_messages`
    `reply_preview = {deleted:true}` for a non-admin; the **child is still
    visible**; the child row is **unchanged** (`reply_to_message_id` still set).
35. **admin** sees the real `reply_preview` for a hidden parent.
36. `reply_preview` resolves **exactly one level** — `A ← B ← C`: `C`'s
    `reply_preview` is `B` (with `B`'s own text), and contains **no** field of
    `A`.
37. **`post_chat_message` compatibility**: a `{p_challenge_id, p_body}` call
    still creates a normal message (`reply_to_message_id` null); a full 5-arg
    call sets the reply link. Both resolve (no PostgREST ambiguity).
38. **physical parent delete** (`delete from chat_messages where id = parent`)
    → child survives, `reply_to_message_id` is `null`, `challenge_id` unchanged
    (`on delete set null (reply_to_message_id)`), `reply_preview` = `null`.
39. a `training_card` / `game_master` row never itself carries
    `reply_to_message_id` (only `_create_chat_message` sets it, and that path
    always writes `sender_type='participant'`).
40. `chat_messages_reply_not_self` — `reply_to_message_id = id` rejected.

### 24.3 Read model

41. an ordinary message with no likes / not a reply → `like_count = 0`,
    `liked_by_me = false`, `reply_preview = null` (backwards-compatible shape).
42. multiple likers → `like_count` aggregates correctly; each viewer's
    `liked_by_me` correct.
43. `reply_preview.kind` correct per target: `text` / `image` / `training_card`
    / `game_master`.
44. **image-only** parent preview: `text = null`, `has_image = true`.
45. **training-card** parent preview: `training.activity` +
    `training.duration_minutes` present, **no `storage_path` anywhere in the
    payload**.
46. **Game Master** parent preview: `sender_display_name` resolves to a GM
    label path (client renders `GAME MASTER`), `text = left(body,140)`.
47. hidden parent, non-admin → `reply_preview = {deleted:true}` and **no other
    key**.
48. `reply_preview.text` is at most 140 chars even when `body` is 1000.
49. Regression: existing `0018–0021`, `0027`, `0029` still pass unchanged
    (the read-model column additions do not break named-column selects).
50. `list_chat_messages` EXECUTE still `authenticated`-only; return type
    contains the three new columns.

### 24.4 Realtime / publication

51. `supabase_realtime` still publishes **only `chat_activity`** among
    `{chat_activity, chat_messages, chat_message_attachments, chat_message_likes,
    training_entries, training_proofs}`.

`plan(N)` computed at write time (~51).

---

## 25. Frontend tests (Vitest)

### 25.1 Heart

- `<LikeBadge>` — 0 → renders nothing; 1 → heart only, no number; ≥ 2 → heart +
  `tnum` count; `likedByMe` → filled/accent glyph; not → outline/muted;
  `aria-label` cases ("1 person gillar…", "3 personer gillar…", "Du och 2
  andra…").
- `useToggleChatMessageLike` — `onMutate` optimistic patch of the infinite-
  query cache (flip `likedByMe`, `likeCount ± 1`); `onError` rollback to
  snapshot; `onSuccess` reconcile from `{liked, like_count}`; a per-`message_id`
  in-flight guard; two rapid toggles settle to the last server response.
- `MessageRow` — double-tap (2 `pointerup` within 260 ms, < 10 px) toggles like
  + pops; single tap does **not**; double-tap **on an image** likes and does
  **not** leave the lightbox open (§6.2); `prefers-reduced-motion` → no pop,
  state still applies.
- Training-card badge renders identically.
- GM message badge renders.
- **Hidden** message → no badge, no like control, `mapChatRow` yields
  `likeCount 0` / `likedByMe false`.
- The action-row ❤️ button: role, name, keyboard (Enter/Space) toggle.

### 25.2 Reply

- Swipe: horizontal past threshold (64 px) arms reply; a mostly-vertical drag
  (`|dy| > 10`) does **not**; `pointercancel` snaps back; the ↩️ reveal appears
  during drag.
- Explicit "Svara" button → composer enters reply mode.
- Composer reply strip: shows viewer-relative sender + 1-line preview; ✕
  cancels and **keeps the draft**; re-targeting keeps the draft.
- Send success → reply mode clears, draft clears.
- Send failure → reply mode **stays**, draft **stays**, Swedish error shown.
- Hidden-target-at-send → server error surfaced, draft kept, reply mode drops.
- `<ReplyQuote>` rendering per `reply_preview.kind`: text (shortened + ellipsis),
  image-only (`📷 Bild`), training card (`🏃 {activity} · {min}`), GM
  (`GAME MASTER` + text), **`{deleted:true}` → exactly `[Borttaget av
  administratör]`** and an accessible name that does **not** leak content.
- Flat rendering: `C` replying to `B` shows **one** quote (of `B`), never `A`.
- Attachment reply: images picked in reply mode go through the existing
  `chat-media` + PR A compression path; the sent message carries both the
  `reply_to` and the attachments.
- `mapChatRow` maps `reply_preview` → `ChatMessage.replyPreview`
  (`ReplyPreview | null`), viewer-relative label resolved in the component.
- `mapChatRow` backwards-compat: a pre-migration row (no `like_count` /
  `liked_by_me` / `reply_preview` keys) → `likeCount 0`, `likedByMe false`,
  `replyPreview null`, **no throw** (mirrors the `chat-api.test.ts`
  "pre-PR-8 shape" tests added for PR A.5).

### 25.3 Jump-to-original

- Target **loaded** → `scrollIntoView` called, highlight class applied,
  `programmaticScrollTo` set so the `scroll` listener does not unstick the
  latch.
- Target **not loaded** → `fetchNextPage` called at most `REPLY_JUMP_MAX_PAGES`
  times; on found → scroll + highlight; on cap → toast, no more fetches.
- No unbounded loop (assert the fetch call count is bounded).

### 25.4 Regression (must stay green)

- PR A: first-open pin, media-growth re-pin, scroll-up unsticks, re-stick,
  reopen-at-newest, upward-pagination anchor, near-bottom follow, "Nya
  meddelanden", read-cursor advance rules.
- PR A image compression: `image-processing` / `image-decode` / `media-mocks`
  suites unchanged and green.
- Chat images: `ChatImageGrid` / `ChatLightbox` / `chat-media` unchanged.
- Training cards: `TrainingCard` tests; invalidation → "Passet har underkänts".
- `chat-api` pre-PR-8 backwards-compat suite still green.
- `submit-training.gm` — `requestGameMasterPulse` unchanged.
- `unread` behaviour: a like does not bump the badge (component + hook level).
- No import cycle (chat feature must not import an admin module for the like/
  reply controls — the action row lives in the chat feature).

---

## 26. Failure handling

| Failure | Behaviour | Copy |
| ------- | --------- | ---- |
| like RPC network / 5xx | optimistic rollback; control re-enabled | `Kunde inte gilla meddelandet. Försök igen.` |
| like on a message hidden mid-interaction | rollback; the message is already re-rendered as hidden by the refetch | server: `Det går inte att gilla ett dolt meddelande` (surfaced compactly) |
| reply send network / 5xx | reply mode stays, draft stays | `Kunde inte skicka svaret. Försök igen.` |
| reply send — rate limit | reply mode stays, draft stays | server's exact: `För många meddelanden på kort tid. Vänta en liten stund.` |
| reply send — target hidden mid-flight | reply mode drops, draft stays | `Meddelandet går inte längre att svara på.` |
| jump-to-original — target not in history after the page cap | one-line toast, stop | `Kunde inte hitta meddelandet i historiken.` |
| jump-to-original — target since hidden | scroll to it anyway; it renders as `[Borttaget av administratör]` | — |

No explanatory paragraphs in the UI. Actions are obvious; errors are one line.

Swedish copy set (final):

```
Svara
Svarar på {namn}
Gilla / Ta bort gilla-markering
Gilla passet / Ta bort gilla-markering            (training card)
Gilla meddelandet                                 (aria)
1 person gillar meddelandet                       (aria)
3 personer gillar meddelandet                     (aria)
Du och 2 andra gillar meddelandet                 (aria, liked_by_me)
Svara på {namn}s meddelande                       (aria)
Svar på {namn}s meddelande: "{utdrag}"            (aria, quote)
Svar på ett borttaget meddelande                  (aria, hidden target)
📷 Bild                                            (image-only quote)
[Borttaget av administratör]                       (hidden quote — UNCHANGED constant)
Meddelandet går inte längre att svara på.
Det går inte att gilla ett dolt meddelande.
Kunde inte gilla meddelandet. Försök igen.
Kunde inte skicka svaret. Försök igen.
Kunde inte hitta meddelandet i historiken.
```

---

## 27. Future notification compatibility

A later notification slice (in-app + Web Push) must be able to emit
*"{X} svarade på ditt meddelande"* and *"{X} gillade ditt meddelande"* without
touching the core relations designed here:

- **Reply notification source**: `chat_messages` rows where
  `reply_to_message_id` is not null; the recipient is the *parent's*
  `sender_user_id`; `chat_messages_reply_to_idx` supports the lookup. A future
  `AFTER INSERT` trigger on `chat_messages` (guarded on
  `reply_to_message_id is not null`) can enqueue a notification event.
- **Like notification source**: `chat_message_likes` rows; the recipient is the
  liked message's `sender_user_id` (join to `chat_messages`); a future
  `AFTER INSERT` trigger on `chat_message_likes` can enqueue one.
- Both triggers would be **new, isolated** objects; neither the like table nor
  the reply column needs a shape change.
- The design already stores **safe references only** (ids, not content
  snapshots) — a notification can resolve its display text through the same
  authorized read model at render time, so a later `hide` leaves no stale copy
  (the exact principle the moderation rules here enforce).
- **Not built now.** No `notification_*` table, no trigger, no enqueue.

---

## 28. Future avatar / mention compatibility

- **Avatars**: the reply quote and the reaction badge render a *sender label*
  today; a future avatar slice enriches `list_chat_messages` /
  `reply_preview` with an avatar reference (resolved to a signed URL
  client-side, initials fallback) — a purely additive read-model field. The
  `<ReplyQuote>` and message header components take a "sender" prop shape that
  can gain an `avatarPath` without a structural change.
- **@mentions**: unaffected. A mention slice adds `chat_message_mentions`
  (`message_id`, `mentioned_user_id`) written by `_create_chat_message` from
  resolved `@handle` tokens — orthogonal to `reply_to_message_id` and
  `chat_message_likes`. The shared helper `_create_chat_message` is the right
  seam for that future step.

---

## 29. Explicit separation from jury mechanics

A future **jury / "Bedöm pass"** feature lets participants vote on whether a
logged training day *counts*. It is **completely separate** from hearts:

- Jury verdicts will live on **`training_entries`** (or a dedicated
  `training_entry_verdicts` table) — never on `chat_messages` or
  `chat_message_likes`.
- A heart is a **social** reaction with **zero** effect on training validity,
  completed/missed, debt, streak, ranking, KASSAN, Straffbanken, weight,
  challenge finalization or the Game Master (§ core isolation).
- The training card in chat may *later* gain a small jury affordance, but that
  affordance and its data are independent of the heart on the same card.
- Nothing in this slice reads or writes a training-validity signal. The
  `toggle_chat_message_like` RPC touches only `chat_message_likes` and
  `chat_activity`; `_create_chat_message` touches only `chat_messages` +
  `chat_message_attachments`.

---

## 30. Design approaches considered

### Approach A — nullable `reply_to_message_id` on `chat_messages` + normalized `chat_message_likes` + aggregates in `list_chat_messages` *(RECOMMENDED)*

| | |
| - | - |
| **Advantages** | Reuses every existing pattern: the composite `(id, challenge_id)` FK (attachments precedent), the admin-only base SELECT + safe read RPC, the `chat_activity` fanout, `SECURITY DEFINER` RPC-only writes, the additive-column read-model dance. A reply *is* a message → all message behaviour is inherited for free (rate limit, `seq`, moderation, unread, images, PR A compression). Moderation privacy is automatic — the preview resolves live, nothing to scrub. Minimal new surface: 1 column, 1 table, 1 RPC + 1 helper, 3 read-model columns. |
| **Disadvantages** | `list_chat_messages` grows a few subqueries (bounded page → fine). `post_chat_message` gets a 5th default param (mitigated: single function, precedent, explicit compat test). |
| **Moderation** | Best-in-class: `{deleted:true}` marker, live resolution, no child mutation, no admin scrubbing. |
| **Migration complexity** | Low — additive; DB-first with no broken window (§22). |
| **Client complexity** | Low — `mapChatRow` gains 3 fields; a `<LikeBadge>`, a `<ReplyQuote>`, an action row, a swipe/double-tap handler on the existing `MessageRow`. |
| **Query cost** | ≤ ~4 index lookups per row × ≤ 100 rows/page. No materialized state. |
| **Future extensibility** | Notification triggers, avatars, mentions all attach without a shape change (§27–§28). |

### Approach B — a generic `chat_social_events` / interaction-event table

A single table `(id, challenge_id, message_id, actor_user_id, kind
('like'|'reply'|'mention'|…), payload jsonb, created_at)`; replies are still a
`chat_messages` row but the *link* and the *like* are both rows here.

| | |
| - | - |
| **Advantages** | One table for all future social interactions; a notification layer reads one stream. |
| **Disadvantages** | The one-like-per-user invariant becomes a partial unique index on `(message_id, actor_user_id) where kind='like'` — workable but less obvious. A reply's link living in an event table (not on the message) means `list_chat_messages` must join the event table to know a message is a reply, and the FK-guaranteed same-challenge parent (composite FK to `chat_messages(id, challenge_id)`) is harder to express. `payload jsonb` invites snapshotting the parent → the exact moderation-leak trap this spec forbids. Over-generalised for "one heart + a nullable parent link". |
| **Moderation** | Riskier — a `payload` column is a standing temptation to cache content; must be disciplined to store ids only. |
| **Migration complexity** | Similar. |
| **Client complexity** | Higher — the client reasons about an event stream in addition to the message stream. |
| **Query cost** | An extra join per message to detect reply-ness; like aggregation is a filtered `count`. |
| **Future extensibility** | Superficially better for notifications, but §27 shows Approach A reaches the same place with isolated triggers and *without* a content-snapshot risk. |

### Approach C — separate `chat_message_replies` table (a reply is NOT a `chat_messages` row)

Rejected outright: it would fork the entire message pipeline (rate limit,
`seq`, moderation, images, unread, `chat_activity`, PR A compression) — exactly
the "parallel replies table containing duplicate messages" the constraints
forbid. A reply must remain a first-class message (it can be liked and replied
to — §5.10).

### Recommendation

**Approach A.** It is the simplest architecture that preserves correctness and
privacy, reuses every hardened pattern in the codebase, keeps replies as
first-class messages, and makes the critical moderation rule automatic rather
than a maintenance burden.

---

## 31. Spec self-review (2026-09-07)

Reviewed from scratch against the failure list in the task:

- **No `TBD` / `TODO`** — every open choice (double-tap-vs-lightbox handling,
  jump-to-original mechanism, `chat_activity` `kind` column) is resolved with a
  chosen default and the alternative explicitly deferred.
- **No contradictory reply semantics** — replies are flat, one level, always a
  `participant` `chat_messages` row; the parent may be any kind; `training_card`
  / `game_master` are never themselves replies (§9.1, §24 #39).
- **Hidden-message behaviour is unambiguous** — §12, §13, §20 #4/#5/#10/#14;
  server returns `{deleted:true}`, client renders the canonical constant,
  aria-label degrades too, admin still sees real data. New like/reply on hidden
  is server-rejected.
- **FK behaviour is explicit** — `reply_to_message_id` composite FK to
  `chat_messages(id, challenge_id)` with `on delete set null
  (reply_to_message_id)` (PG 17.6 column-list form); `chat_message_likes`
  composite FK with `on delete cascade`; `user_id → profiles on delete cascade`.
  Physical-delete degradation (§16, §20 #16) documented.
- **No duplicated data that can leak after moderation** — the reply row stores
  **only** `reply_to_message_id` (an id); the like row stores ids +
  `created_at`; the preview is server-produced live. §12 is the locked rule and
  the model obeys it structurally.
- **No direct-table privacy hole** — `chat_message_likes` base SELECT is
  `is_admin()`-only; members read aggregates via `list_chat_messages`; the like
  table is not Realtime-published; §20 #9.
- **Likes never affect unread** — §4.8, §17; the `chat_activity` touch is
  seq-preserving and unread is computed from `chat_messages.seq`; pgTAP #16.
- **Replies do not break old `post_chat_message`** — §10.1, §22.1; single
  function, additive default param, precedent (`20260906120200`), explicit
  compat pgTAP #37 and Vitest.
- **No N+1** — §11, §21; bounded page, index-backed subqueries, no materialized
  counter, `EXPLAIN` check in the plan.
- **No accidental notification implementation** — §2, §27; no
  `notification_*` table, no enqueue trigger, only a documented future seam.
- **No jury coupling** — §29; hearts touch only `chat_message_likes` +
  `chat_activity`; jury will live on `training_entries`.
- **No GM behaviour change** — §15; `requestGameMasterPulse`, the GM engine and
  tables are untouched; `hide_chat_message` still refuses GM rows; the GM
  engine does not read likes.
- **PR A scroll not damaged** — §19; the like refetch returns the same seqs
  (branch (c) no-op), badges/quotes are absorbed by the existing
  `ResizeObserver` re-pin and `scrollAnchorAdjustment`, jump-to-original sets
  `programmaticScrollTo`. Regression list in §25.4.
- **Core isolation absolute** — no new FK from any core/weight/Straffbanken/GM
  table to a social table; no social table on a completion/reconcile path; the
  like/reply RPCs write only chat tables.

No changes required to the document from this review beyond the clarifications
already folded in above.
