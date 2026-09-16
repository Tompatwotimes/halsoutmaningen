import type { DayState } from '@/domain/dayState';
import { PenaltyDot } from '@/components/ui/PenaltyBadge';
import { DoublePassStar } from './DoublePassStar';
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
  /**
   * Renders the premium gold-star prestige marker (Översikt only — see
   * `src/domain/penalties.ts::isDoublePassDay`). Purely presentational:
   * zero gameplay effect, never derived here — callers pass the already
   * computed `doublePassAchieved` flag.
   */
  doublePass?: boolean;
  /** Stable per-cell seed (e.g. `${userId}:${date}`) for shimmer desync. */
  doublePassSeed?: string;
}

export function StatusCell({
  state,
  today = false,
  size = 'md',
  onClick,
  ariaLabel,
  penalised = false,
  doublePass = false,
  doublePassSeed,
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
      {doublePass && <DoublePassStar seed={doublePassSeed} />}
    </>
  );
  const base = ariaLabel ?? meta.label;
  const suffixes = [
    penalised ? '(straff)' : null,
    doublePass ? 'Dubbelpass genomfört' : null,
  ].filter((s): s is string => s !== null);
  const label = suffixes.length > 0 ? `${base} ${suffixes.join(' · ')}` : base;

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
