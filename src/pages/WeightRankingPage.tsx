import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { WeightRankingList } from '@/features/weight/WeightRankingList';
import {
  useWeightFinalResult,
  useWeightPublicRanking,
} from '@/features/weight/useWeight';
import styles from './WeightRankingPage.module.css';

/**
 * Viktkampen — the public live weight ranking (normal auth, not admin; reached
 * from a link on Profile, not a nav tab). A hidden participant is simply absent
 * — no placeholder row. The official winner appears once it is finalised and,
 * for a hidden winner, disclosed — with name + percentage only, never a kg.
 */
export function WeightRankingPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const challengeId = data?.challenge.id ?? null;
  const ranking = useWeightPublicRanking(challengeId);
  const final = useWeightFinalResult(challengeId);

  if (isLoading) {
    return (
      <>
        <PageHeader eyebrow="VIKT" title="Viktkampen" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
      </>
    );
  }
  if (isError) {
    return (
      <>
        <PageHeader eyebrow="VIKT" title="Viktkampen" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data) return <NoMembershipState title="Viktkampen" />;

  const winner = final.data;
  const showWinner = winner && winner.winnerUserId !== null;

  return (
    <>
      <PageHeader
        eyebrow="VIKT"
        title="Viktkampen"
        subtitle="Störst procentuell viktnedgång vinner. Startvikt mot senaste vägning."
      />

      {showWinner && (
        <Card variant="gradient" className={styles.winnerCard}>
          <p className={styles.winnerEyebrow}>
            {winner.disclosed ? 'Vinnare' : 'Ledare i mål'}
          </p>
          <p className={styles.winnerName}>{winner.winnerDisplayName}</p>
          <p className={styles.winnerPct}>{winner.winnerPercentageChange} %</p>
        </Card>
      )}

      <Card title="Live-ställning">
        {ranking.isLoading ? (
          <Skeleton height="8rem" radius="var(--radius-md)" />
        ) : ranking.isError ? (
          <ErrorState
            title="Viktkampen kunde inte hämtas"
            message="Försök igen om en stund."
          />
        ) : (
          <WeightRankingList rows={ranking.data ?? []} />
        )}
      </Card>
    </>
  );
}
