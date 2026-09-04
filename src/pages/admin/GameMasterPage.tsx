import { Link } from 'react-router-dom';
import { ChallengeStatus } from '@/domain/challenge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallenges } from '@/features/admin/challenges-api';
import { GameMasterSettingsPanel } from '@/features/admin/GameMasterSettingsPanel';
import { GameMasterRunLog } from '@/features/admin/GameMasterRunLog';
import styles from './GameMasterPage.module.css';

/**
 * Admin Game Master control (spec §16), route `/admin/game-master`,
 * `RequireAdmin`-gated. Emergency brake + read-only observability only — no
 * manual roast / victim / winner / token affordance anywhere.
 */
export function GameMasterPage() {
  const { data: challenges, isLoading, isError, refetch } = useChallenges();

  const activeChallengeId =
    challenges?.find((c) => c.status === ChallengeStatus.Active)?.id ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Game Master"
        subtitle="Autonomt överraskningslager, nödbroms och historik."
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
            body="Game Master styrs per aktiv utmaning."
          />
        </Card>
      ) : (
        <div className={styles.sections}>
          <GameMasterSettingsPanel challengeId={activeChallengeId} />
          <GameMasterRunLog challengeId={activeChallengeId} />
        </div>
      )}
    </>
  );
}
