import { Link } from 'react-router-dom';
import { ChallengeStatus } from '@/domain/challenge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallenges } from '@/features/admin/challenges-api';
import { WeightFinalPanel } from '@/features/admin/WeightFinalPanel';
import styles from './WeightFinalPage.module.css';

/**
 * Admin official final weigh-in + winner disclosure (spec §6.5), route
 * `/admin/viktkampen`, `RequireAdmin`-gated. Only an admin may register/correct
 * an official final weight or publish the winner — the panel has no
 * hide-my-weight control and no hidden-history viewer.
 */
export function WeightFinalPage() {
  const { data: challenges, isLoading, isError, refetch } = useChallenges();

  const activeChallengeId =
    challenges?.find((c) => c.status === ChallengeStatus.Active)?.id ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Viktkampen — final"
        subtitle="Officiell slutvägning, fastställ och publicera vinnaren."
      />
      <p className={styles.back}>
        <Link to="/admin">← Administration</Link>
      </p>

      {isLoading ? (
        <Spinner label="Laddar…" />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : activeChallengeId === null ? (
        <Card>
          <EmptyState
            title="Ingen aktiv utmaning"
            body="Viktkampens final avgörs per aktiv utmaning."
          />
        </Card>
      ) : (
        <WeightFinalPanel challengeId={activeChallengeId} />
      )}
    </>
  );
}
