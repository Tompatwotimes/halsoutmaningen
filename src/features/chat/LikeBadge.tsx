import { HeartFilledIcon, HeartIcon } from '@/components/icons';
import { likeBadgeAriaLabel } from './chat';
import styles from './LikeBadge.module.css';

/**
 * The reaction micro-badge (design §8.1) — a compact pill attached to the
 * bottom-right of a message or training card.
 *
 *  - `likeCount === 0` → renders nothing (no reserved space).
 *  - `likeCount === 1` → a small heart only.
 *  - `likeCount >= 2` → heart + a `tabular-nums` count ("♥ 4"), never "♥ 1".
 *
 * It is a real toggle `<button>` (design §7.3): `aria-pressed` carries the
 * viewer's like state independently of colour, and `aria-label` announces the
 * count ("3 personer gillar meddelandet"). Behaviour is the parent's — this
 * component holds no mutation logic.
 */
export function LikeBadge({
  likeCount,
  likedByMe,
  subject = 'meddelandet',
  onToggle,
  disabled,
}: {
  likeCount: number;
  likedByMe: boolean;
  /** `meddelandet` for a message, `passet` for a training card. */
  subject?: 'meddelandet' | 'passet';
  onToggle: () => void;
  disabled?: boolean;
}) {
  if (likeCount <= 0) return null;

  return (
    <button
      type="button"
      className={[styles.badge, likedByMe && styles.mine]
        .filter(Boolean)
        .join(' ')}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={likedByMe}
      aria-label={likeBadgeAriaLabel(likeCount, likedByMe, subject)}
    >
      {likedByMe ? (
        <HeartFilledIcon className={styles.heart} aria-hidden="true" />
      ) : (
        <HeartIcon className={styles.heart} aria-hidden="true" />
      )}
      {likeCount >= 2 && (
        <span className={`${styles.count} tnum`} aria-hidden="true">
          {likeCount}
        </span>
      )}
    </button>
  );
}
