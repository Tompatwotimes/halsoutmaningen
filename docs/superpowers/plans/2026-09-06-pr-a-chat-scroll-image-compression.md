# PR A — Chat Scroll Fix & Image Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first PR of the approved social/chat expansion — and only that PR: (1) make Shared Chat reliably open at the newest message even when media/layout settles after the first paint, and (2) add one reusable client-side image-processing module that both the chat composer and the training-proof upload path use to resize + re-compress images before upload. No profile images, no replies/likes/mentions, no notifications, no Web Push, no Game Master, no core-challenge change.

**Architecture:** A new dependency-free `src/lib/media/image-processing.ts` module (decode → optional passthrough → resize → re-encode, with typed errors) is called from `src/features/chat/chat-media.ts` (chat) and `src/features/challenge/submit-training.ts` + `src/features/retroactive/retroactive-api.ts` (proof). The chat scroll fix replaces `ChatPanel`'s one-shot `didInitialScroll` latch with a "stick to bottom" latch plus a `ResizeObserver` re-pin, so async media/Sheet-layout growth cannot leave the viewport above the newest message; user scroll-up unsticks it. Existing storage buckets (`chat-media`, `proofs`) and every server-side MIME/size boundary already accept `image/webp` and `image/jpeg`, so **PR A needs no migration**.

**Tech Stack:** React 19 + TypeScript + Vite; `@tanstack/react-query` v5; Vitest + jsdom + `@testing-library/react` + `@testing-library/user-event`. Browser APIs used: `createImageBitmap` (with `imageOrientation: 'from-image'`), `OffscreenCanvas` when available else `<canvas>`, `canvas.toBlob` / `OffscreenCanvas.convertToBlob`, `ResizeObserver`. No new npm dependency.

**Spec:** docs/superpowers/specs/2026-09-06-social-chat-notifications-design.md (§4, §5, §17, §18, §20, §21, §22 + self-review appendix).

---

## Global Constraints

- **PR A subset only.** Do not touch profile images / avatars, `chat_message_mentions`, `chat_message_likes`, `chat_messages.reply_to_message_id`, notifications, `push_subscriptions`, service workers, VAPID, or Game Master. If a task's diff starts touching those, stop and re-scope.
- **No migrations, no `supabase db push`, no `db:types` regeneration, no Supabase/Cloudflare change, no production update, no deployment.** Verified fact (from the PR #6 rollout live inspection): `chat-media` bucket = `allowed_mime_types: [image/jpeg, image/png, image/webp, image/heic, image/heif]`, `file_size_limit: 15728640`; `proofs` bucket = identical; `chat_message_attachments_mime_valid`, `training_proofs_mime_valid`, and the `post_chat_message` in-RPC MIME check all accept `image/jpeg` **and** `image/webp`. The processor only ever emits `image/jpeg` or `image/webp` (never a converted `image/png`; a small PNG passes through unchanged, and `image/png` is already accepted). **Therefore no storage-policy or MIME-allow-list change is required.** If any future format decision changes this, that becomes a flagged migration item — not in PR A.
- **Core isolation.** No change to `challenge_day_states`, streak, debt/KASSAN, main ranking, Straffbanken, efterregistrering, weight, or Game Master. `submitTraining` keeps firing `requestGameMasterPulse` exactly as today (unawaited, swallowed, after full success). No new trigger, no new FK.
- **Moderation & media privacy unchanged.** No change to `chat_messages` RLS, `_chat_attachment_readable`, `list_chat_messages`, `hide_chat_message`, the `chat-media`/`proofs` storage policies, signed-URL TTL (`SIGNED_URL_TTL_SECONDS = 120` stays), or the `supabase_realtime` publication. No public bucket. Client compression is not a security boundary.
- **No `setTimeout`/`setInterval` scroll hacks.** Use `useLayoutEffect` + `ResizeObserver` + explicit latch state. No repeated permanent forced scrolling; a user who scrolled up to read history is never yanked down.
- **No redesign.** `ChatPanel`, `LogPage`, `SessionForm`, `MultiSessionLog`, `ProofSlots` keep their current structure and mobile-first CSS. New UI is only the "Förbereder bild…" label state.
- **TDD.** Every functional task: write the failing test, run it, verify the expected failure, write the minimal implementation, re-run the focused test, run the nearby regression tests, inspect the diff, commit.
- **Tests never hit real Supabase.** All Supabase and browser-media APIs are mocked (helpers in Task 6).
- **`seq` stays the canonical order/cursor key.** `mark_chat_read` advance rules are unchanged; the optional unread divider is presentational only.

### Baseline before PR A

- Vitest: **65 files / 471 tests** pass.
- Database Tests CI: **Files=27, Tests=669**, PASS (no DB change in PR A — this stays identical).
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` all pass.
- `main` = `a0599cbf023df21dd699dae84a31fa06a1d5fc17`; `production` = `78b9a87574205b8b4ab46428545e26725e4025f4`.

### Release model (do not run in this plan — for the eventual PR A rollout)

feature branch → PR → `main` → (no DB rollout for PR A) → full verification → advance `production` branch → Cloudflare production deploy. `main` is non-production; only advancing `production` releases live. The Cloudflare Workers Build must have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured; a production release must verify the served bundle references the real Supabase project origin and does not render the env-validation error screen (spec §22).

---

## Root-cause analysis — the first-open scroll bug

### Current implementation (`src/features/chat/ChatPanel.tsx`, post-PR #6)

- The scroll container is the `Sheet` body `<div ref={bodyRef} className={styles.body}>` (`src/components/ui/Sheet.tsx`), passed `bodyRef={scrollRef}`.
- `useLayoutEffect` (deps `[open, query.isLoading, messages, maxSeq, userId, advanceRead]`) has three branches:
  - **(a)** older page prepended → `el.scrollTop += scrollAnchorAdjustment(prev, next)`.
  - **(b)** `if (!didInitialScroll.current) { el.scrollTop = el.scrollHeight; didInitialScroll.current = true; … }` — **fires exactly once**, on the first render where `messages.length > 0`.
  - **(c)** `maxSeq > reactedMaxSeq.current` → follow / show "Nya meddelanden".
- A `scroll` listener keeps `nearBottomRef` fresh and auto-loads older history near the top.
- `useChatImageUrls` (`staleTime: 90_000`) resolves signed URLs lazily; `ChatImageGrid`'s `Thumb` renders a `<Skeleton>` while `url === undefined`, then swaps to `<img loading="lazy">`.

### Why first-ever open lands above newest, but reopen is fine

1. **Media height grows after the one-shot pin.** On a cold first open, `useChatImageUrls` is pending → `ChatImageGrid` renders fixed-size `<Skeleton>`s → the layout effect runs branch (b) and pins to a `scrollHeight` computed with skeletons. Signed URLs then resolve, `<img>` elements mount and load asynchronously, each image's natural height replaces the skeleton box and **`scrollHeight` grows after `didInitialScroll.current` is already `true`** → branch (b) never runs again → the viewport is left above the newest message by the accumulated growth. (Avatars in PR B would compound this — the spec explicitly calls this out in §4.)
2. **Sheet layout not fully settled at first paint.** `Sheet` renders via `createPortal` and defers focus to a `requestAnimationFrame`; the `.panel`/`.body` box (and therefore `el.clientHeight`/`el.scrollHeight`) can still be transitioning on the exact tick branch (b) runs on a cold open, so even a text-only room can pin slightly wrong.
3. **Reopen "works" because everything is warm.** On reopen, `useChatMessages` returns the cached pages **synchronously** (TanStack keeps data; `staleTime: 15_000`), `useChatImageUrls` returns cached signed URLs (`staleTime: 90_000`), and the browser has the image bytes in HTTP cache → `<img>` paints at natural size within the same frame → branch (b)'s single pin lands correctly. The bug is a **race between a one-shot pin and asynchronous layout growth**; caching hides it on the second open.

### Distinguishing the scenarios (spec Step 2 A–F)

| | Scenario | Current behaviour | Required behaviour |
| - | -------- | ----------------- | ------------------ |
| A | first-ever open, cold cache | pins once to a not-yet-settled height → ends above newest | pin, then **stay pinned to newest** through async media + Sheet settle, until the user scrolls |
| B | reopen with warm cache | pins correctly (race won) | unchanged — still correct |
| C | first page rendering | branch (b) fires on first non-empty render | keep the immediate pin as a fast path, **plus** a `ResizeObserver` re-pin while "stuck to bottom" |
| D | media/avatars change layout after first paint | no re-pin | `ResizeObserver` re-pins while stuck to bottom and the user has not scrolled |
| E | upward pagination | branch (a) anchors correctly | unchanged; `ResizeObserver` re-pin is disabled while not stuck (paginating ⇒ user scrolled up ⇒ not stuck) |
| F | realtime / new chat activity | branch (c): follow if near bottom, else "Nya meddelanden" | unchanged behaviour, keyed off the same latch |

### The fix (deterministic, no timers)

- Replace `didInitialScroll` (one-shot) with **`stickToBottomRef: MutableRefObject<boolean>`**, initialised `true` on every `[challengeId, open]` reset. Meaning: "the user has not deliberately scrolled away from the newest message — keep the viewport pinned to the bottom."
- **`useLayoutEffect` branch (b)** becomes: on the first render with content, do the immediate `el.scrollTop = el.scrollHeight` (fast path, no top-flash) and `advanceRead(maxSeq)` — but do **not** set a one-shot "done" flag; instead it's gated by `!hasPinnedOnceRef.current` for the `advanceRead` call only.
- **New `ResizeObserver`** on the **inner list element** (`styles.list` div — a new `listRef`). On every content-size change, `if (stickToBottomRef.current && !paginating) el.scrollTop = el.scrollHeight` (via a programmatic-scroll guard). This keeps the viewport pinned through skeleton→image swaps, the Sheet's open settle, and font/emoji reflow — and stops the instant the user scrolls up.
- **Programmatic-scroll guard:** `programmaticScrollRef: MutableRefObject<number | null>`. Every time the code sets `el.scrollTop`, first set `programmaticScrollRef.current = <the value>`; in the `scroll` listener, if `programmaticScrollRef.current !== null && Math.abs(el.scrollTop - programmaticScrollRef.current) <= 2` then it's the programmatic scroll → clear the ref, do nothing. Otherwise it's a **user scroll** → `stickToBottomRef.current = isNearBottom(el)` (scrolling up unsticks; scrolling back to the bottom re-sticks) and clear the ref.
- **Incoming message (C/D):** branch (c) checks `stickToBottomRef.current || isOwnMessage` → programmatic scroll to bottom + `advanceRead` + dismiss "Nya meddelanden"; else `setShowNewMessages(true)` and leave the viewport. Same as today, keyed off `stickToBottomRef` instead of `nearBottomRef`.
- **"Nya meddelanden" click (E in spec §4):** programmatic scroll to bottom, `stickToBottomRef.current = true`, `setShowNewMessages(false)`, `advanceRead(maxSeq)` — unchanged from `jumpToLatest` today except it also sets the latch.
- **Pagination (B):** branch (a) unchanged. The `ResizeObserver` re-pin is naturally excluded because paginating means the user scrolled to the top ⇒ `stickToBottomRef.current === false`. Add an explicit `pendingAnchorHeight.current !== null` guard in the RO callback as belt-and-braces.
- **Read/unread (F):** `advanceRead` / `markedSeq` unchanged — only called on the first pin, a near-bottom/own follow, and a jump.

### jsdom testability of the fix

jsdom has no `ResizeObserver` and reports `0` for all layout metrics. Task 3's tests use:
- the existing `mockScroller(el, metrics)` helper (gives one element mutable `scrollHeight`/`clientHeight`/`scrollTop` + a `grow(to)` and `fireScroll()`), and
- a new `src/test/resize-observer-mock.ts` — `installResizeObserverMock()` returns `{ trigger(): void, uninstall(): void }`; `trigger()` synchronously calls every registered observer callback. Installed in `beforeAll` of `ChatPanel.test.tsx`, uninstalled in `afterAll`.

---

## Image-processing decisions

### Module location & shape

- **New file:** `src/lib/media/image-processing.ts` — `src/lib/` is the existing cross-feature infra home (`supabase.ts`, `env.ts`); a module shared by `features/chat` and `features/challenge` must live here, not in either feature. It must not import from `src/features/**` (wrong dependency direction).
- **Reuse plan for PR B:** `ProcessImageOptions` has a `maxLongSidePx` argument; PR B calls the same `processImageForUpload` with `{ maxLongSidePx: 512, format: 'auto', quality: 0.8, qualityFloor: 0.6, targetBytes: 120 * 1024 }` plus a square-crop step done in the PR B UI *before* calling the processor. **PR A implements the module and the chat + proof integrations only** — no avatar code.

### Public interface (exact — later tasks import these verbatim)

```ts
// src/lib/media/image-processing.ts

/** Input MIME types the processor will attempt to decode. */
export const PROCESSABLE_INPUT_MIME: readonly string[];
// ['image/jpeg','image/png','image/webp','image/heic','image/heif']
// (a file with an empty `type` string is also attempted — some pickers omit it)

export interface ProcessImageOptions {
  /** Longest output edge in px. The image is never upscaled. */
  maxLongSidePx: number;
  /** 'auto' = WebP if the browser can encode it, else JPEG. Default 'auto'. */
  format?: 'auto' | 'jpeg' | 'webp';
  /** Initial encode quality, 0..1. Default 0.82. */
  quality?: number;
  /** Encode quality never drops below this chasing `targetBytes`. Default 0.6. */
  qualityFloor?: number;
  /** Soft byte target. If exceeded, ONE lower-quality re-encode is attempted. Default: undefined (no size chase). */
  targetBytes?: number;
  /**
   * If the decoded image already fits `maxLongSidePx` on both axes AND
   * `file.size <= passthroughMaxBytes` AND the input is a directly-uploadable
   * web type (jpeg/png/webp), the ORIGINAL file is returned unchanged
   * (`wasProcessed: false`). Default: undefined (always re-encode).
   */
  passthroughMaxBytes?: number;
}

export interface ProcessedImage {
  /** The File to upload — a new re-encoded File, or the original on passthrough. */
  file: File;
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
  sizeBytes: number;
  width: number;
  height: number;
  wasProcessed: boolean;
}

export type ImageProcessingErrorCode =
  | 'unsupported-type'
  | 'undecodable'
  | 'empty-file'
  | 'encode-failed';

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;
  /** Heuristic (name/type ends in heic/heif) — used only to tailor UI copy. */
  readonly likelyHeic: boolean;
  constructor(code: ImageProcessingErrorCode, message: string, likelyHeic?: boolean);
}

/** Process one file. Sequential internal steps; releases the decoded bitmap immediately after draw. */
export async function processImageForUpload(
  file: File,
  options: ProcessImageOptions,
): Promise<ProcessedImage>;

/**
 * Process files one at a time (bounded memory — never decodes several huge
 * photos at once). Rejects with the first `ImageProcessingError`, tagged with
 * the failing index via `error.message` context.
 */
export async function processImagesForUpload(
  files: File[],
  options: ProcessImageOptions,
): Promise<ProcessedImage[]>;
```

Named internal helpers (no anonymous helpers): `looksLikeHeicName(file)`, `decodeUpright(file)` (calls `createImageBitmap(file, { imageOrientation: 'from-image' })`), `computeTargetSize(w, h, maxLongSidePx)`, `getCanvas(w, h)` (returns `OffscreenCanvas` if `typeof OffscreenCanvas === 'function'`, else a detached `HTMLCanvasElement`), `drawBitmap(canvas, bitmap, w, h)`, `encodeCanvas(canvas, mime, quality)` (Promise<Blob>), `canEncodeWebp(canvas)` (memoised module-level probe: encode a 1×1 and check `blob.type === 'image/webp'`), `deriveProcessedFilename(originalName, ext)`.

### Algorithm (`processImageForUpload`)

1. **Validate.** `file.size === 0` → `ImageProcessingError('empty-file', 'Bilden är tom.')`. `file.type !== '' && !PROCESSABLE_INPUT_MIME.includes(file.type)` → `ImageProcessingError('unsupported-type', …, looksLikeHeicName(file))`.
2. **Decode upright.** `bitmap = await decodeUpright(file)`. On throw → `ImageProcessingError('undecodable', …, looksLikeHeicName(file))`. (EXIF orientation is applied by `imageOrientation: 'from-image'`, so iPhone photos are not rotated wrong.)
3. **Passthrough.** If `options.passthroughMaxBytes != null && bitmap.width <= maxLongSidePx && bitmap.height <= maxLongSidePx && file.size <= options.passthroughMaxBytes && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp')`: `bitmap.close()`; return `{ file, mimeType: file.type, sizeBytes: file.size, width: bitmap.width, height: bitmap.height, wasProcessed: false }`. (HEIC never passes through — it must be re-encoded to a viewable type.)
4. **Target size.** `computeTargetSize`: `scale = Math.min(1, maxLongSidePx / Math.max(w, h))`; `tw = Math.round(w * scale)`, `th = Math.round(h * scale)`. **Never upscale** (`scale` capped at 1).
5. **Draw.** `canvas = getCanvas(tw, th)`; `drawBitmap(canvas, bitmap, tw, th)`; `bitmap.close()` immediately.
6. **Format.** `format === 'jpeg'` → `image/jpeg`; `'webp'` → `image/webp`; `'auto'` → `canEncodeWebp(canvas) ? 'image/webp' : 'image/jpeg'`.
7. **Encode.** `quality = options.quality ?? 0.82`; `blob = await encodeCanvas(canvas, mime, quality)`. If `blob == null || blob.type !== mime` → `ImageProcessingError('encode-failed', …)`.
8. **Bounded second pass.** If `options.targetBytes != null && blob.size > options.targetBytes && quality > (options.qualityFloor ?? 0.6)`: `q2 = Math.max(options.qualityFloor ?? 0.6, quality - 0.15)`; `blob2 = await encodeCanvas(canvas, mime, q2)`; keep `blob2` if it is valid and smaller, else keep `blob`. **At most two encode attempts.** No loop.
9. **Release canvas.** Set `canvas.width = canvas.height = 0`.
10. **Build File.** `ext = mime === 'image/webp' ? 'webp' : 'jpg'`; `name = deriveProcessedFilename(file.name, ext)`; `out = new File([blob], name, { type: mime, lastModified: Date.now() })`.
11. **Return** `{ file: out, mimeType: mime, sizeBytes: blob.size, width: tw, height: th, wasProcessed: true }`. Canvas re-encode drops EXIF/GPS naturally — no metadata is intentionally preserved.

`processImagesForUpload`: `const out: ProcessedImage[] = []; for (let i = 0; i < files.length; i++) { try { out.push(await processImageForUpload(files[i], options)); } catch (e) { throw e instanceof ImageProcessingError ? new ImageProcessingError(e.code, \`Bild ${i + 1}: ${e.message}\`, e.likelyHeic) : e; } } return out;` — strictly sequential, one bitmap alive at a time.

### Per-use-case options

| Caller | `maxLongSidePx` | `quality` | `qualityFloor` | `targetBytes` | `passthroughMaxBytes` |
| ------ | --------------- | --------- | -------------- | ------------- | --------------------- |
| chat image | 1600 | 0.82 | 0.6 | `500 * 1024` | `512 * 1024` |
| training proof | 1600 | 0.85 | 0.65 | `500 * 1024` | `512 * 1024` |
| (PR B avatar — not built here) | 512 | 0.8 | 0.6 | `120 * 1024` | — |

Constants live in the callers (`chat-media.ts`, `submit-training.ts`), named `CHAT_IMAGE_PROCESS_OPTIONS` / `PROOF_IMAGE_PROCESS_OPTIONS`.

### HEIC / HEIF decision

- **Current behaviour:** `probeImage` (`src/features/challenge/heic.ts`) tries `createImageBitmap(file)`; if it throws (browser can't decode HEIC), the picker rejects the file with `HEIC_UNSUPPORTED_MESSAGE`. If it succeeds (modern iOS can decode its own HEIC), the file is accepted and uploaded **as `image/heic`** — which most other participants' Android/desktop browsers cannot render in an `<img>`.
- **PR A decision — no new dependency.** The processor decodes with `createImageBitmap` (works for HEIC on iOS) and then **re-encodes on the canvas to JPEG or WebP**. The uploaded object is therefore always a browser-universal type, regardless of the source being HEIC. This is strictly better than today: an iOS user whose HEIC currently uploads-but-is-unviewable now uploads a viewable JPEG/WebP.
- **If `createImageBitmap` throws** (older iOS Safari, or a corrupt file): `ImageProcessingError('undecodable', message, likelyHeic)`. The UI maps `likelyHeic === true` → the existing `HEIC_UNSUPPORTED_MESSAGE` copy, else `GENERIC_UNSUPPORTED_MESSAGE` (both already exported from `src/features/challenge/heic.ts` — reused, not duplicated; the processor stays feature-free and only returns the flag). **No silent broken upload** — the file is never sent.
- **Bundle impact: zero.** A WASM HEIC decoder (`heic2any` etc.) for browsers that cannot decode HEIC at all is a separate, independently-justified decision, explicitly **out of PR A scope** (spec §5, §24).
- `src/features/challenge/heic.ts` and `probeImage` are **kept** — the pickers (`ProofImagePicker`, `ChatPanel.addImages`) still use `probeImage` for immediate "this file is broken, skip it" feedback at selection time; the processor is the authoritative gate at send/submit time.

### Dependencies

**None added.** `package.json` currently has only `@supabase/supabase-js`, `@tanstack/react-query`, `react`, `react-dom`, `react-router-dom`, `zod` (runtime). No browser image library. The processor uses only standard browser APIs. Confirmed: no `browser-image-compression`, `compressorjs`, `pica`, `heic2any` present.

---

## File map

### Modify

| Path | Current responsibility | Planned change |
| ---- | ---------------------- | -------------- |
| `src/features/chat/ChatPanel.tsx` | Chat panel: message list, scroll orchestration (B1), image composer (B3) | Replace one-shot `didInitialScroll` with `stickToBottomRef` latch + `ResizeObserver` re-pin on a new `listRef`; add `programmaticScrollRef` guard; `jumpToLatest` sets the latch; add `composePhase` state ("Förbereder bild…"/"Laddar upp…"/null) driven by `onPhase` from the send mutation; button label uses it. No structural/CSS change beyond the label string. |
| `src/features/chat/chat.ts` | Pure chat helpers incl. `isNearBottom`, `scrollAnchorAdjustment`, `shouldFollowNewMessage` | Add pure helper `isProgrammaticScroll(actualTop: number, expectedTop: number | null, tolerancePx?: number): boolean` (default tolerance 2). No change to existing helpers. |
| `src/features/chat/chat-media.ts` | Chat image upload + signed-URL boundary | `uploadChatImages` runs each file through `processImageForUpload(file, CHAT_IMAGE_PROCESS_OPTIONS)` before upload; uploads `processed.file` with `contentType: processed.mimeType`; path extension + `PreparedChatAttachment.{mime_type,size_bytes,width,height}` come from `processed`. Drop the inline `EXT_BY_MIME`/`probeImage` per-file check (the processor validates + decodes). Add optional `onPhase?: (p: 'processing' | 'uploading') => void` param — call `onPhase('processing')` before the first `processImageForUpload`, `onPhase('uploading')` before the first `.upload`. `EXT_BY_MIME` kept only for the `chatImageSignedUrl`-side path parsing if still needed — otherwise removed. |
| `src/features/chat/chat-api.ts` | `sendChatMessage` orchestration (upload → atomic RPC → cleanup) | `SendChatMessageInput` gains `onPhase?: (p: 'processing' | 'uploading') => void`; passed straight to `uploadChatImages`. No other change. |
| `src/features/chat/useChat.ts` | React Query bindings for chat | `PostVars` gains `onPhase?: (p: 'processing' | 'uploading') => void`; `usePostChatMessage` passes it into `sendChatMessage`. No change to `useChatImageUrls`/`useChatMessages`. |
| `src/features/challenge/submit-training.ts` | "Logga träning" write path incl. `attachProofs` (1–2 proof images) | `attachProofs` replaces its `ALLOWED_MIME`/`probeImage` loop with `processImagesForUpload(files, PROOF_IMAGE_PROCESS_OPTIONS)`; uploads `processed[i].file`; row `mime_type/size_bytes/width/height` + path ext from `processed`. `MAX_PROOF_IMAGES` check runs **before** processing. `SubmitTrainingInput` gains `onProofPhase?: (p: 'processing' | 'uploading') => void`; threaded into `attachProofs`. `submitTraining` unchanged otherwise (GM pulse intact). |
| `src/features/challenge/add-training-session.ts` | Dubbelpass — extra session + `attachProofs` | No code change (inherits `attachProofs`). Add `onProofPhase` to `AddSessionInput` and pass through, only if a Dubbelpass phase label is wanted — **optional**; default: leave `add-training-session.ts` untouched, Dubbelpass shows only "Sparar passet…". Decision recorded in Task 9. |
| `src/features/retroactive/retroactive-api.ts` | `uploadRetroactiveProof` (single proof object for efterregistrering) | Replace `ALLOWED_MIME`/`probeImage` with `processImageForUpload(file, PROOF_IMAGE_PROCESS_OPTIONS)`; upload `processed.file`; return meta from `processed`. Keep `RetroactiveError` mapping (incl. HEIC copy). |
| `src/pages/LogPage.tsx` | Log-training page; renders `ProofSlots`, submit button "Sparar passet…" | Pass `onProofPhase: setProofPhase` into `submitMutation.mutateAsync`; add `const [proofPhase, setProofPhase] = useState<'processing' | 'uploading' | null>(null)`; submit button label: `proofPhase === 'processing' ? 'Förbereder bild…' : submitMutation.isPending ? 'Sparar passet…' : '…'`. Reset `proofPhase` on settle. No layout change. |
| `src/features/challenge/MultiSessionLog.tsx` | Dubbelpass multi-session log UI | Same `proofPhase` label pattern **only if** `add-training-session.ts` is given `onProofPhase` (Task 9 decision). If not, no change. |
| `docs/CHAT.md` | Shared Chat reference doc | §6 UI: note the scroll fix (stick-to-bottom latch + ResizeObserver re-pin) and the "Förbereder bild…" composer state. |
| `docs/DATABASE.md` | Schema/storage reference | §6 Storage: one line — client-side compression happens before upload; server MIME/size limits unchanged and remain authoritative. |
| `vite.config.ts` | Vite + Vitest config | No change expected. Only touch if a new `src/test/*` helper needs `setupFiles` (it does not — helpers are imported per test file). |

### Create

| Path | Purpose | Exports |
| ---- | ------- | ------- |
| `src/lib/media/image-processing.ts` | The one reusable client-side image processor (resize + re-encode + typed errors) | `PROCESSABLE_INPUT_MIME`, `ProcessImageOptions`, `ProcessedImage`, `ImageProcessingErrorCode`, `ImageProcessingError`, `processImageForUpload`, `processImagesForUpload` |
| `src/lib/media/image-processing.test.ts` | Unit tests for the processor | — |
| `src/test/media-mocks.ts` | Reusable jsdom stubs for `createImageBitmap`, `HTMLCanvasElement.prototype.getContext`/`toBlob`, and (optional) `OffscreenCanvas` | `installCanvasMocks(config: { decode?: (file: File) => { width: number; height: number } | 'throw'; toBlob?: (mime: string, quality: number) => { size: number; type: string } | null; withOffscreenCanvas?: boolean }): { uninstall(): void }` |
| `src/test/resize-observer-mock.ts` | Reusable jsdom `ResizeObserver` stub with a manual trigger | `installResizeObserverMock(): { trigger(): void; uninstall(): void }` |

### Tests (exact path → behaviour covered)

| Path | Behaviour |
| ---- | --------- |
| `src/features/chat/chat.test.ts` (extend) | `isProgrammaticScroll`: true when `actualTop` within tolerance of `expectedTop`; false when far; false when `expectedTop` is null. |
| `src/features/chat/ChatPanel.test.tsx` (extend `describe('ChatPanel scroll behaviour (B1)')`) | **T1 (fails first):** first open then `ctl.grow(1400→2200)` + `roMock.trigger()` → `ctl.scrollTop` re-pinned to `2200` (not left at the pre-growth pin). **T2:** first open pins to `scrollHeight` (existing test still passes). **T3:** user scrolls up (`ctl.scrollTop = 0; ctl.fireScroll()`) → subsequent `roMock.trigger()` does **not** re-pin. **T4:** after scrolling up, user scrolls back to bottom (`ctl.scrollTop = scrollHeight; fireScroll()`) → `roMock.trigger()` re-pins again. **T5:** upward pagination anchor (existing test) still passes and RO does not fight it. **T6:** incoming near bottom follows (existing). **T7:** incoming while scrolled up → "Nya meddelanden", no move (existing). **T8:** clicking "Nya meddelanden" → pin + latch true + `markRead` (existing, adjust for latch). **T9:** read cursor only advances on first-pin / near-bottom / jump (existing). **T10:** reopening (unmount + remount) still lands at newest. |
| `src/features/chat/ChatPanel.test.tsx` (extend `describe('ChatPanel image composer (B3)')`) | **T11:** while a send with images is pending, the button shows "Förbereder bild…" when `onPhase('processing')` fired, then "Laddar upp…" after `onPhase('uploading')`. **T12:** existing "rejects a fifth image and keeps four" still passes. **T13:** existing "image-only send allowed" still passes. |
| `src/lib/media/image-processing.test.ts` | small image within bounds + under `passthroughMaxBytes` + jpeg → returned unchanged (`wasProcessed: false`, same `File`); oversized landscape (4000×3000, max 1600) → 1600×1200, aspect preserved; oversized portrait (3000×4000) → 1200×1600; never upscales (800×600, max 1600) → still 800×600 but re-encoded when no passthrough; output MIME is `image/webp` when `canEncodeWebp` true, `image/jpeg` when false; `format: 'jpeg'` forces jpeg; output `sizeBytes` reflects the encoded blob; `targetBytes` triggers exactly one lower-quality re-encode and never goes below `qualityFloor` (assert `toBlob` called with two quality values, 2nd ≥ floor); `file.size === 0` → `ImageProcessingError('empty-file')`; `file.type === 'application/pdf'` → `ImageProcessingError('unsupported-type')`; `createImageBitmap` throws for a `.heic` file → `ImageProcessingError('undecodable', likelyHeic: true)`; `createImageBitmap` throws for a `.jpg` → `undecodable`, `likelyHeic: false`; HEIC that decodes → re-encoded, `mimeType` is jpeg/webp (never heic), `wasProcessed: true`; `toBlob` returns null → `ImageProcessingError('encode-failed')`; `imageOrientation: 'from-image'` is passed to `createImageBitmap` (assert call args); bitmap `.close()` is called after draw (spy); `OffscreenCanvas` branch covered when `withOffscreenCanvas: true`. |
| `src/lib/media/image-processing.test.ts` (`processImagesForUpload` section) | processes 3 files sequentially (assert `createImageBitmap` calls do not overlap — the mock records active count and asserts max 1); returns results in order; first failure rejects with `ImageProcessingError` whose message contains `Bild 2:`; empty array → `[]`. |
| `src/features/chat/chat-media.test.ts` (extend) | `uploadChatImages` calls `processImageForUpload` per file (mock the module) and uploads the **processed** file (`upload` called with `processed.file`, `contentType: processed.mimeType`); path extension matches the processed mime (`.webp`/`.jpg`); `PreparedChatAttachment` fields come from `processed`; `>4` still rejected before processing; `onPhase('processing')` then `onPhase('uploading')` fire in order; a processing `ImageProcessingError` propagates as `ChatError` and no `.upload` happens; cleanup still removes uploaded objects on a later failure. |
| `src/features/chat/chat-api.test.ts` (extend) | `sendChatMessage` forwards `onPhase` into `uploadChatImages`; text-only path never calls the processor. |
| `src/features/chat/useChat.test.tsx` (extend) | `usePostChatMessage` forwards `onPhase` from `PostVars` into `sendChatMessage`. |
| `src/features/challenge/submit-training.test.ts` (extend) | `attachProofs` runs files through `processImagesForUpload` (mock) and uploads processed files; row `mime_type`/`size_bytes` come from processed; existing tests — "rejects a third image before any upload" (now: before processing), "saves entry with no proof files without touching storage", "uploads two images at positions 1 & 2", replace path — all still pass; `onProofPhase('processing')` then `('uploading')` fire; a processing error → `SubmitTrainingError` with `entrySaved: true`, no `.upload`. |
| `src/features/challenge/SessionForm.test.tsx` / `MultiSessionLog.test.tsx` (extend only if labels added) | existing slot behaviour unchanged; if Task 9 adds the Dubbelpass label, one test for "Förbereder bild…" → "Sparar passet…". |
| `src/features/retroactive/retroactive-api.test.ts` (create if absent, else extend) | `uploadRetroactiveProof` runs the file through `processImageForUpload` and uploads the processed file; HEIC-undecodable → `RetroactiveError` with the HEIC copy; check the current test file — `ls src/features/retroactive/*.test.*` — and match its mock style. |
| `src/pages/pages.smoke.test.tsx` (extend) | LogPage still renders and submits with the processor mocked; ChatPanel/Viktkampen smoke unaffected. |

> **Task 0 (investigation step, has explicit success criteria):** before Task 9, run `ls src/features/retroactive/` and `grep -n "vi.mock\|describe" src/features/retroactive/*.test.*`. **Success:** the exact retroactive test file name and its Supabase-mock pattern are recorded in the Task 9 notes, so the new assertions match the existing style. If there is no retroactive test file, Task 9 creates `src/features/retroactive/retroactive-api.test.ts` mirroring `submit-training.test.ts`'s `chain()`/`mocks` structure.

---

## Shared interfaces (established once, used verbatim by later tasks)

From `src/lib/media/image-processing.ts` — see "Public interface" above. Later tasks **must** import `processImageForUpload`, `processImagesForUpload`, `ProcessedImage`, `ImageProcessingError` exactly as named there.

Phase callback type (used by chat and proof): `type UploadPhase = 'processing' | 'uploading';` and `type UploadPhaseCallback = (phase: UploadPhase) => void;`. Define `UploadPhase` / `UploadPhaseCallback` **once** in `src/lib/media/image-processing.ts` and re-export from there; `chat-media.ts`, `chat-api.ts`, `useChat.ts`, `submit-training.ts` import them from `@/lib/media/image-processing`.

Caller option constants (exact names): `CHAT_IMAGE_PROCESS_OPTIONS` in `src/features/chat/chat-media.ts`, `PROOF_IMAGE_PROCESS_OPTIONS` in `src/features/challenge/submit-training.ts` (imported by `retroactive-api.ts`). Values per the "Per-use-case options" table.

`src/features/chat/chat.ts`: `export function isProgrammaticScroll(actualTop: number, expectedTop: number | null, tolerancePx = 2): boolean` — `expectedTop === null ? false : Math.abs(actualTop - expectedTop) <= tolerancePx`.

---

## Tasks

### Task 1 — Reproduce & lock the first-open scroll bug with a failing test

- [ ] **Step 1: Write the failing test.** In `src/features/chat/ChatPanel.test.tsx`, `describe('ChatPanel scroll behaviour (B1)')`, add `it('re-pins to the newest message when first-page media grows the list after the initial pin')`: install the ResizeObserver mock (Task 2 creates the helper — for Task 1, inline a minimal `let roCb: (() => void) | null` shim in the test), open with 3 messages and `mockScroller(el, { scrollHeight: 1400, clientHeight: 400, scrollTop: 0 })`, assert the initial pin set `ctl.scrollTop === 1400`, then `ctl.grow(2200)` and fire the RO callback, assert `ctl.scrollTop === 2200`.
- [ ] **Step 2: Run and confirm failure.** `npx vitest run src/features/chat/ChatPanel.test.tsx` — the new test **fails** (current `ChatPanel` has no ResizeObserver and `didInitialScroll` is one-shot, so `scrollTop` stays `1400`). Record the failure output.
- [ ] **Step 3: No implementation yet** — this task only locks the regression. Leave the test failing? **No** — a red test cannot be committed to a green branch. Instead: mark it `it.skip` with a comment `// unskipped in Task 3` and commit the skipped test + the root-cause analysis section of this plan is the deliverable. (Task 3 unskips it.)
- [ ] **Step 4: Commit.** `git add src/features/chat/ChatPanel.test.tsx && git commit -m "test(chat): lock the first-open scroll bug (skipped until the fix)"`

### Task 2 — Test helpers: `resize-observer-mock` + pure `isProgrammaticScroll`

- [ ] **Step 1: Write failing test** for `isProgrammaticScroll` in `src/features/chat/chat.test.ts`: within-tolerance → true; far → false; `null` expected → false.
- [ ] **Step 2: Run, confirm failure** (`isProgrammaticScroll` undefined): `npx vitest run src/features/chat/chat.test.ts`.
- [ ] **Step 3: Implement.** Add `isProgrammaticScroll` to `src/features/chat/chat.ts` (signature above). Create `src/test/resize-observer-mock.ts` exporting `installResizeObserverMock()` — a class assigned to `globalThis.ResizeObserver` that registers callbacks; `trigger()` invokes each; `uninstall()` restores the previous value.
- [ ] **Step 4: Re-run** `npx vitest run src/features/chat/chat.test.ts` — green.
- [ ] **Step 5: Regression** `npx vitest run src/features/chat/`.
- [ ] **Step 6: Commit.** `git commit -m "test(chat): resize-observer mock + isProgrammaticScroll helper"`

### Task 3 — Deterministic bottom-pin in `ChatPanel`

- [ ] **Step 1: Unskip Task 1's test** and add: `it('does not re-pin after the user scrolls up')`, `it('re-pins again once the user scrolls back to the bottom')`, `it('reopening the panel lands at the newest message')`. Use `installResizeObserverMock` from Task 2.
- [ ] **Step 2: Run, confirm failure** — the unskipped + new tests fail against current code.
- [ ] **Step 3: Implement.** In `ChatPanel.tsx`:
  - add `const listRef = useRef<HTMLDivElement>(null)` on the `styles.list` div; keep `scrollRef` on the Sheet body.
  - replace `didInitialScroll` with `const stickToBottomRef = useRef(true)` and `const hasPinnedOnceRef = useRef(false)`; reset both in the `[challengeId, open]` effect (`stickToBottomRef.current = true`, `hasPinnedOnceRef.current = false`).
  - add `const programmaticScrollRef = useRef<number | null>(null)` and a helper `const pinToBottom = useCallback(() => { const el = scrollRef.current; if (!el) return; programmaticScrollRef.current = el.scrollHeight; el.scrollTop = el.scrollHeight; }, [])`.
  - in the `scroll` listener: `if (isProgrammaticScroll(el.scrollTop, programmaticScrollRef.current)) { programmaticScrollRef.current = null; return; }` then `stickToBottomRef.current = isNearBottom(el)` and the existing near-top pagination auto-load (guarded by `!stickToBottomRef.current` implicitly since the user scrolled up) — keep dismiss-"Nya meddelanden"-when-near-bottom.
  - `useLayoutEffect` branch (b): `if (!hasPinnedOnceRef.current || stickToBottomRef.current) { pinToBottom(); if (!hasPinnedOnceRef.current) { hasPinnedOnceRef.current = true; advanceRead(maxSeq); } }` — first render pins + marks read; later renders re-pin only while stuck.
  - branch (c): use `stickToBottomRef.current || isOwnMessage` instead of `nearBottomRef.current || isOwnMessage`; the follow path calls `pinToBottom()` (or keeps `bottomRef.scrollIntoView` — keep `scrollIntoView` for the smooth follow, but set `programmaticScrollRef.current = el.scrollHeight` right before it so the resulting `scroll` event is treated as programmatic).
  - new `useEffect`: create a `ResizeObserver` on `listRef.current`; callback: `const el = scrollRef.current; if (el && stickToBottomRef.current && pendingAnchorHeight.current === null) pinToBottom()`. Disconnect on cleanup / `[open, challengeId]` change. Guard `typeof ResizeObserver !== 'undefined'`.
  - `jumpToLatest`: `stickToBottomRef.current = true; pinToBottom(); setShowNewMessages(false); advanceRead(maxSeq)`.
  - remove `nearBottomRef` if fully replaced, or keep it as the live "is near bottom" snapshot only where still read; prefer removing it — `stickToBottomRef` covers all cases.
- [ ] **Step 4: Re-run** `npx vitest run src/features/chat/ChatPanel.test.tsx` — all green (new + all pre-existing B1/B3 tests).
- [ ] **Step 5: Regression** `npx vitest run src/features/chat/ src/features/admin/ChatModerationSheet.test.tsx src/pages/pages.smoke.test.tsx`.
- [ ] **Step 6: Inspect diff** — `git diff src/features/chat/ChatPanel.tsx`; confirm no CSS change, no composer/message-render change, `advanceRead`/`markedSeq` semantics identical.
- [ ] **Step 7: Commit.** `git commit -m "fix(chat): keep the viewport pinned to newest through async media/layout on first open"`

### Task 4 — `src/lib/media/media-mocks` + processor scaffolding & validation

- [ ] **Step 1: Write failing tests.** Create `src/lib/media/image-processing.test.ts` covering: `empty-file`, `unsupported-type` (`application/pdf`), `undecodable` for `a.heic` (`createImageBitmap` throws) with `likelyHeic: true`, `undecodable` for `a.jpg` with `likelyHeic: false`. Create `src/test/media-mocks.ts` exporting `installCanvasMocks(config)` (spec above) — for this task only the `decode` behaviour and the `ImageProcessingError` shape matter.
- [ ] **Step 2: Run, confirm failure** (`image-processing.ts` does not exist): `npx vitest run src/lib/media/image-processing.test.ts`.
- [ ] **Step 3: Implement** `src/lib/media/image-processing.ts` with the exports listed under "Public interface", but only steps 1–2 of the algorithm real (validate + decode); steps 3–11 throw `ImageProcessingError('encode-failed', 'not implemented')` for now — **no**, that violates "no placeholders": implement the full algorithm (steps 1–11) in this task. Implement `looksLikeHeicName`, `decodeUpright`, and the `ImageProcessingError` class fully.
- [ ] **Step 4: Re-run** — validation + decode tests green.
- [ ] **Step 5: Commit.** `git commit -m "feat(media): image-processing module — validate, decode, typed errors"`

### Task 5 — Processor: resize + encode + passthrough + bounded second pass

- [ ] **Step 1: Write failing tests** in `image-processing.test.ts`: passthrough (small jpeg under `passthroughMaxBytes`), oversized landscape → 1600×1200, oversized portrait → 1200×1600, never-upscale, output MIME auto=webp when `canEncodeWebp`, forced jpeg, `sizeBytes` from blob, `targetBytes` → exactly one extra `toBlob` at `quality - 0.15` clamped to `qualityFloor`, `toBlob` null → `encode-failed`, HEIC-that-decodes → re-encoded to jpeg/webp (`mimeType` never heic), `imageOrientation: 'from-image'` passed, `bitmap.close()` spy called. Extend `installCanvasMocks` with `toBlob` + `withOffscreenCanvas`.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement** algorithm steps 3–11 + `computeTargetSize`, `getCanvas`, `drawBitmap`, `encodeCanvas`, `canEncodeWebp` (memoised), `deriveProcessedFilename`.
- [ ] **Step 4: Re-run** `npx vitest run src/lib/media/image-processing.test.ts` — green.
- [ ] **Step 5: Commit.** `git commit -m "feat(media): resize + re-encode with passthrough and bounded quality pass"`

### Task 6 — `processImagesForUpload` (sequential, bounded memory)

- [ ] **Step 1: Write failing tests**: 3 files processed in order; `installCanvasMocks` records concurrent `createImageBitmap` calls and asserts max 1 at any time; first failure rejects with `ImageProcessingError` whose message contains `Bild 2:`; `[]` → `[]`.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement** `processImagesForUpload` (strict `for` loop; re-wrap `ImageProcessingError` with the index).
- [ ] **Step 4: Re-run** — green.
- [ ] **Step 5: Regression** `npx vitest run src/lib/media/`.
- [ ] **Step 6: Commit.** `git commit -m "feat(media): sequential bounded-memory batch processing"`

### Task 7 — Integrate the processor into Shared Chat

- [ ] **Step 1: Write failing tests** in `src/features/chat/chat-media.test.ts` (mock `@/lib/media/image-processing`): `uploadChatImages` calls `processImageForUpload` per file with `CHAT_IMAGE_PROCESS_OPTIONS`; `.upload` receives `processed.file` and `contentType: processed.mimeType`; path ends `.webp` when processed mime is webp; `PreparedChatAttachment` fields from `processed`; `>4` rejected before processing; `onPhase` fires `'processing'` then `'uploading'`; a processing `ImageProcessingError('undecodable', …, true)` → `ChatError` and `.upload` not called. Extend `src/features/chat/chat-api.test.ts` (`sendChatMessage` forwards `onPhase`) and `src/features/chat/useChat.test.tsx` (`usePostChatMessage` forwards `onPhase`). Extend `ChatPanel.test.tsx` composer tests for the "Förbereder bild…"→"Laddar upp…" label.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.** `chat-media.ts`: add `CHAT_IMAGE_PROCESS_OPTIONS`; `uploadChatImages(challengeId, userId, messageId, files, onPhase?)` → `onPhase?.('processing')`; per file `const processed = await processImageForUpload(file, CHAT_IMAGE_PROCESS_OPTIONS)` (wrap `ImageProcessingError` → `ChatError` with the HEIC/generic copy from `heic.ts` based on `err.code`/`err.likelyHeic`); `onPhase?.('uploading')` before the first `.upload`; upload `processed.file`; ext from `processed.mimeType`. `chat-api.ts`: `SendChatMessageInput.onPhase?`; pass to `uploadChatImages`. `useChat.ts`: `PostVars.onPhase?`; pass through. `ChatPanel.tsx`: `const [composePhase, setComposePhase] = useState<UploadPhase | null>(null)`; `send()` passes `onPhase: setComposePhase` and resets it in `onSuccess`/`onError`; button label: `composePhase === 'processing' ? 'Förbereder bild…' : post.isPending ? 'Laddar upp…' : 'Skicka'`.
- [ ] **Step 4: Re-run** focused tests, then `npx vitest run src/features/chat/`.
- [ ] **Step 5: Inspect diff** — confirm `SIGNED_URL_TTL_SECONDS` unchanged, no RLS/RPC/policy reference, no realtime change, cleanup path intact.
- [ ] **Step 6: Commit.** `git commit -m "feat(chat): compress chat images client-side before upload"`

### Task 8 — Integrate the processor into training-proof upload

- [ ] **Step 1: Write failing tests** in `src/features/challenge/submit-training.test.ts` (mock `@/lib/media/image-processing`): `attachProofs` runs `processImagesForUpload(files, PROOF_IMAGE_PROCESS_OPTIONS)`; `.upload` receives processed files; row `mime_type`/`size_bytes`/`width`/`height` from processed; `MAX_PROOF_IMAGES` check runs before processing (3 files → `SubmitTrainingError` before any `processImagesForUpload` call); existing tests still pass; `onProofPhase` fires `'processing'` then `'uploading'`; a processing error → `SubmitTrainingError(entrySaved: true)`, no `.upload`.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.** `submit-training.ts`: add `PROOF_IMAGE_PROCESS_OPTIONS`; `SubmitTrainingInput.onProofPhase?: UploadPhaseCallback`; `attachProofs(..., onProofPhase?)`: after the `MAX_PROOF_IMAGES` check, `onProofPhase?.('processing')`; `const processed = await processImagesForUpload(files, PROOF_IMAGE_PROCESS_OPTIONS)` (wrap `ImageProcessingError` → `SubmitTrainingError(msg, true)` with HEIC/generic copy); `onProofPhase?.('uploading')` before the first `.upload`; upload `processed[i].file`; build rows from `processed[i]`. Drop the `ALLOWED_MIME`/`probeImage` loop. `submitTraining` passes `onProofPhase` through. `LogPage.tsx`: `proofPhase` state + button label + pass `onProofPhase`.
- [ ] **Step 4: Re-run** focused, then `npx vitest run src/features/challenge/ src/pages/pages.smoke.test.tsx`.
- [ ] **Step 5: Inspect diff** — one/two-proof logic, `unique (training_entry_id, position)` handling, delete-old-then-insert ordering, GM pulse, `training_proofs` RLS references — all unchanged. `hasProof` / `proofValid` logic in `LogPage` unchanged.
- [ ] **Step 6: Commit.** `git commit -m "feat(proof): compress training-proof images client-side before upload"`

### Task 9 — Retroactive-registration proof + Dubbelpass label decision

- [ ] **Step 0 (investigation, success criteria):** `ls src/features/retroactive/` and `grep -n "vi.mock\|describe\|it(" src/features/retroactive/*.test.*`. Record the test file name + mock pattern. **Success:** the exact assertions for Step 1 are written against the real file, or (no test file) `retroactive-api.test.ts` is created mirroring `submit-training.test.ts`'s `chain()`/`mocks` structure.
- [ ] **Step 1: Write failing tests** for `uploadRetroactiveProof`: runs `processImageForUpload(file, PROOF_IMAGE_PROCESS_OPTIONS)`; uploads the processed file; returns meta from processed; HEIC-undecodable → `RetroactiveError` with the HEIC copy.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.** `retroactive-api.ts`: import `PROOF_IMAGE_PROCESS_OPTIONS` from `@/features/challenge/submit-training` (or move the constant to `submit-training.ts` and re-export — pick one, record it); replace `ALLOWED_MIME`/`probeImage` with `processImageForUpload`; upload processed; return processed meta; keep `RetroactiveError` copy mapping. **Dubbelpass decision:** leave `add-training-session.ts` untouched (no `onProofPhase`); Dubbelpass shows only its existing label. Record: "Dubbelpass proof compression is inherited via `attachProofs`; the brief 'Förbereder bild…' label is omitted there to keep the diff minimal — acceptable per spec §5 ('UI **may** show')."
- [ ] **Step 4: Re-run** focused, then `npx vitest run src/features/retroactive/ src/features/challenge/`.
- [ ] **Step 5: Commit.** `git commit -m "feat(proof): compress efterregistrering proof images; inherit for Dubbelpass"`

### Task 10 — HEIC end-to-end + docs

- [ ] **Step 1: Write failing/There-may-already-be-coverage tests:** (a) `image-processing.test.ts` — a `.heic` file that decodes is re-encoded and its `mimeType` is `image/jpeg` or `image/webp`, never `image/heic`; (b) `chat-media.test.ts` — an undecodable `.heic` → `ChatError` whose message is `HEIC_UNSUPPORTED_MESSAGE`; (c) `submit-training.test.ts` — same → `SubmitTrainingError` with the HEIC copy, `entrySaved: true`. If Tasks 5/7/8 already cover all three, this step only adds the missing assertions.
- [ ] **Step 2: Run, confirm failure** for any not-yet-covered assertion.
- [ ] **Step 3: Implement** only the copy-mapping wiring if missing (the processor + integrations are already done). Update `docs/CHAT.md` §6 (scroll fix + "Förbereder bild…") and `docs/DATABASE.md` §6 (client compression before upload; server limits authoritative and unchanged).
- [ ] **Step 4: Re-run** the three focused files.
- [ ] **Step 5: `npx prettier --write docs/CHAT.md docs/DATABASE.md`** (both are prettier-checked).
- [ ] **Step 6: Commit.** `git commit -m "feat(media): HEIC re-encode path + docs"`

### Task 11 — Full PR A verification

- [ ] **Step 1: Full gates** (exact `package.json` scripts):
  - `npm run test` — expect **≥ 65 files** (new: `image-processing.test.ts`; possibly `retroactive-api.test.ts`) and **> 471 tests**, all pass. Record the exact totals.
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm run build`
- [ ] **Step 2: Database CI is untouched.** Confirm `git diff main -- supabase/` is **empty**. The Database Tests CI baseline (`Files=27, Tests=669, PASS`) is unchanged because PR A adds no migration and no pgTAP file. (When the PR is opened, dispatch `database-tests.yml` once to confirm it is still `Files=27, Tests=669, PASS` — it must be identical.)
- [ ] **Step 3: Security / isolation review** (read-only; no Supabase call):
  - `git diff main -- supabase/` empty; no change to any migration, RLS, RPC, storage policy, or the `supabase_realtime` publication.
  - `git grep -n "SIGNED_URL_TTL_SECONDS"` → still `120`; not changed.
  - no new `.from(` on `chat_messages` / `chat_message_attachments` / `training_proofs` beyond what already existed.
  - `requestGameMasterPulse` call site in `submit-training.ts` byte-identical (`git diff main -- src/features/challenge/submit-training.ts` shows only `attachProofs`/options changes).
  - no new bucket, no `public: true`, no MIME-allow-list widening (the processor only emits `image/jpeg` / `image/webp`, both already accepted; a passed-through small PNG is `image/png`, also already accepted).
- [ ] **Step 4: Performance check** (manual reasoning, documented in the PR body): `processImagesForUpload` is a strict sequential loop; `bitmap.close()` is called before the next `createImageBitmap`; one canvas per file, `width/height` zeroed after encode; at most 2 `toBlob` calls per file; no `Promise.all` over decodes; `ChatPanel` preview object URLs are still created/revoked with `files`.
- [ ] **Step 5: Bundle check.** `npm run build` then `grep -rl "image-processing" dist/assets/*.js` — the module is bundled; `grep -rE "heic2any|browser-image-compression|compressorjs|pica" dist/assets` → **no matches** (no dependency added).
- [ ] **Step 6: Cloudflare release-health note** (documented, not executed): the eventual PR A production release must confirm the Cloudflare Workers Build has `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, and the served bundle references the real Supabase origin / does not render the env-validation screen (spec §22). No deployment in this plan.
- [ ] **Step 7: Commit** any formatting-only fixups. `git commit -m "chore(pr-a): formatting + verification notes"` (skip if nothing to commit).

---

## Exact commands

Focused (per task): `npx vitest run <path>` — e.g. `npx vitest run src/lib/media/image-processing.test.ts`, `npx vitest run src/features/chat/ChatPanel.test.tsx`.

Nearby regression: `npx vitest run src/features/chat/`, `npx vitest run src/features/challenge/`, `npx vitest run src/features/retroactive/`, `npx vitest run src/lib/media/`, `npx vitest run src/pages/pages.smoke.test.tsx`.

Full project gates (end of Task 11):

```
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm run check` runs `typecheck && lint && test && build` in one go.

Diff inspection: `git diff main -- src/`, `git diff main -- supabase/` (must be empty), `git diff main -- docs/`.

No database commands run in this plan. For the eventual PR A rollout there is **no** `supabase db push` and **no** `npm run db:types` (PR A has no schema change).

---

## Spec coverage self-review (2026-09-06)

Checked the plan against the approved design spec (§4, §5, §17, §18, §20, §21, §22 + appendix):

- **Every PR A requirement maps to a task.** §4 first-open scroll → Tasks 1–3; §4 A–F desired behaviours → Task 3 test matrix (T2–T10); §4 optional unread divider → **not included** (deliberately deferred to keep PR A tight; noted below). §5 shared processor → Tasks 4–6; §5 chat + proof targets (1600 px, aspect, WebP-preferred/JPEG-fallback, ~200–500 KB soft target, quality floor) → `CHAT_IMAGE_PROCESS_OPTIONS`/`PROOF_IMAGE_PROCESS_OPTIONS` + algorithm steps 4/6/7/8; §5 "Förbereder bild…"/"Laddar upp…" → Tasks 7/8 (`UploadPhase`); §5 HEIC → "HEIC / HEIF decision" + Task 10; §5 server-security-not-weakened → Global Constraints + Task 11 Step 3.
- **No PR B avatar implementation** — the processor is designed with `maxLongSidePx` so PR B *can* reuse it; no avatar bucket, table column, UI, or `shares_challenge_with` helper is created. §6 explicitly out of scope.
- **No replies, likes, mentions, notifications, Web Push, Game Master** — no such table, column, RPC, service worker, VAPID, or GM call is added or modified. `requestGameMasterPulse` is left byte-identical (Task 11 Step 3).
- **No core challenge change** — `git diff main -- supabase/` must be empty; no trigger, FK, `challenge_day_states`, streak, debt, ranking, Straffbanken, efterregistrering, or weight change. Efterregistrering's `uploadRetroactiveProof` is a client-side upload helper only — Task 9 changes the compression, not the approval/audit logic.
- **Media privacy preserved** (§18) — no public bucket, `SIGNED_URL_TTL_SECONDS` unchanged at 120, no generic media endpoint, compression is client-side and additive.
- **Moderation semantics preserved** (§17) — no change to `chat_messages` RLS, `_chat_attachment_readable`, `list_chat_messages`, `hide_chat_message`, or the reply/mention/notification surfaces (none of which exist yet).
- **Realtime unchanged** — no change to the `supabase_realtime` publication; `useChatMessages` still subscribes only to `chat_activity`; Task 11 Step 3 asserts it.
- **No public buckets, no production shortcuts** — no deployment, no `db push`, no `db:types`, no `production` branch update in the plan.
- **Placeholder scan** — no "TBD"/"TODO"/"add tests"/"handle errors appropriately"/"similar to above"; every helper is named (`looksLikeHeicName`, `decodeUpright`, `computeTargetSize`, `getCanvas`, `drawBitmap`, `encodeCanvas`, `canEncodeWebp`, `deriveProcessedFilename`, `pinToBottom`, `isProgrammaticScroll`); every file path is verified against the current repo (all `Modify` paths were read during Step 1 inspection); the one genuine unknown (the retroactive test file) is Task 9 Step 0 with explicit success criteria.
- **Dependency assumptions** — resolved: **no dependency added**; `package.json` inspected; standard browser APIs only.
- **Cleanup / memory** — `bitmap.close()` after draw, one canvas per file zeroed after encode, sequential processing, no `Promise.all` decode, object-URL lifecycle in `ChatPanel`/`ProofImagePicker` unchanged (Task 11 Step 4).
- **HEIC decision present** — yes, with the no-dependency rationale, the decode-then-re-encode approach, the undecodable-fallback copy, and the zero bundle impact.
- **Storage MIME compatibility present** — yes, verified from the PR #6 live inspection: `chat-media` and `proofs` buckets + `chat_message_attachments_mime_valid` + `training_proofs_mime_valid` + `post_chat_message` in-RPC check all accept `image/jpeg` and `image/webp`; **no migration needed**; a format change that broke this would be a flagged migration item.
- **Cloudflare env / build-variable warning present** — Global Constraints "Release model" + Task 11 Step 6.
- **Rollback / release safety** — PR A has no DB change, so rollback = revert the frontend PR + re-advance `production` to the prior SHA (documented in Global Constraints); no data migration to reverse.

### Deliberate scoping note

The **optional unread divider** (spec §4 "Optional polish (approved)") is **not** in this plan. Rationale: it needs either `chat_read_state.last_read_seq` exposed to the client (no such read path exists today — only `unread_chat_count`) or a purely count-based heuristic (`useUnreadChatCount` → divider before the last N loaded messages) which is imprecise across page boundaries. Keeping PR A to the two named deliverables (scroll fix, compression) is the priority; the divider can be a small follow-up once PR C adds a richer read-state surface. If the reviewer wants it in PR A, add it as a final presentational-only task keyed off `useUnreadChatCount` with no change to `mark_chat_read`.
