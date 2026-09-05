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
}): string {
  // A hidden message never shows its text — and the server already withholds
  // `body` (sends null) for a non-admin viewer, so treat a missing body as
  // hidden too rather than rendering an empty bubble.
  return message.status === 'hidden' || message.body === null
    ? HIDDEN_MESSAGE_PLACEHOLDER
    : message.body;
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
