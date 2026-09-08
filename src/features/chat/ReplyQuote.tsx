import { swedishPossessive } from './chat';
import { replyQuoteText } from './replyPreview';
import type { ReplyPreview } from './types';
import styles from './ReplyQuote.module.css';

/**
 * The compact one-level quote of the message a reply is replying to (design
 * §5.3 / §8.2). Rendered inside the reply's card, between the head and the
 * body. Visually subordinate — a thin left border, muted type, ≤ 2 clamped
 * lines — never a second full message.
 *
 * The whole box is a `<button>`: activating it jumps to the original (§5.6,
 * wired in Task H via `onJump`). A hidden parent renders the canonical
 * `[Borttaget av administratör]` placeholder and its accessible name is the
 * fixed `Svar på ett borttaget meddelande` — the quote's accessible name and
 * DOM MUST NOT expose any withheld original content (§7.3 / §12), and a hidden
 * parent is never jumpable (there is no visible original to reach).
 */
export function ReplyQuote({
  preview,
  viewerUserId,
  onJump,
}: {
  preview: ReplyPreview;
  viewerUserId: string | null;
  onJump?: (seq: number) => void;
}) {
  const { senderLabel, line } = replyQuoteText(preview, viewerUserId);
  const seq = preview.seq;
  const canJump =
    !preview.deleted && seq !== null && typeof onJump === 'function';

  const accessibleName = preview.deleted
    ? 'Svar på ett borttaget meddelande'
    : quoteAccessibleName(senderLabel, line);

  return (
    <button
      type="button"
      className={styles.quote}
      data-deleted={preview.deleted || undefined}
      aria-label={accessibleName}
      onClick={canJump ? () => onJump(seq) : undefined}
    >
      {!preview.deleted && senderLabel !== '' && (
        <span className={styles.sender}>{senderLabel}</span>
      )}
      <span className={styles.line}>{line}</span>
    </button>
  );
}

function quoteAccessibleName(senderLabel: string, line: string): string {
  const who =
    senderLabel === 'Du'
      ? 'ditt meddelande'
      : `${swedishPossessive(senderLabel)} meddelande`;
  return line !== '' ? `Svar på ${who}: ”${line}”` : `Svar på ${who}`;
}
