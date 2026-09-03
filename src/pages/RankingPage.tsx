import { useMemo } from 'react';
import { formatPercent, formatSek } from '@/domain/format';
import { totalKassan } from '@/domain/liability';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { rankParticipants, type RankedRow } from '@/features/ranking/ranking';
import styles from './RankingPage.module.css';

export function RankingPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();

  const result = useMemo(
    () => (data ? rankParticipants(data.participants) : null),
    [data],
  );
  const kassan = useMemo(
    () =>
      data
        ? totalKassan(data.participants.map((p) => p.liability.confirmedDebt))
        : 0,
    [data],
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Ranking" subtitle="Preliminär ordning." />
        <Skeleton height="3.5rem" radius="var(--radius-lg)" />
        <Skeleton height="12rem" radius="var(--radius-lg)" />
        <Skeleton height="16rem" radius="var(--radius-lg)" />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader title="Ranking" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data || !result) {
    return <NoMembershipState title="Ranking" />;
  }

  const podium = result.ranked.slice(0, 3);
  const rest = result.ranked.slice(3);
  // Podium display order: 2nd, 1st, 3rd
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(
    (r): r is RankedRow => Boolean(r),
  );

  return (
    <>
      <PageHeader
        title="Ranking"
        subtitle="Genomförandegrad först, sedan färre missar och längst streak."
      />

      <p className={styles.disclaimer}>
        Preliminär ordning. Den slutgiltiga rankingformeln fastställs innan
        utmaningen avgörs.
      </p>

      <Card padding="md" className={styles.kassaCard}>
        <span className={styles.kassaLabel}>Kassan</span>
        <p className={styles.kassaValue}>
          <span className="tnum">{formatSek(kassan)}</span>
        </p>
        <span className={styles.kassaHint}>Gruppens samlade skuld just nu</span>
      </Card>

      {podiumOrder.length > 0 && (
        <div className={styles.podium}>
          {podiumOrder.map((row) => (
            <div
              key={row.participant.userId}
              className={[
                styles.podiumSlot,
                styles[`p${String(row.rank)}`],
                row.participant.isSelf && styles.podiumSelf,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.podiumRank}>{row.rank}</span>
              <Avatar
                name={row.participant.displayName}
                size={row.rank === 1 ? 'lg' : 'md'}
                ring={row.participant.isSelf}
              />
              <span className={styles.podiumName}>
                {row.participant.displayName.split(' ')[0]}
              </span>
              <span className={`${styles.podiumPct} tnum`}>
                {formatPercent(row.participant.completionRate * 100)}
              </span>
              <span className={styles.podiumBar} aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <Card padding="none">
          <ul className={styles.list}>
            {rest.map((row) => (
              <li
                key={row.participant.userId}
                className={[
                  styles.row,
                  row.participant.isSelf && styles.selfRow,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={`${styles.rank} tnum`}>{row.rank}</span>
                <Avatar
                  name={row.participant.displayName}
                  size="sm"
                  ring={row.participant.isSelf}
                />
                <div className={styles.rowBody}>
                  <span className={styles.rowName}>
                    {row.participant.displayName}
                    {row.participant.isSelf && (
                      <span className={styles.youTag}>du</span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>
                    {row.participant.currentStreak} dagars streak ·{' '}
                    {row.participant.liability.missedDays} missade
                  </span>
                </div>
                <span className={`${styles.rowPct} tnum`}>
                  {formatPercent(row.participant.completionRate * 100)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result.unranked.length > 0 && (
        <Card title="För få dagar för placering">
          <p className={styles.unrankedHint}>
            Deltagare med färre än {result.minDecidedDays} avgjorda dagar visas
            här tills underlaget räcker.
          </p>
          <ul className={styles.unrankedList}>
            {result.unranked.map((p) => (
              <li key={p.userId} className={styles.unrankedItem}>
                <Avatar name={p.displayName} size="sm" ring={p.isSelf} />
                <span className={styles.rowName}>{p.displayName}</span>
                <Badge tone="neutral" size="sm">
                  {formatPercent(p.completionRate * 100)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
