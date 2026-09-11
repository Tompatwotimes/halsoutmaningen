import { currentPlainDateInTimeZone } from '@/domain/time';
import type { ChatMessage, ChatMessageStatus } from './types';

/**
 * Pure shared-chat helpers. No I/O. See `types.ts` for the `seq`-vs-`createdAt`
 * ordering contract these helpers uphold.
 */

/** The fixed text shown for an admin-hidden message — the raw body is never displayed. */
export const HIDDEN_MESSAGE_PLACEHOLDER = '[Borttaget av administratör]';

/**
 * The exact Swedish message `post_chat_message` raises when a reply's target
 * was hidden between arming and sending (migration 20260908120000). The
 * composer matches it verbatim to drop reply mode while keeping the draft
 * (design §5.8 / §26). Kept as a constant so the string lives in one place.
 */
export const HIDDEN_REPLY_TARGET_MESSAGE =
  'Meddelandet går inte längre att svara på';

/** Server-enforced hard limit; the composer also checks this as defence in depth. */
export const CHAT_BODY_MAX_LENGTH = 1000;

/** Server-enforced rate limit; the composer greys out optimistically using it. */
export const CHAT_RATE_LIMIT_COUNT = 10;
export const CHAT_RATE_LIMIT_WINDOW_SECONDS = 30;

export function displayBody(message: {
  status: ChatMessageStatus;
  body: string | null;
  /** Optional — pre-image callers can omit it. */
  attachments?: { position: number; path: string }[];
  /** Optional — a training card renders its own layout, not a text line. */
  trainingCard?: unknown;
}): string | null {
  // A hidden message never shows its text (and the server withholds it, and
  // its attachments / card, sending null / []).
  if (message.status === 'hidden') return HIDDEN_MESSAGE_PLACEHOLDER;
  if (message.body !== null) return message.body;
  // body === null: an image-only active message, or an active training card,
  // renders no text line; a text-less message with nothing to show at all
  // falls back to the placeholder (a withheld body — the pre-image case).
  if ((message.attachments?.length ?? 0) > 0) return null;
  if (message.trainingCard != null) return null;
  return HIDDEN_MESSAGE_PLACEHOLDER;
}

/**
 * The challenge-local calendar day (`YYYY-MM-DD`) a message belongs to, for
 * date-separator grouping. Uses the challenge timezone, never the browser's
 * local date (CLAUDE.md §8). `createdAt` is used here only for display grouping,
 * never for ordering.
 */
export function chatDateSeparatorKey(
  createdAtIso: string,
  timeZone: string,
): string {
  return currentPlainDateInTimeZone(timeZone, new Date(createdAtIso));
}

/**
 * Client-side estimate only — the server's `post_chat_message` is the authority
 * on the rate limit. Used to disable the composer optimistically after a burst.
 */
export function isWithinRateLimitWindow(
  nowIso: string,
  sentAtIso: string,
  windowSeconds: number,
): boolean {
  const elapsedMs = Date.parse(nowIso) - Date.parse(sentAtIso);
  return elapsedMs >= 0 && elapsedMs < windowSeconds * 1000;
}

/** Returns a new array sorted ascending by `seq` — the only display order. */
export function sortBySeq(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.seq - b.seq);
}

/**
 * Swedish possessive of a display name for the reply action label: `Anna` →
 * `Annas`, but a name already ending in an s/x/z sound stays as-is
 * (`Tomas` → `Tomas`, `Max` → `Max`).
 */
export function swedishPossessive(name: string): string {
  return /[sxz]$/i.test(name) ? name : `${name}s`;
}

/**
 * Does an event target sit inside an interactive control (a button, link,
 * form field, or an explicitly-marked interactive region)? Used to stop a
 * double-click on the chat image, the badge, an action button etc. from also
 * liking the whole message.
 */
export function isInteractiveEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'button, a, input, textarea, select, [role="button"], [data-chat-interactive]',
    ) !== null
  );
}

/**
 * Does an event target sit inside a chat image thumbnail? An image thumb is
 * technically an interactive `<button>` (single tap → lightbox), but a mobile
 * double-tap on a photo still likes the containing message — so the gesture
 * layer treats it differently from an action / moderation button.
 */
export function isChatImageTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-chat-image]') !== null
  );
}

// ---------------------------------------------------------------------------
// Mobile gesture primitives (design §6). Pure so the state machine in
// useMessageGestures is unit-testable without a DOM.
// ---------------------------------------------------------------------------

/** Rightward travel (px) at which releasing the swipe arms a reply. */
export const REPLY_SWIPE_ARM_PX = 64;
/** Hard cap on the visual swipe follow so a card can never slide off-screen. */
export const REPLY_SWIPE_MAX_PX = 96;
/** Movement (px) that still counts as a stationary tap, not a drag. */
export const TAP_SLOP_PX = 10;
/** Vertical movement (px) past which the gesture is committed to scrolling. */
export const SWIPE_DEADZONE_PX = 10;
/** Two taps closer together than this (ms) are a double-tap. */
export const DOUBLE_TAP_MS = 260;

// ---------------------------------------------------------------------------
// Jump-to-original from a reply quote (design §5.6 / §19.3)
// ---------------------------------------------------------------------------

/**
 * Hard cap on how many older pages jump-to-original will fetch before giving
 * up. 10 pages × 50 messages = 500 messages — deep enough to reach almost any
 * real reply target, bounded so a quote pointing at a purged / unreachable
 * message can never spin the pager forever.
 */
export const REPLY_JUMP_MAX_PAGES = 10;

/** Is a message with this `seq` among the ones currently loaded? */
export function findLoadedSeq(
  messages: readonly { seq: number }[],
  seq: number,
): boolean {
  return messages.some((m) => m.seq === seq);
}

export type PointerMovePhase = 'idle' | 'vscroll' | 'swipe';

/**
 * Classify an in-progress pointer move relative to its drag origin (design
 * §6.1):
 *   - `vscroll` — clear vertical intent (either direction). Native scroll owns
 *     it; it must NEVER become a reply swipe afterwards.
 *   - `swipe` — clear RIGHTWARD horizontal intent (`dx` dominant by 1.5×).
 *   - `idle` — not enough evidence yet; a leftward move also stays `idle`
 *     (there is no left-swipe feature).
 */
export function classifyPointerMove({
  dx,
  dy,
}: {
  dx: number;
  dy: number;
}): PointerMovePhase {
  if (Math.abs(dy) > SWIPE_DEADZONE_PX) return 'vscroll';
  if (dx > 12 && dx > Math.abs(dy) * 1.5) return 'swipe';
  return 'idle';
}

/** Has a rightward swipe travelled far enough to arm a reply on release? */
export function isSwipeArmed(dx: number): boolean {
  return dx >= REPLY_SWIPE_ARM_PX;
}

/** The clamped visual follow distance for a swipe: `0 ≤ result ≤ REPLY_SWIPE_MAX_PX`. */
export function clampSwipeDx(dx: number): number {
  if (dx <= 0) return 0;
  return Math.min(dx, REPLY_SWIPE_MAX_PX);
}

/**
 * The accessible label for the reaction micro-badge (design §7.3 / §26). Empty
 * string when there is nothing to announce (0 likes → the badge is not
 * rendered). `subject` is `meddelandet` for a message, `passet` for a training
 * card.
 */
export function likeBadgeAriaLabel(
  likeCount: number,
  likedByMe: boolean,
  subject: 'meddelandet' | 'passet' = 'meddelandet',
): string {
  const n = Math.max(0, Math.trunc(likeCount));
  if (n === 0) return '';
  if (likedByMe) {
    const others = n - 1;
    if (others === 0) return `Du gillar ${subject}`;
    if (others === 1) return `Du och 1 annan gillar ${subject}`;
    return `Du och ${others} andra gillar ${subject}`;
  }
  return `${n} ${n === 1 ? 'person' : 'personer'} gillar ${subject}`;
}

// ---------------------------------------------------------------------------
// Scroll positioning (B1 — chat opens at the latest message)
// ---------------------------------------------------------------------------

/** Default "close enough to the bottom to follow new messages" gap, in px. */
export const NEAR_BOTTOM_PX = 96;

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Is the scroll container within `px` of its bottom edge? Used to decide
 * whether an incoming message should pull the viewport down (follow) or be
 * announced with the "Nya meddelanden" button instead.
 */
export function isNearBottom(el: ScrollMetrics, px = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= px;
}

/**
 * How much to add to `scrollTop` after older messages are prepended so the
 * viewport stays visually anchored on the same message. Never negative — a
 * shorter list after a refetch must not scroll the user around.
 */
export function scrollAnchorAdjustment(
  prevScrollHeight: number,
  nextScrollHeight: number,
): number {
  const delta = nextScrollHeight - prevScrollHeight;
  return delta > 0 ? delta : 0;
}

/**
 * Whether a newly-arrived message should pull the viewport to the newest
 * message. The panel additionally always follows the viewer's OWN message
 * (sending scrolls you down even if you had scrolled up) — that check needs
 * the sender identity and stays in the component.
 */
export function shouldFollowNewMessage(wasNearBottom: boolean): boolean {
  return wasNearBottom;
}

/**
 * A `scroll` event whose `scrollTop` moved DOWN (toward the top of the history)
 * by at least this many px is the user deliberately scrolling up to read
 * history. Small sub-pixel wobble is ignored.
 *
 * Every programmatic reposition the panel performs — `pinToBottom`
 * (`scrollTop = scrollHeight`, which the browser clamps *up* to the max) and
 * the pagination anchor (`scrollTop += delta`, delta ≥ 0) — only ever holds or
 * increases `scrollTop`. So a decrease is unambiguously the user, with no
 * timing heuristic and no "expected position" bookkeeping to get wrong (the
 * previous `isProgrammaticScroll` compared `scrollTop` against `scrollHeight`,
 * but a scroll container clamps `scrollTop` to `scrollHeight - clientHeight`,
 * so that check was structurally always-false in a real browser — jsdom does
 * not clamp, which is why the unit tests never caught it).
 */
export const SCROLL_UP_INTENT_PX = 4;

/** Did this scroll move up (toward older messages) far enough to be a real user gesture? */
export function isUserScrollUp(
  deltaTop: number,
  intentPx = SCROLL_UP_INTENT_PX,
): boolean {
  return deltaTop <= -intentPx;
}
