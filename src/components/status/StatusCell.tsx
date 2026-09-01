import type { DayState } from '@/domain/dayState';
import { statusMeta } from './statusMeta';
import styles from './StatusCell.module.css';

export interface StatusCellProps {
  state: DayState;
  /** Emphasises the cell as belonging to today's column. */
  today?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Provided → the cell becomes a button (used for completed entries). */
  onClick?: (() => void) | undefined;
  /** Full accessible sentence, e.g. "Anna, idag: genomförd". */
  ariaLabel?: string | undefined;
}

export function StatusCell({
  state,
  today = false,
  size = 'md',
  onClick,
  ariaLabel,
}: StatusCellProps) {
  const meta = statusMeta(state);
  const className = [
    styles.cell,
    styles[size],
    styles[meta.tone],
    today && styles.today,
    onClick && styles.interactive,
  ]
    .filter(Boolean)
    .join(' ');

  const content = meta.Icon ? (
    <meta.Icon className={styles.glyph} />
  ) : (
    <span className={styles.mark} aria-hidden="true" />
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={ariaLabel ?? meta.label}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={className}
      role="img"
      aria-label={ariaLabel ?? meta.label}
    >
      {content}
    </span>
  );
}
