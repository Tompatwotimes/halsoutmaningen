import { EmptyState } from '@/components/feedback/EmptyState';
import { formatDayMonth } from '@/domain/format';
import type { WeightRankingRow } from './types';
import styles from './WeightRankingList.module.css';

/**
 * The public live Viktkampen table. It does NO filtering of its own — a hidden
 * participant is already absent from `weight_public_ranking`'s result (an
 * explicit `not is_weight_hidden` predicate + RLS, server-side, spec §2.8/§4).
 * This component renders exactly the rows it is handed, in the order given
 * (the RPC already orders most-weight-lost first). A zero-row result means
 * nobody has cleared the 24h start-weight lock AND logged a regular entry yet
 * — the empty state says so rather than implying nobody has weighed in.
 */
export function WeightRankingList({ rows }: { rows: WeightRankingRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Ingen är kvalificerad för rankingen ännu."
        body="Startvikten behöver vara låst i 24 timmar och minst en vanlig invägning behöver vara registrerad."
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
