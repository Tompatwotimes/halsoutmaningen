import { useMemo } from 'react';
import { formatMinutes, formatPercent, formatSek } from '@/domain/format';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { SkullIcon } from '@/components/icons';
import { useChallengeResults } from './challenge-results-api';
import styles from './ChallengeResults.module.css';

interface Props {
  challengeId: string;
  nameOf: (userId: string) => string;
  /** Show final vs. current framing. */
  final?: boolean;
}

export function ChallengeResults({
  challengeId,
  nameOf,
  final = false,
}: Props) {
  const { data, isLoading } = useChallengeResults(challengeId);

  const rows = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.completionRate - a.completionRate),
    [data],
  );

  if (isLoading) return <Spinner label="Räknar resultat…" />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="Inga deltagare"
        body="Utmaningen har inga deltagare ännu."
      />
    );

  return (
    <ul className={styles.list}>
      {rows.map((r, i) => (
        <li key={r.userId} className={styles.row}>
          <span className={styles.rank}>{i + 1}</span>
          <Avatar name={nameOf(r.userId)} size="sm" />
          <div className={styles.body}>
            <span className={styles.name}>{nameOf(r.userId)}</span>
            <span className={styles.meta}>
              {formatPercent(r.completionRate * 100)} · {r.completedDays}/
              {r.completedDays + r.missedDays} dagar ·{' '}
              {formatMinutes(r.totalValidMinutes)}
            </span>
            {(r.penaltiesReceived > 0 || r.penaltiesAssigned > 0) && (
              <span className={styles.pen}>
                <SkullIcon className={styles.penIcon} aria-hidden="true" />
                {r.penaltiesAssigned} ut · {r.penaltiesReceived} in
              </span>
            )}
          </div>
          <div className={styles.right}>
            <span className={styles.debt}>{formatSek(r.liabilitySek)}</span>
            <span className={styles.debtLabel}>
              {final ? 'slutskuld' : 'skuld hittills'}
            </span>
            <span className={styles.streak}>
              streak {r.currentStreak} / {r.longestStreak}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
