# Chat + proof media polish — design

**Status:** approved by the user 2026-09-06. Scope is fixed; only real
code/security contradictions reopen a decision.

Four independent changes on `feat/chat-proof-media-polish`, plus small polish.
Nothing here touches training completion, streaks, debt/KASSAN, Straffbanken,
efterregistrering, weight competition math/privacy, or Game Master. No sixth
`BottomNav` item. No redesign.

Deployment control (Part A) is handled separately on
`chore/manual-production-deploy` — see `docs/DEPLOYMENT.md` §1.6.

---

## B1 — Chat opens at the latest message

**Bug:** `ChatPanel` renders the message list with no scroll management, so it
opens scrolled to the top (oldest loaded message) and the user must scroll down.

**Behaviour (frontend only — `ChatPanel.tsx`, `useChat.ts`, `chat.ts`):**

- **First open:** once the first page has loaded, the viewport is pinned to the
  **newest** message (`scrollTop = scrollHeight`), no animation. Older history
  is above; the user scrolls **up** to read it.
- **Upward pagination** ("Ladda äldre meddelanden" / reaching the top): capture
  `scrollHeight` before the fetch; after the older page renders, restore visual
  position with `scrollTop += scrollHeight_after − scrollHeight_before` in a
  `useLayoutEffect` so the viewport never jumps.
- **Incoming message while near the bottom** (within `NEAR_BOTTOM_PX = 96`):
  follow it — scroll to the new newest message.
- **Incoming message while reading history** (not near bottom): do **not**
  move the viewport. Show a discreet **"Nya meddelanden"** button pinned to the
  bottom of the list; tapping it jumps to the latest and dismisses itself.
- **Read state:** the read cursor advances (via `mark_chat_read`) only when the
  newest message is actually on screen — i.e. on first open, when near the
  bottom, and right after a "Nya meddelanden" jump. Reading old history does
  not mark newer messages read. `seq` stays the only cursor; ordering semantics
  unchanged.
- Animation is minimal: instant jump for first-open and the "Nya meddelanden"
  jump; a short `scrollIntoView({ behavior: 'smooth' })` only for the
  near-bottom follow.

**Testable seam:** pure helpers in `chat.ts` —
`isNearBottom(el, px)`, `scrollAnchorAdjustment(prevHeight, nextHeight)`,
`shouldFollowNewMessage(isNearBottom)` — plus a `ChatPanel` test that drives
scroll metrics through a stubbed container.

---

## B2 — Up to two training-proof images

`training_proofs` today: exactly one row per `training_entry_id`
(`training_proofs_one_per_entry unique (training_entry_id)`). Each **session**
(`training_entries` row, keyed by `session_seq`) has its own proof — that is
unchanged. The change is **1 → 2 images per session**.

- **Image 1 = required** (when `proof_required`), **image 2 = optional**.
- Historical single-proof rows stay valid and display unchanged.

### Schema (`20260906120000_training_proof_two_images.sql`, additive)

```sql
alter table public.training_proofs
  add column position smallint not null default 1
    constraint training_proofs_position_valid check (position in (1, 2));

alter table public.training_proofs
  drop constraint training_proofs_one_per_entry;

alter table public.training_proofs
  add constraint training_proofs_one_per_slot unique (training_entry_id, position);
```

- `default 1` backfills every existing row → they become "image 1". The
  `default` stays (a plain insert without `position` is still image 1).
- `unique (training_entry_id, position)` + `check (position in (1,2))` ⇒ at most
  two proofs per entry, deterministic order. A third is structurally impossible.
- `storage_path` stays globally `unique`. Storage layout, bucket, and every
  `storage.objects` policy are unchanged — the path already carries
  `{challenge_id}/{user_id}/…` and the RLS keys on that, not on a count.
- `training_proofs` table RLS unchanged (owner/admin/member via denormalised
  `challenge_id` — same as today).

### Frontend

- `submit-training.ts`: `SubmitTrainingInput.proofFile?: File | null` →
  `proofFiles?: File[]` (0, 1 or 2). `attachProof` → `attachProofs`: for a
  retry-safe replace it deletes every `training_proofs` row for the entry and
  re-inserts positions `1..n`; the "upload new before deleting old DB row"
  ordering is kept for **position 1** so a session never briefly loses its
  required proof. `> 2` files is rejected client-side before any upload.
- `entries-api.ts`: `EntryDetail.proofPath: string | null` →
  `proofPaths: string[]` (ordered by `position`). `SelfEntry.hasProof` stays a
  boolean (`≥ 1`).
- `SessionForm.tsx` / `MultiSessionLog.tsx`: two labelled slots —
  **"Bevis 1 · Obligatoriskt"** and **"Bevis 2 · Valfritt"**. Slot 2 is shown
  disabled/greyed until slot 1 has a file, then becomes an active
  `ProofImagePicker`. Each slot supports the existing camera/gallery flow and
  remove/replace before submit.
- `EntryDetailSheet.tsx` / `LogPage.tsx`: render one `SignedProofImage` per
  path. One path → one image, no empty placeholder. Two paths → a simple
  two-up. Admin + social-verification views get both.

### pgTAP (`0026_training_proof_two_images.test.sql`)

one proof accepted · two proofs accepted · `position = 3` rejected ·
`(training_entry_id, position)` unique enforced · a pre-existing row with no
explicit position is `1` · owner-can-read / non-member-cannot for both slots ·
admin can read both.

---

## B3 — Chat images (≤ 4 per message)

The security-sensitive change. Mirrors the corrected chat body model: **all
reads and writes go through RPCs / a SECURITY DEFINER read model; the base
table SELECT is admin-only; a hidden message's images are inaccessible to
ordinary participants at the storage layer, not just in React.**

### Message shapes

- text only · 1–4 images only · text + 1–4 images.
- **Reject:** no text **and** no images · more than 4 images · body over 1000
  chars (unchanged).

`chat_messages.body` becomes **nullable** (image-only messages). The lower
bound moves into the RPC ("text or ≥ 1 image"); the `≤ 1000` check stays.

### Schema (`20260906120100_chat_attachments_schema.sql`, additive)

```sql
-- chat_messages gets a companion unique key so an attachment's challenge_id
-- is FK-guaranteed to match its message's, not just trusted.
alter table public.chat_messages
  add constraint chat_messages_id_challenge_uniq unique (id, challenge_id);

alter table public.chat_messages
  drop constraint chat_messages_body_len;
alter table public.chat_messages
  add constraint chat_messages_body_len
    check (body is null or char_length(body) between 1 and 1000);

create table public.chat_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  position     smallint not null
                 constraint chat_message_attachments_position_valid
                 check (position between 1 and 4),
  storage_path text not null unique
                 constraint chat_message_attachments_path_len
                 check (char_length(storage_path) between 1 and 400),
  mime_type    text not null
                 constraint chat_message_attachments_mime_valid
                 check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes   bigint not null
                 constraint chat_message_attachments_size_valid
                 check (size_bytes > 0 and size_bytes <= 15728640),
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  created_at   timestamptz not null default now(),

  constraint chat_message_attachments_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id) on delete cascade,
  constraint chat_message_attachments_one_per_slot unique (message_id, position)
);
```

- `check (position between 1 and 4)` + `unique (message_id, position)` ⇒ **max 4
  per message**, deterministic order. Belt-and-braces: the write RPC also
  rejects `> 4`.
- Composite FK `(message_id, challenge_id) → chat_messages (id, challenge_id)`
  ⇒ an attachment **cannot** be linked to a message in a different challenge.
- `on delete cascade` from `chat_messages` — a message row is never deleted in
  practice (only hidden), but keeps the model clean.

### RLS

```sql
alter table public.chat_message_attachments enable row level security;
revoke all on public.chat_message_attachments from anon, authenticated;
grant select on public.chat_message_attachments to authenticated;

-- Admin-only base read — exactly like chat_messages since 20260905140200.
-- Members read attachment info only through list_chat_messages (below).
create policy chat_message_attachments_select on public.chat_message_attachments
  for select to authenticated using (public.is_admin());

-- No INSERT / UPDATE / DELETE policy — post_chat_message is the only writer.
```

`chat_message_attachments` is **not** added to `supabase_realtime`.
`chat_activity` stays the only signal; nothing changes there.

### Storage — private bucket `chat-media`

```
chat-media/{challenge_id}/{user_id}/{message_id}/{position}-{uuid}.{ext}
```
Private bucket, same MIME allow-list and 15 MiB cap as `proofs`.

```sql
-- Upload: into your own folder, in a challenge you belong to. The RPC then
-- links only paths under {challenge}/{your uid}/{msg id}/.
create policy "chat-media: member uploads own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_challenge_member(public.try_cast_uuid((storage.foldername(name))[1]))
  );

-- Read: admin always; otherwise only when the object backs an attachment of an
-- ACTIVE message in a challenge the reader belongs to. A hidden message ⇒ the
-- join fails ⇒ no signed URL, even with a previously-obtained path.
create policy "chat-media: read active-message attachments" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-media'
    and (public.is_admin() or public._chat_attachment_readable(name))
  );

-- owner/admin update + delete (cleanup of a failed send), mirroring proofs.
```

`_chat_attachment_readable(p_path text) returns boolean` is **SECURITY
DEFINER**, `search_path=''`, one boolean — the same shape as `_weight_is_hidden`
/ `_chat_*`. An inline sub-select in the storage policy would be RLS-filtered by
the admin-only `chat_message_attachments` / `chat_messages` policies and could
never see the row it must check.

```sql
create function public._chat_attachment_readable(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
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
```

### Write path — atomic (`20260906120200_chat_attachments_rpcs.sql`)

`post_chat_message` is **replaced** (drop + recreate) with:

```
post_chat_message(
  p_challenge_id     uuid,
  p_body             text   default null,
  p_message_id       uuid   default null,   -- client-generated, so uploads can
  p_attachments      jsonb  default null    -- target {challenge}/{uid}/{id}/…
) returns public.chat_messages
```

`p_attachments` is `[{ "path": text, "mime_type": text, "size_bytes": int,
"width": int?, "height": int? }, …]`, 0–4 entries, order = display position.

The RPC, in one transaction:

1. auth + **active** membership (unchanged).
2. body: `null` or 1–1000 chars after `btrim`.
3. `jsonb_array_length(p_attachments) between 0 and 4`.
4. **at least one of** non-empty body / ≥ 1 attachment — else
   `'Meddelandet kan inte vara tomt'`.
5. rate limit (unchanged: 10 / rolling 30 s).
6. `v_id := coalesce(p_message_id, gen_random_uuid())`; every attachment `path`
   must start with `p_challenge_id || '/' || uid || '/' || v_id || '/'` — else
   `'Ogiltig bilagsökväg'` (stops linking someone else's upload or a
   cross-challenge object).
7. insert `chat_messages (id = v_id, …)`; insert one
   `chat_message_attachments` row per entry with `position` = array index + 1,
   `challenge_id = p_challenge_id`.
8. return the message row.

Backward compatible: the existing `chat-api.ts` call passes only
`{ p_challenge_id, p_body }` and still resolves (the new params default).

`mark_chat_read`, `hide_chat_message` unchanged. Hiding a message needs **no**
attachment-specific code — `status='hidden'` already breaks the read model and
`_chat_attachment_readable`.

### Read model — `list_chat_messages` extended

Add one column: `attachments jsonb` — for each row,
`[{ "position": int, "path": text }]` ordered by position, but **`'[]'` when
the message is hidden and the caller is not an admin** (same gate as `body`).
`unread_chat_count` unchanged (attachments never affect the count).

The client turns each `path` into a short-lived signed URL via
`supabase.storage.from('chat-media').createSignedUrl(path, 120)` only when a
bubble with images scrolls into view. Storage RLS (`_chat_attachment_readable`)
is the real gate; the read model withholding paths for hidden messages is the
first gate. Both are proven.

### Failed-send cleanup

Client uploads first, then calls the RPC. On RPC failure the client best-effort
`storage.remove()`s the just-uploaded objects. An object with no
`chat_message_attachments` row is unreferenced and unreadable (the storage read
policy needs the backing row); a rare residual orphan is acceptable and matches
the documented proof-upload behaviour. The typed text is **not** cleared on
failure.

### Chat image UI

- **Composer:** an image button opens the gallery/camera picker (reuse
  `probeImage` validation). Up to 4 thumbnails with a remove control each; a
  5th pick is rejected with a short message. "Skicka" is disabled while a send
  is in flight (no duplicate sends). Composer stays compact — the thumbnail
  strip sits above the textarea only when images are selected.
- **Bubbles:** 1 image → single contained thumbnail (max ~240 px tall);
  2 → two-column; 3–4 → 2×2 grid. Consistent `--radius-md`, `--sp-1` gaps. An
  image-only message renders no empty text line.
- **Lightbox:** tap a thumbnail → full-screen viewer, original aspect ratio,
  `Esc` / tap-outside / a close button to dismiss, arrow keys + on-screen
  chevrons to move between that message's images. No new dependency — a small
  in-repo component.
- Thumbnails: `object-fit: cover`; lightbox image: `object-fit: contain`.
  Per-image `loading`/`error` state so a broken image never breaks the bubble.
- Buttons carry `aria-label`s; the lightbox traps focus and closes on `Esc`.

### pgTAP (`0027_chat_attachments.test.sql`)

1. non-member cannot read `chat_message_attachments` (admin-only base policy) ·
2. non-member gets no attachments from `list_chat_messages` ·
3. co-member of an **active** message gets its attachment rows via
   `list_chat_messages` (paths present) ·
4. hidden message ⇒ `list_chat_messages.attachments = '[]'` for a member,
   full for an admin ·
5. `_chat_attachment_readable` is `false` for a member once the message is
   hidden, `true` while active, `false` for a non-member ·
6. `post_chat_message` with 5 attachments is rejected ·
7. `position` outside 1–4 rejected by the CHECK; `(message_id, position)`
   unique enforced ·
8. an attachment path not under `{challenge}/{uid}/{message_id}/` is rejected ·
9. composite FK: an attachment whose `challenge_id` ≠ its message's is rejected ·
10. anon cannot EXECUTE `post_chat_message` / `list_chat_messages` /
    `_chat_attachment_readable` ·
11. no direct INSERT/UPDATE/DELETE on `chat_message_attachments` by a member ·
12. `chat_message_attachments` is **not** in `supabase_realtime`; `chat_activity`
    still is, `chat_messages` still is not ·
13. existing chat-body privacy assertions still hold (regression:
    hidden body still withheld from members, retained for admins).

---

## B4 — Weight ranking waiting copy

`WeightRankingList` empty state, when the RPC returns zero rows:

- title: **"Ingen är kvalificerad för rankingen ännu."**
- body: **"Startvikten behöver vara låst i 24 timmar och minst en vanlig
  invägning behöver vara registrerad."**

No participant names, no private status, **no new aggregate/read model**. The
generic explanation only. (The optional "N deltagare väntar…" line is
explicitly not built — it would need a new privacy-sensitive count.)

Frontend-only: `WeightRankingList.tsx` + its test. No schema, no RPC change.

---

## Polish (folded into the tasks above)

Chat: anchored-to-latest open · "Nya meddelanden" while reading history · no
forced scroll · compact composer with image support. Proofs: clear
required/optional labels · deliberate two-image layout · clean single-image
history. Chat images: consistent grid spacing/radius · no empty text space for
image-only · send disabled while submitting · sane error/empty/loading.
Weight: copy only, no redesign.

---

## Isolation / non-goals

No change to: training completion / missed-day state, streaks, debt / KASSAN,
Straffbanken, efterregistrering, weight math or privacy, Game Master, chat
ordering (`seq` stays canonical). No new table joins `supabase_realtime`. No
sixth `BottomNav` item. Game Master integration is **not** started here.
