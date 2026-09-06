import { currentPlainDateInTimeZone } from '@/domain/time';
import type { ChatMessage, ChatMessageStatus } from './types';

/**
 * Pure shared-chat helpers. No I/O. See `types.ts` for the `seq`-vs-`createdAt`
 * ordering contract these helpers uphold.
 */

/** The fixed text shown for an admin-hidden message — the raw body is never displayed. */
export const HIDDEN_MESSAGE_PLACEHOLDER = '[Borttaget av administratör]';

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
}): string | null {
  // A hidden message never shows its text (and the server withholds it, and
  // its attachments, sending null / []).
  if (message.status === 'hidden') return HIDDEN_MESSAGE_PLACEHOLDER;
  if (message.body !== null) return message.body;
  // body === null: an image-only active message renders no text line; a
  // text-less message with nothing to show at all falls back to the
  // placeholder (a withheld body with no attachments — the pre-image case).
  return (message.attachments?.length ?? 0) > 0
    ? null
    : HIDDEN_MESSAGE_PLACEHOLDER;
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
 * Did a `scroll` event come from the panel's own `el.scrollTop = …` assignment
 * rather than from the user? The panel records the exact `scrollTop` it is
 * about to set in a ref; the resulting `scroll` event lands within a pixel or
 * two of it. A larger gap means the user scrolled — which unsticks the
 * follow-the-bottom latch. `expectedTop === null` means "no programmatic scroll
 * is pending", so any event is the user's.
 */
export function isProgrammaticScroll(
  actualTop: number,
  expectedTop: number | null,
  tolerancePx = 2,
): boolean {
  if (expectedTop === null) return false;
  return Math.abs(actualTop - expectedTop) <= tolerancePx;
}
