# Hälsoutmaningen — Social Chat, Media Optimization & Notifications Design

Date: 2026-09-06

Status: **APPROVED DESIGN — implementation not started**

---

## 1. Purpose

Expand the existing Shared Chat and social layer without changing the core
challenge mechanics.

The work adds:

1. Fix chat opening at newest message
2. Aggressive client-side image compression
3. Participant profile images
4. Message replies
5. Message likes
6. `@mentions` with stable handles
7. In-app notifications
8. PWA / Web Push notifications

Explicitly **not** included for now:

- custom fonts
- custom text colors
- clipart / stickers
- Game Master integration

The app must remain visually clean and focused. Do not turn the chat into
Discord. The intended feel remains **Strava × WHOOP × premium Scandinavian
fintech**.

---

## 2. Core isolation

This entire feature set is a **social layer**. It MUST NOT affect:

- completed / missed training state
- challenge debt
- streak calculation
- main rankings
- KASSAN
- Straffbanken
- weight competition logic
- challenge completion
- after-registration (efterregistrering) logic
- Game Master logic

No new social trigger may mutate those systems. No new FK from a core /
weight / Straffbanken / Game Master table to a social table. No social table
becomes a dependency of any challenge-completion or reconcile path.

---

## 3. Implementation / release order

Implement as **four separate PRs**. Never combine all work into one giant PR.

| PR | Scope |
| -- | ----- |
| **PR A** | Chat scroll fix + image compression |
| **PR B** | Profile images (+ the stable-handle groundwork if it is cheaper to land here — see §7 note) |
| **PR C** | Replies + likes + `@mentions` + in-app notifications |
| **PR D** | PWA + Web Push |

Each PR must be independently testable and releasable.

Production release model remains:

```
feature branch
  → PR
  → main
  → controlled database rollout if needed
  → regenerate DB types
  → full verification
  → advance the production branch
  → Cloudflare production deploy
```

Never bypass the production branch release gate (see §22).

---

## 4. PR A — chat scroll fix

### Current bug

On the **first** opening of Shared Chat, the user does not reliably land on
the newest message.

Observed:

- first opening may show an older position
- user manually scrolls to newest
- closes chat
- reopens chat
- newest position is then retained

### Required behaviour

On first open, **after the initial newest-message batch has actually been
rendered**, the chat must land at the newest message automatically. Do not
depend on a previous scroll position. The implementation must account for
asynchronous rendering **and media** — do not perform the initial scroll too
early (a `useLayoutEffect` fired before images/avatars have contributed their
height will pin to the wrong offset; the initial pin must be re-asserted once
the list's scroll height has settled, e.g. after the first paint of the first
page and again if a media element in that page loads and grows the list while
the user has not yet scrolled).

### Desired behaviour

| # | Situation | Behaviour |
| - | --------- | --------- |
| A | First open | show newest messages immediately |
| B | Loading older messages upward | preserve visual scroll position |
| C | Incoming message while near bottom | auto-follow |
| D | Incoming message while user is reading history | **do not yank** to the bottom; show **"Nya meddelanden"** |
| E | Clicking "Nya meddelanden" | scroll to newest |
| F | Read / unread semantics | must remain correct; `seq` stays the canonical cursor/order key |

### Optional polish (approved)

If the user returns with unread messages, show a subtle **unread divider** at
the correct boundary (the first message with `seq > last_read_seq`) where
appropriate. It is presentational only and must not change how
`mark_chat_read` advances.

---

## 5. PR A — image compression

### Goal

Minimize Supabase Storage usage while preserving enough quality for training
proof, Strava screenshots, selfies and chat photos. Compression happens
**before upload, in the browser**. Users should not manage compression
manually.

UI may show: **"Förbereder bild…"** then **"Laddar upp…"**.

### Shared media processing

A **shared reusable media-processing module** is preferred over duplicating
logic between chat and training proof. Both the chat composer
(`chat-media.ts`) and the training-proof path (`submit-training.ts` /
`ProofSlots`) call the same processor; per-use-case parameters (target long
side, quality, output format) are arguments, not forks of the code.

### Chat + training-proof targets

- max long side ≈ **1600 px**; preserve aspect ratio
- remove unnecessary oversized resolution
- browser-friendly compressed output; **prefer WebP** where the processing
  path can safely produce and the bucket accepts it, **JPEG fallback**
  otherwise
- preserve enough screenshot / text readability
- aim roughly **200–500 KB** for normal images where achievable
- **do not rely only on a target byte size** if hitting it destroys
  readability — clamp quality to a floor and accept a larger file rather than
  shipping an unreadable Strava screenshot

### Profile-image targets

- ≈ **256–512 px square** source / output
- aggressive compression, roughly **50–150 KB** typical
- avatar display does not need camera-resolution originals

### HEIC / HEIF

Handle iPhone-origin images sensibly. Convert to browser-friendly output where
the chosen client processing implementation supports it. If conversion is not
safely possible, **fail gracefully with a clear message** rather than
uploading an unusable object. (This tightens the current behaviour, which
already refuses undecodable images via `probeImage` but does not transcode.)

### Server security

Existing and new Storage **server-side MIME and size limits remain
mandatory**. Client compression is a cost / UX optimization, **not a security
boundary**. Do not weaken the current `chat-media` or `proofs`
(training-proof) storage policies, MIME allow-lists, or size limits. The
`chat-media` bucket may **add** `image/webp` if it does not already permit it
(it does — the current allow-list is jpeg/png/webp/heic/heif); if a target
format is not in the bucket allow-list the processor must not emit it.

---

## 6. PR B — profile images

Each participant may have **one** profile image / avatar. The avatar belongs
to the **user profile**, not to a challenge instance — e.g. Tomas keeps the
same avatar across challenges unless he changes it.

### Storage

A **private** Supabase Storage bucket, e.g. `profile-media`. No public URLs.

Suggested path shape: `{user_id}/{uuid}.{ext}` (no challenge segment — the
object is per-user).

### Authorization

An avatar object may be read by:

- the user themselves
- an admin
- an authenticated user who **shares an authorized challenge context** with
  that person (the existing `shares_challenge_with(target_user_id)` predicate,
  or an equivalent SECURITY DEFINER one-boolean helper)

The storage read policy must **not** leak profile media to unrelated
authenticated users. As with `_chat_attachment_readable`, an inline subquery
against a table that is itself RLS-scoped is the footgun — use a SECURITY
DEFINER `search_path=''` boolean helper.

### Profile table

`profiles` stores only the **avatar reference / path** and required safe
metadata (mime type, size, updated-at). No public URL column.

### UI

Profile page gets **"Ändra profilbild"** supporting: upload / change, remove,
preview, and a **square crop or square-preparation** step before upload.

### Chat UI

Show a small round avatar next to each participant message. If the avatar is
unavailable, fall back to the **current initials** treatment (e.g. `AC`, `TT`,
`FM`). **Failure to load an avatar must never break chat rendering** — the
signed-URL fetch and `<img>` errors are isolated per message, and a missing /
denied / broken avatar renders the initials fallback.

Do **not** expose raw private avatar paths through unsafe Realtime payloads
(see §16). The chat read model resolves the avatar reference the same way it
resolves the sender display name.

---

## 7. Stable user handles

Introduce a **stable participant handle** for mentions (e.g. `TT`, `AC`,
`FM`).

### Rules

- **2–16 characters**
- letters, numbers, underscore
- **case-insensitive uniqueness**
- a **canonical stored representation** (e.g. a lower-cased `handle_ci`
  generated column, or store the canonical form and a display form) makes
  uniqueness deterministic — the unique index is on the canonical column

`display_name` and `handle` are **distinct concepts**. A user may change
`display_name` without breaking old mentions (mentions store a `user_id`
relation, not the handle text — see §10).

### Backfill / collisions — the plan MUST address this explicitly

- Existing users need a safe migration / backfill strategy.
- **Do not blindly derive handles if collisions are possible.** Deriving from
  initials or `display_name` will collide (two "AC"s). The implementation plan
  must define: the derivation attempt, the collision-resolution rule (e.g.
  append a digit, or leave `handle` NULL and force the user to pick one on
  next visit), and whether `handle` is nullable during the transition.
- A NULL `handle` is permitted until the user sets one; a user with a NULL
  handle simply cannot be `@`-mentioned yet (their name still autocompletes
  but selecting them is disabled with a hint).

> **Sequencing note.** The handle column + backfill is small and is a
> dependency of PR C's mentions. It may land in **PR B** (alongside the
> profile work, since both touch `profiles` and the profile page gets a
> "handle" field next to "profilbild") or at the very start of **PR C**. The
> implementation plan picks one; it must not be split across both.

---

## 8. PR C — message replies

`chat_messages` gains a **nullable** reply relationship, conceptually
`reply_to_message_id uuid references chat_messages(id)`.

- The referenced message **must belong to the same challenge** — server-side
  validation in `post_chat_message` (reuse the existing
  `(id, challenge_id)` composite-unique / membership pattern; a plain FK is
  not enough because it does not constrain the challenge).
- A reply is otherwise a **normal chat message** (same `seq`, same rate limit,
  same moderation).

### Composer UX

The user can **swipe right on a message** OR tap a small **"Svara"** action.
The composer then shows:

```
Svarar AC:
"<preview>"
```

The user can **cancel** the reply before sending.

### Rendered reply

Show a **compact quoted / reply preview** above the new message. Tapping the
preview **jumps / scrolls to the original message and briefly highlights it**.
If the original is not currently loaded, the client must be able to **fetch
the necessary history** (page backwards to that `seq`) safely before jumping.

### Moderation privacy — MANDATORY

If the original message is (or becomes) **hidden**, ordinary members must
**never** receive its old content through a reply preview. The preview shows
exactly:

```
[Borttaget av administratör]
```

No hidden original **body, attachment, attachment path, or hidden reason** may
leak through reply data. The reply preview is resolved **server-side through
the authorized chat read model** (an extension of `list_chat_messages`, or a
companion RPC), never by the client joining to a raw `chat_messages` row.
Admins may retain intended moderation visibility.

---

## 9. PR C — likes

A **simple** like system. **Do not** build a generic emoji-reaction platform.
One user may like a message **once**.

### Table — `chat_message_likes`

At least: `message_id`, `challenge_id`, `user_id`, `created_at`. Unique
`(message_id, user_id)`.

### Server-side rules (RPC only, consistent with the existing chat
architecture)

- caller must be an **active authorized challenge member**
- the message must **belong to the same challenge**
- a **hidden** message cannot **newly** receive likes (existing likes on a
  message that is later hidden are retained but not shown to ordinary members
  — see §17)
- a user cannot spoof another `user_id` (it is always `auth.uid()`, never a
  parameter)
- like / unlike is **idempotent** (liking twice is a no-op; unliking a
  not-liked message is a no-op)

### UI

Small heart / like affordance, e.g. `♥ 3`. Tap = like / unlike. Tapping the
count **may** open a small sheet listing who liked the message (that list is
gated by the same challenge-member authorization and excludes nothing about a
hidden message because it is only names).

Likes **do not** change chat unread state. Likes **must not** spam push
notifications (see §11 / §13).

---

## 10. PR C — @mentions

Typing `@` opens participant autocomplete; typing `@T` filters. A suggestion
row includes: avatar or initials, `display_name`, `handle`. Selecting a user
inserts their handle, e.g. `@TT`.

Mention rendering is **subtly highlighted**. If the **current logged-in user**
is mentioned, the message may receive slightly stronger visual emphasis.

### Mentions are a real relation, not text parsing

Store a **mention relation** to the target `user_id`.

### Table — `chat_message_mentions`

`message_id`, `challenge_id`, `mentioned_user_id`, `created_at`.

The message **text remains what humans see**; the relation is what
notifications and security rely on.

### Server validation (in `post_chat_message` / its mention step)

- the **mentioned user must belong to the same challenge**
- the caller **cannot create arbitrary mention rows** — the server resolves
  the `@handle` tokens in the submitted body against the active challenge's
  members and writes only the rows it resolved
- **duplicate** mention relations for the same `(message_id, mentioned_user_id)`
  collapse (unique constraint) or are rejected safely
- if `@TT` is typed but **does not resolve** to a valid handle of a member of
  the active challenge, it stays **ordinary text** and creates **no mention
  row and no notification**

---

## 11. PR C — in-app notifications

Create a **reusable notification event layer BEFORE Web Push** (PR D consumes
it — see §15).

### Notification types (initial)

`chat_mention`, `chat_reply`, `chat_like`.

Future-compatible type: `game_master` — **but do not integrate Game Master
during these PRs.** The enum / check simply reserves the value.

### Notification record — safe references only

- recipient user
- actor user
- challenge
- notification type
- relevant message id
- `created_at`
- read / unread state (**user-specific**)

**Do not duplicate hidden chat body / content into notification records.**
That prevents stale private copies surviving moderation. Notification
rendering **resolves safe preview / content through the current authorized
chat read model** at display time. If the source message is hidden, the
notification must not reveal the former body / image — it renders a generic
line (e.g. "Tomas nämnde dig") and, on open, the chat surface shows
`[Borttaget av administratör]`.

### In-app generation defaults

| Event | In-app notification |
| ----- | ------------------- |
| mention | create |
| reply to your message | create |
| like | create (in-app only) |

Likes **do not** create push by default (see §13).

### UI

`AppShell` gets a subtle notification / badge affordance. Tapping a
notification navigates to Shared Chat and jumps to the relevant message **if
still accessible**. Read state is per-user.

---

## 12. PR D — Web Push / PWA

Hälsoutmaningen remains a **web application**. Use standards-based PWA / Web
Push — **not** a native App Store app.

Required pieces:

- service worker
- push subscription lifecycle
- **per-device** push subscriptions (one user, many devices)
- server-side push delivery
- VAPID configuration
- user notification preferences
- safe cleanup of invalid / expired subscriptions (a `410 Gone` /
  `404` from the push service removes that subscription row)

### Table — `push_subscriptions` (private)

Owned by user / device. Stores the endpoint and key material (`p256dh`,
`auth`), a device label, `created_at`, `last_used_at`.

- Subscription endpoint / key material **must not be exposed to other
  participants**, and must not appear in generated DB types consumed by the
  client (the table is not selectable by `authenticated` beyond the owner's
  own rows; ideally reads/writes go through RPCs and the client never
  `select`s the table).
- Only **authorized backend delivery code** (service role / a SECURITY
  DEFINER delivery function / an Edge Function) may read it for sending.

### VAPID keys

- **Private key: server secret only.** NEVER frontend, NEVER git, NEVER in
  generated database types or client payloads.
- **Public key** may be delivered to the client as Web Push requires (an env
  var / a tiny public config endpoint / a build-time `VITE_` value is
  acceptable **only for the public key**).

---

## 13. Push defaults

| Event | Push default |
| ----- | ------------ |
| `@mention` | **PUSH ON** |
| reply to your message | **PUSH ON** |
| like | **NO PUSH** — in-app only |
| all new chat messages | **PUSH OFF** by default; user may opt in |

Profile notification settings include at least:

- master notification / push switch
- mentions
- replies
- all chat messages

Do **not** expose a meaningless toggle when push is unsupported on the current
device / browser — instead explain what is required (see §14).

---

## 14. iPhone / PWA UX

For iPhone / iOS users, provide contextual guidance when needed.

If the site is running in **Safari** (not the installed Home Screen web app)
and the environment requires Home Screen installation for the desired push
flow, show a **low-key, dismissible** message similar to:

> "Lägg till Hälsoutmaningen på hemskärmen för att få pushnotiser."

Do **not** nag on every visit (respect a dismiss for a sensible period). After
installation, allow the user to **explicitly activate** notifications. Browser
permission requests must follow normal **user-gesture** requirements —
**never** aggressively request notification permission on first page load.

---

## 15. Notification event design

Design the notification layer so **push delivery consumes notification
events** rather than separately re-parsing chat messages:

```
message transaction
  → validated mention / reply (PR C, server-side, one transaction)
  → notification event / record (PR C)
  → in-app notification (PR C)

later:
notification event that is push-eligible
  → push delivery worker / server logic (PR D)
```

This prevents PR D from rebuilding business rules already implemented in PR C.

### Idempotency (the plan must define this)

- **Notification creation** is idempotent per `(recipient, type, message_id,
  actor)` — a unique constraint or an `on conflict do nothing`, so a retried
  or racing `post_chat_message` / trigger does not double-insert.
- **Push delivery** marks each notification event with a delivery attempt /
  status, so a retry or a Realtime-race re-trigger does not send the same
  push twice to the same subscription. A `(notification_id,
  subscription_id)` delivery ledger with a unique key is the reference
  pattern.
- Under Realtime / retry races: the "did I already notify / send" check is a
  **database uniqueness fact**, never an in-memory guess.

---

## 16. Realtime

The current approved architecture uses `chat_activity` as a **safe signal**
rather than publishing sensitive chat message tables directly.

**New social tables must NOT automatically be added to the
`supabase_realtime` publication.** In particular, do **not** Realtime-publish
raw:

- `chat_message_mentions`
- `chat_message_likes`
- `chat_message_reply` data (there is no separate table — replies are a
  column on `chat_messages`, which is already not published)
- `push_subscriptions`
- avatar paths / private media metadata
- notification records / secrets
- chat attachment paths

If live notification badges or live like counts require signalling, design a
**minimal safe signal** consistent with `chat_activity` (e.g. a
`notification_activity` row carrying only `(user_id, at)` or a bump to the
existing `chat_activity` on a like, with membership-scoped RLS), never the raw
private rows. Each new PR's rollout verification explicitly checks the
publication membership (§21).

---

## 17. Privacy / moderation invariants

**Mandatory rule: NO new feature may become a side channel around chat
moderation.**

After a message is hidden, ordinary-participant APIs must not reveal its old
content via:

- reply preview
- mention notification
- like notification
- push payload
- avatar / media helper
- Realtime
- notification history

Concretely:

- reply preview of a hidden message → `[Borttaget av administratör]`, no
  body / attachment / path
- a mention / reply notification whose source message is hidden → resolves to
  a generic line via the authorized read model; opening it shows the
  placeholder
- a hidden message's attachment paths never reach a non-admin through any
  social surface (the existing `_chat_attachment_readable` gate + read-model
  `'[]'` behaviour extends to reply previews and notification content
  resolution)
- likes on a hidden message are not shown to ordinary members; the "who
  liked" sheet for a hidden message is admin-only (or simply unavailable to
  members)

### Push payloads are deliberately minimal

Prefer:

> "Tomas nämnde dig i Hälsoutmaningen"

rather than copying a potentially sensitive full message body into an external
push delivery payload. The app fetches the authorized message **after**
opening. A push payload carries at most: type, actor display name, challenge
name, and an opaque id to route to.

---

## 18. Media privacy

Profile images, chat media and training-proof images remain **private**. No
public-bucket conversion. Signed URLs remain short-lived where appropriate. Do
**not** create a generic media endpoint that accidentally broadens
authorization. Client-side compression occurs before the private upload but
does **not** replace server authorization.

---

## 19. UI principles

Keep the existing mobile-first visual language. **Do not redesign the
application.** Chat should feel more social but still focused.

- Avatar: small, round, unobtrusive
- Reply: compact
- Like: small
- Mention: subtle highlight
- Notification badge: clear but not noisy

No custom fonts, no custom message colors, no clipart, no sticker packs, no
giant emoji-reaction bars, no Discord-style feature overload.

---

## 20. Testing requirements

Every PR requires regression tests. Full existing project test gates remain
mandatory (`npm run test`, `typecheck`, `lint`, `format:check`, `build`, and
the Database Tests pgTAP CI).

### PR A — at least

- initial open scrolls to newest **after render** (incl. after a media
  element in the first page loads and changes list height)
- older-message pagination preserves position
- incoming near-bottom follows
- incoming while reading history does not yank + shows the affordance
- clicking "Nya meddelanden" jumps to newest
- image compression: dimension clamp (long side ≈ 1600 / avatar ≈ 256–512),
  aspect ratio preserved, output size behaviour, quality floor when a size
  target would destroy readability
- HEIC handled or fails gracefully
- error handling (undecodable / oversized → clear message, no upload)
- **existing one / two-proof upload behaviour still passes** (PR #6
  regression)

### PR B

- avatar read permissions: owner / admin / challenge-sharing user allowed;
  unrelated authenticated user denied
- cross-challenge privacy
- own upload / remove / replace
- admin behaviour
- fallback initials render when avatar missing / denied / broken
- private bucket, no public access
- avatar path not exposed via Realtime
- handle: 2–16 charset rule, case-insensitive uniqueness, backfill / collision
  behaviour, NULL-handle user cannot be mentioned

### PR C

- reply same-challenge enforcement (server-side)
- hidden-original privacy through the reply preview
- jump / load-history behaviour where testable
- like / unlike idempotency
- no likes on hidden messages
- mention handle resolution (valid → mention row + notification)
- invalid handle → plain text, no row, no notification
- mention membership enforcement (cannot mention a non-member)
- caller cannot insert arbitrary mention / like rows directly
- notification generation for mention / reply / like
- notification read state is per-user
- hidden-source privacy through notifications
- **no unintended core mutations** (challenge results / streak / debt /
  KASSAN / Straffbanken byte-identical before/after every new RPC — the
  Game Master / weight isolation-proof pattern)
- Realtime publication membership unchanged (or only the minimal safe signal
  added)

### PR D

- subscription register / remove
- ownership (a user only manages their own subscriptions)
- multiple devices per user
- invalid subscription cleanup on `404` / `410`
- notification preferences respected
- mention / reply push eligibility; likes → no push
- all-chat push is opt-in only
- **no private VAPID material client-side** (grep the built bundle + the
  generated types)
- minimal safe payload (no message body)
- no duplicate send under retry where practical (delivery ledger)

---

## 21. Database rollout rules

For every PR with migrations:

**Before push:** `npx supabase db push --linked --dry-run` — the dry-run MUST
contain **exactly** the intended migrations. If an unexpected migration
appears, **STOP**.

**After apply:** inspect (read-only, via the established linked inspection
method) — live schema, RLS, grants, functions, storage policies, the
`supabase_realtime` publication membership — then `npm run db:types`, inspect
the generated diff (no destructive removals; no private key / endpoint
material), and run full gates.

**No synthetic production participant data** merely for testing.

---

## 22. Cloudflare build requirements

Current production release branch: **`production`**. `main` is **not**
production. Feature / main builds may create non-production Versions but must
**not** promote traffic. Only advancing the `production` branch releases live.

**Deployment prerequisite discovered during PR #6:** Vite requires build-time
Cloudflare variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and, for
PR D, the **public** VAPID key). These must remain configured for Cloudflare
Workers Builds. A production deployment must **verify the built bundle is not
missing required Vite configuration** before declaring the release healthy
(e.g. the served bundle references the real Supabase project origin, and the
app does not render the env-validation error screen).

---

## 23. Known follow-up media hygiene

- **Accepted minor issue:** an already-issued short-lived `chat-media` signed
  URL may keep working until expiry after moderation. **Do not expand that
  window.** (A shorter TTL is a reasonable, optional tightening.)
- **Accepted minor issue:** orphaned `chat-media` uploads may accumulate if
  the upload succeeds but message creation does not. Image compression reduces
  cost substantially but does **not** solve orphan cleanup. A future orphan
  GC / sweep (e.g. a `pg_cron` job deleting `chat-media` / `profile-media`
  objects with no backing row and `created_at < now() - 24h`) remains valid
  maintenance work. It is **not** required to block PR A unless the
  implementation naturally touches that area.

---

## 24. Non-goals (explicitly deferred)

- custom fonts
- custom text colors
- clipart / stickers
- multiple emoji reaction types
- public profile pages
- native iOS / Android app
- Game Master push integration
- media proxy
- redesign of the challenge UI

---

## 25. Success criteria

After all four PRs:

- chat opens at newest reliably
- images consume substantially less Storage
- users can choose profile images; initials remain a reliable fallback
- users can reply safely
- users can like messages
- users can `@mention` challenge members using stable handles
- mentions / replies create in-app notifications
- likes create in-app notifications **without push spam**
- eligible users can activate real Web Push; mention / reply push works;
  all-chat push remains opt-in
- **hidden messages remain hidden through every new social surface**
- **no social feature affects challenge core calculations**
- deployment continues through the controlled `production` branch model

---

## Appendix — spec self-review (2026-09-06)

Reviewed the above for: contradictions, missing privacy / moderation
constraints, profile-vs-challenge data ambiguity, notification idempotency
gaps, Realtime leakage, Storage leakage, Game Master scope creep, core
challenge coupling, missing deployment / build-variable warning, and
rollback / release-safety assumptions. Corrections folded in (none change the
approved design — they resolve ambiguity):

1. **§4** — made the "not too early" requirement concrete: the initial pin
   must be re-asserted after media in the first page loads and grows the list,
   otherwise the same first-open bug recurs with avatars/images present.
2. **§7** — added the explicit sequencing decision point (handle groundwork
   lands in PR B *or* the start of PR C, not split) and permitted a NULL
   `handle` during the transition, with the "cannot be mentioned yet"
   behaviour spelled out.
3. **§8 / §17** — stated that a plain FK does not constrain the reply target
   to the same challenge; server-side validation (and the `(id, challenge_id)`
   pattern) is required. Reply preview resolution is server-side through the
   authorized read model, never a client join.
4. **§9 / §17** — clarified that likes made before a message is hidden are
   retained but not shown to ordinary members, and the "who liked" sheet for a
   hidden message is admin-only / unavailable to members.
5. **§10** — clarified that the server resolves `@handle` tokens from the
   submitted body against the active challenge's members and writes only
   resolved rows, closing "caller creates arbitrary mention rows".
6. **§11 / §17** — made explicit that notification records store only safe
   references and resolve content at display time through the authorized read
   model, so a later hide leaves no stale copy.
7. **§12 / §16** — `push_subscriptions` endpoint/key material must not appear
   in client-consumed generated types; reads/writes go through RPCs / service
   role only.
8. **§15** — added the two-level idempotency requirement (notification
   creation uniqueness + a push delivery ledger) as an explicit
   plan deliverable.
9. **§16** — enumerated `chat_message_likes` and the (non-existent) reply
   table alongside the other must-not-publish tables, and required each PR's
   rollout to check publication membership.
10. **§22** — carried the PR #6 build-variable lesson forward and added the
    "verify the built bundle is not missing Vite config" release-health check,
    plus the public VAPID key for PR D.
11. **§2** — restated as "no new FK from a core/weight/Straffbanken/GM table
    to a social table, and no social table on a completion/reconcile path" so
    the isolation rule is checkable, not just aspirational.

No Game Master implementation, no migrations, no code, no Supabase / Cloudflare
action is part of this document.
