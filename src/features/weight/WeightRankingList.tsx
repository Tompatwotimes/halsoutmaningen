import { EmptyState } from '@/components/feedback/EmptyState';
import { formatDayMonth } from '@/domain/format';
import type { WeightRankingRow } from './types';
import styles from './WeightRankingList.module.css';

/**
 * The public live Viktkampen table. It does NO filtering of its own — a hidden
 * participant is already absent from `weight_public_ranking`'s result (RLS,
 * server-side, spec §4). This component renders exactly the rows it is handed,
 * in the order given (the RPC already orders most-weight-lost first).
 */
export function WeightRankingList({ rows }: { rows: WeightRankingRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Ingen är med i Viktkampen än"
        body="Deltagare dyker upp här när de har låst en startvikt och loggat minst en vikt."
      />
    );
  }

  return (
    <ol className={styles.list}>
      {rows.map((r, i) => (
        <li key={r.userId} className={styles.row}>
          <span className={styles.rank}>{i + 1}</span>
          <span className={styles.body}>
            <span className={styles.name}>{r.displayName}</span>
            <span className={styles.meta}>
              {r.startWeightKg} → {r.latestWeightKg} kg
              <span className={styles.sep}>·</span>
              {formatDayMonth(r.latestEntryDate)}
            </span>
          </span>
          <span className={styles.change}>
            <span
              className={r.percentageChange <= 0 ? styles.loss : styles.gain}
            >
              {r.percentageChange > 0 ? '+' : ''}
              {r.percentageChange} %
            </span>
            <span className={styles.kg}>
              {r.kgChange > 0 ? '+' : ''}
              {r.kgChange} kg
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
