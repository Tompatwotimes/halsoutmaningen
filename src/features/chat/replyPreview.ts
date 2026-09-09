import { formatMinutes } from '@/domain/format';
import { HIDDEN_MESSAGE_PLACEHOLDER } from './chat';
import type { ChatMessage, ChatSenderType, ReplyPreview } from './types';

/**
 * Pure presentation helpers for reply quoting (design §5.5 / §5.7). No I/O, no
 * URL minting, no reading of a storage path / full note / GM internal — only
 * the small safe fields the server already put in `reply_preview`, or the
 * equivalent fields off a fully-loaded `ChatMessage`.
 *
 * The viewer-relative `Du` label is applied HERE, at render time — it is never
 * persisted and never sent to an API (design §5.7).
 */

/** Sender label + one-line semantic preview for a reply quote. */
export interface ReplyQuoteText {
  /** `Du` / `GAME MASTER` / a display name / `Deltagare`; `''` for a hidden parent. */
  senderLabel: string;
  /** The single preview line — truncated text, `📷 Bild`, `🏃 … · … min`, or the placeholder. */
  line: string;
}

/** The composer reply-strip target — what message a pending reply is aimed at. */
export interface ReplyTarget {
  messageId: string;
  senderLabel: string;
  line: string;
}

function senderLabelFor(
  sender: {
    senderType: ChatSenderType | null;
    senderUserId: string | null;
    senderDisplayName: string | null;
  },
  viewerUserId: string | null,
): string {
  if (
    sender.senderUserId !== null &&
    viewerUserId !== null &&
    sender.senderUserId === viewerUserId
  ) {
    return 'Du';
  }
  if (sender.senderType === 'game_master') return 'GAME MASTER';
  return sender.senderDisplayName ?? 'Deltagare';
}

function trainingLine(
  activity: string | null,
  durationMinutes: number,
): string {
  return `🏃 ${activity ?? 'Träning'} · ${formatMinutes(durationMinutes)}`;
}

/**
 * The quote block content for a message's `reply_preview`.
 *
 *  - `preview.deleted` → `{ senderLabel: '', line: HIDDEN_MESSAGE_PLACEHOLDER }`
 *    — the canonical constant; nothing else is read off the payload, so a
 *    hidden parent can never leak a field here even if the server wrongly
 *    included one.
 *  - line: a training-card parent → `🏃 {activity ?? 'Träning'} · {minutes}`;
 *    an image-only parent (`kind === 'image'`) → `📷 Bild`; otherwise the
 *    already-server-truncated text, or `''`.
 */
export function replyQuoteText(
  preview: ReplyPreview,
  viewerUserId: string | null,
): ReplyQuoteText {
  if (preview.deleted) {
    return { senderLabel: '', line: HIDDEN_MESSAGE_PLACEHOLDER };
  }
  const senderLabel = senderLabelFor(preview, viewerUserId);
  let line: string;
  if (preview.training !== null) {
    line = trainingLine(
      preview.training.activity,
      preview.training.durationMinutes,
    );
  } else if (preview.kind === 'image') {
    line = '📷 Bild';
  } else {
    line = preview.text ?? '';
  }
  return { senderLabel, line };
}

/**
 * Build the composer reply-strip target from a fully-loaded message the viewer
 * chose to reply to (design §5.8). Same label + line rules as
 * `replyQuoteText`, but sourced from the live `ChatMessage`. Only ever called
 * for a visible, active message — the swipe / action row that produce it are
 * absent on a hidden one. The full body is kept here; the strip clamps it to
 * one line in CSS.
 */
export function deriveReplyTarget(
  message: ChatMessage,
  viewerUserId: string | null,
): ReplyTarget {
  const senderLabel = senderLabelFor(message, viewerUserId);
  let line: string;
  if (message.trainingCard !== null) {
    line = trainingLine(
      message.trainingCard.activity,
      message.trainingCard.durationMinutes,
    );
  } else if (message.body !== null && message.body.trim() !== '') {
    line = message.body;
  } else if (message.attachments.length > 0) {
    line = '📷 Bild';
  } else {
    line = '';
  }
  return { messageId: message.id, senderLabel, line };
}
