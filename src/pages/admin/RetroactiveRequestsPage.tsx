import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { CheckIcon } from '@/components/icons';
import { useChallenges } from '@/features/admin/challenges-api';
import { useParticipants } from '@/features/admin/participants-api';
import { useRetroactiveQueue } from '@/features/retroactive/useRetroactive';
import { AdminRetroactiveReview } from '@/features/retroactive/AdminRetroactiveReview';
import styles from './RetroactiveRequestsPage.module.css';

export function RetroactiveRequestsPage() {
  const { data: challenges, isLoading, isError, refetch } = useChallenges();

  const active = useMemo(
    () => (challenges ?? []).filter((c) => c.status === ChallengeStatus.Active),
    [challenges],
  );

  if (isLoading) return <Spinner label="Laddar…" />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Efterregistreringar"
        subtitle="Deltagares begäran att registrera ett tidigare pass."
      />
      <p className={styles.back}>
        <Link to="/admin">← Administration</Link>
      </p>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Ingen aktiv utmaning"
            body="Efterregistreringar hanteras för den aktiva utmaningen."
          />
        </Card>
      ) : (
        active.map((c) => <ChallengeQueue key={c.id} challenge={c} />)
      )}
    </>
  );
}

function ChallengeQueue({ challenge }: { challenge: ChallengeConfig }) {
  const queue = useRetroactiveQueue(challenge.id);
  const roster = useParticipants(challenge.id);

  const nameOf = useMemo(() => {
    const m = new Map(
      (roster.data ?? []).map((p) => [p.userId, p.displayName]),
    );
    return (id: string) => m.get(id) ?? 'Deltagare';
  }, [roster.data]);

  if (queue.isLoading) return <Spinner label="Laddar efterregistreringar…" />;
  if (queue.isError) return <ErrorState onRetry={() => void queue.refetch()} />;

  const rows = queue.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  const handled = rows.filter((r) => r.status !== 'pending');

  return (
    <section className={styles.section}>
      <h2 className={styles.challengeName}>{challenge.name}</h2>

      {pending.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckIcon />}
            title="Inget att granska"
            body="Alla efterregistreringar är hanterade."
          />
        </Card>
      ) : (
        <>
          <p className={styles.count}>{pending.length} väntar på granskning</p>
          {pending.map((r) => (
            <AdminRetroactiveReview
              key={r.id}
              challengeId={challenge.id}
              request={r}
              participantName={nameOf(r.userId)}
            />
          ))}
        </>
      )}

      {handled.length > 0 && (
        <>
          <h3 className={styles.handledHead}>Hanterade</h3>
          {handled.map((r) => (
            <AdminRetroactiveReview
              key={r.id}
              challengeId={challenge.id}
              request={r}
              participantName={nameOf(r.userId)}
            />
          ))}
        </>
      )}
    </section>
  );
}
