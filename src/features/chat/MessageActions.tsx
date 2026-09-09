import { HeartFilledIcon, HeartIcon, ReplyIcon } from '@/components/icons';
import styles from './MessageActions.module.css';

/**
 * The explicit, keyboard-reachable action row on a non-hidden chat item
 * (design §7.1) — the accessibility fallback for the gesture shortcuts added
 * later. Two ghost icon `<button>`s: ❤️ like/unlike (a toggle — `aria-pressed`
 * carries state) and ↩️ reply. On touch it is a small always-visible row; on
 * desktop it reveals on hover / focus-within but stays focus-reachable (CSS).
 *
 * Dumb: labels and callbacks are supplied by `MessageRow`.
 */
export function MessageActions({
  likedByMe,
  likeLabel,
  replyLabel,
  likeDisabled,
  onLike,
  onReply,
}: {
  likedByMe: boolean;
  /** `Gilla meddelandet` / `Ta bort gilla-markering` / `Gilla passet`. */
  likeLabel: string;
  /** `Svara på {namn}s meddelande` / `Svara på {namn}s pass` / `Svara på ditt …`. */
  replyLabel: string;
  likeDisabled?: boolean;
  onLike: () => void;
  onReply: () => void;
}) {
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.button}
        onClick={onLike}
        disabled={likeDisabled}
        aria-pressed={likedByMe}
        aria-label={likeLabel}
      >
        {likedByMe ? (
          <HeartFilledIcon className={styles.icon} aria-hidden="true" />
        ) : (
          <HeartIcon className={styles.icon} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={onReply}
        aria-label={replyLabel}
      >
        <ReplyIcon className={styles.icon} aria-hidden="true" />
      </button>
    </div>
  );
}
