import type { DayState } from '@/domain/dayState';
import { PenaltyDot } from '@/components/ui/PenaltyBadge';
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
  /** Marks the day as carrying an offensive penalty. */
  penalised?: boolean;
}

export function StatusCell({
  state,
  today = false,
  size = 'md',
  onClick,
  ariaLabel,
  penalised = false,
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

  const content = (
    <>
      {meta.Icon ? (
        <meta.Icon className={styles.glyph} />
      ) : (
        <span className={styles.mark} aria-hidden="true" />
      )}
      {penalised && <PenaltyDot />}
    </>
  );
  const label = penalised
    ? `${ariaLabel ?? meta.label} (straff)`
    : (ariaLabel ?? meta.label);

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={label}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} role="img" aria-label={label}>
      {content}
    </span>
  );
}
