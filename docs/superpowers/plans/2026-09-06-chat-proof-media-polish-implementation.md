# Chat + proof media polish — implementation plan

Branch: `feat/chat-proof-media-polish` (from `main` @ `010f53e`).
Design: `docs/superpowers/specs/2026-09-06-chat-proof-media-polish-design.md`.

Per task: failing test → prove failure → minimum impl → focused tests →
regression → inspect diff → commit. No local Supabase/pgTAP — pgTAP suites are
authored + self-reviewed, CI verifies. **Stop before first push.**

Migration / test numbers (reserved, no collision with 0022–0025 weight):

| file | purpose |
| ---- | ------- |
| `20260906120000_training_proof_two_images.sql` | B2 schema |
| `20260906120100_chat_attachments_schema.sql` | B3 schema + RLS + storage + `_chat_attachment_readable` |
| `20260906120200_chat_attachments_rpcs.sql` | B3 `post_chat_message` replace + `list_chat_messages` extend |
| `supabase/tests/0026_training_proof_two_images.test.sql` | B2 |
| `supabase/tests/0027_chat_attachments.test.sql` | B3 |

---

## Task 1 — B4 weight copy (smallest, no risk)

- **Test:** `WeightRankingList.test.tsx` — empty `rows` renders the new title
  "Ingen är kvalificerad för rankingen ännu." + the lock/entry explanation.
- **Impl:** swap the two strings in `WeightRankingList.tsx`.
- Regression: `WeightRankingPage` smoke, full weight Vitest.
- Commit: `feat(weight): clearer 'not qualified yet' ranking empty state`.

## Task 2 — B1 chat scroll helpers (pure)

- **Test:** `chat.test.ts` — `isNearBottom`, `scrollAnchorAdjustment`,
  `shouldFollowNewMessage`.
- **Impl:** add the three helpers to `chat.ts`.
- Commit: `feat(chat): scroll-position helpers for anchored chat`.

## Task 3 — B1 ChatPanel behaviour

- **Test:** `ChatPanel.test.tsx` — stub a scroll container (mock
  `scrollHeight` / `scrollTop` / `clientHeight`):
  - first load pins to bottom;
  - `fetchNextPage` preserves anchor (scrollTop adjusted by height delta);
  - new message while near bottom → follows;
  - new message while scrolled up → no viewport move + "Nya meddelanden"
    button appears; clicking it jumps to bottom;
  - read cursor advances only on first-open / near-bottom / jump.
- **Impl:** scroll container ref + `useLayoutEffect` anchor restore +
  `isNearBottom` scroll listener + `hasUnseenBelow` state + the pill.
  Keep `mark_chat_read` gated on "newest visible".
- Regression: full chat Vitest, `pages.smoke`.
- Commit: `feat(chat): open at latest message, keep position on paginate`.

## Task 4 — B2 proof schema + pgTAP

- **Test:** `0026_training_proof_two_images.test.sql` (design B2 list).
- **Impl:** `20260906120000_training_proof_two_images.sql`.
- Commit: `feat(proof): allow a second optional training-proof image (schema)`.

## Task 5 — B2 submit-training + entries-api

- **Test:** `submit-training.test.ts` — `proofFiles: []` (none) / `[a]` /
  `[a,b]` accepted; `[a,b,c]` rejected pre-upload; replace path keeps position
  1 non-empty. `entries-api` returns `proofPaths` ordered.
- **Impl:** `attachProofs`, `SubmitTrainingInput.proofFiles`, `EntryDetail
  .proofPaths`, `fetchEntryDetail`.
- Commit: `feat(proof): two-image write + read paths`.

## Task 6 — B2 UI

- **Test:** `SessionForm.test.tsx` / `MultiSessionLog.test.tsx` — slot 2 shown
  only after slot 1 filled; submit with slot 1 only works; both removable.
  `EntryDetailSheet.test.tsx` — 1 path → 1 image, 2 paths → 2 images, 0 → none.
- **Impl:** two `ProofImagePicker` slots + labels; render loop for paths.
- Regression: full Vitest, `pages.smoke`, build.
- Commit: `feat(proof): two labelled proof slots in the log form`.

## Task 7 — B3 chat attachments schema + storage + pgTAP

- **Test:** `0027_chat_attachments.test.sql` items 1,5,6,7,8,9,11,12 first
  (schema/RLS/constraints/storage-helper).
- **Impl:** `20260906120100_chat_attachments_schema.sql` — `chat_messages`
  uniq + body-nullable; `chat_message_attachments`; RLS; `chat-media` bucket +
  policies; `_chat_attachment_readable`.
- Commit: `feat(chat): chat_message_attachments schema, RLS and storage`.

## Task 8 — B3 RPCs (write + read model)

- **Test:** `0027_…` items 2,3,4,10,13 — `post_chat_message` atomic write with
  attachments, `list_chat_messages.attachments` gating, anon EXECUTE denial,
  body-privacy regression.
- **Impl:** `20260906120200_chat_attachments_rpcs.sql` — drop+recreate
  `post_chat_message`; extend `list_chat_messages` with `attachments jsonb`.
- Commit: `feat(chat): atomic message+attachments write, gated read model`.

## Task 9 — B3 chat-api + useChat

- **Test:** `chat-api.test.ts` — `postChatMessage` sends `p_attachments`;
  `mapChatRow` maps `attachments`; a hidden message maps to `attachments: []`.
  `useChat.test.tsx` — new message-with-images invalidates the list key.
- **Impl:** `ChatMessage.attachments: { position; path }[]`; `postChatMessage(
  challengeId, body, attachments)`; upload helper
  `uploadChatImages(challengeId, userId, messageId, files)` +
  `chatImageSignedUrl(path)`; failed-send cleanup.
- Commit: `feat(chat): chat-image upload + signed-URL client boundary`.

## Task 10 — B3 composer + bubble grid + lightbox

- **Test:** `ChatComposer` / `ChatBubble` / `ChatLightbox` tests — pick up to
  4, reject 5th, remove one, send disabled while pending; 1/2/3–4 layout
  classes; lightbox opens on thumb click, closes on Esc, navigates.
- **Impl:** `ChatImagePicker` (or extend the composer), `ChatImageGrid`,
  `ChatLightbox`; wire into `ChatPanel`.
- Regression: full Vitest, `pages.smoke`, build.
- Commit: `feat(chat): image composer, thumbnail grid and lightbox`.

## Task 11 — docs + full gates

- `docs/CHAT.md` — chat images + moderation + storage model.
- `docs/DATABASE.md` — the two new tables / bucket.
- `npm run test` · `typecheck` · `lint` · `format:check` · `build`.
- pgTAP: author + self-review, note CI still required.
- Commit: `docs: chat images + two-proof-image model`.

**Stop. Do not push.** Report per the task's Final Report section.
