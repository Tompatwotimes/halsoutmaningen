import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { useChallenges } from '@/features/admin/challenges-api';
import {
  useParticipants,
  useAccountStatuses,
} from '@/features/admin/participants-api';
import { InviteParticipantForm } from '@/features/admin/InviteParticipantForm';
import { AddExistingParticipantForm } from '@/features/admin/AddExistingParticipantForm';
import { ParticipantList } from '@/features/admin/ParticipantList';
import styles from './ParticipantsPage.module.css';

export function ParticipantsPage() {
  const challengesQuery = useChallenges();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);

  const challenges = challengesQuery.data ?? [];
  const activeId =
    selectedId ??
    challenges.find((c) => c.status === 'active')?.id ??
    challenges[0]?.id ??
    null;

  const challenge = challenges.find((c) => c.id === activeId) ?? null;

  const today = useMemo(
    () => (challenge ? currentPlainDateInTimeZone(challenge.timeZone) : null),
    [challenge],
  );

  const participantsQuery = useParticipants(activeId);
  const accountsQuery = useAccountStatuses(activeId, showAccounts);

  if (challengesQuery.isLoading) {
    return <Spinner label="Laddar utmaningar…" />;
  }

  if (challengesQuery.isError) {
    return (
      <ErrorState
        message="Kunde inte hämta utmaningar."
        onRetry={() => void challengesQuery.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Deltagare"
        subtitle="Bjud in deltagare och hantera deltagandeperioder."
      />

      <p className={styles.back}>
        <Link to="/admin">← Administration</Link>
      </p>

      {challenges.length === 0 ? (
        <Card>
          <EmptyState
            title="Ingen utmaning att visa"
            body="Skapa en utmaning innan du bjuder in deltagare."
          />
        </Card>
      ) : (
        <>
          <Card>
            <label className={styles.selectLabel} htmlFor="challenge-select">
              Utmaning
            </label>
            <select
              id="challenge-select"
              className={styles.select}
              value={activeId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {challenges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </Card>

          {challenge && today && (
            <>
              <AddExistingParticipantForm
                challenge={challenge}
                today={today}
                existingMembers={participantsQuery.data ?? []}
              />
              <InviteParticipantForm challenge={challenge} today={today} />
            </>
          )}

          <Card
            title="Nuvarande deltagare"
            action={
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={showAccounts}
                  onChange={(e) => setShowAccounts(e.target.checked)}
                />
                Kontostatus
              </label>
            }
          >
            {participantsQuery.isLoading ? (
              <Spinner label="Laddar deltagare…" />
            ) : participantsQuery.isError ? (
              <ErrorState
                message="Kunde inte hämta deltagarna."
                onRetry={() => void participantsQuery.refetch()}
              />
            ) : !participantsQuery.data ||
              participantsQuery.data.length === 0 ? (
              <EmptyState
                title="Inga deltagare ännu"
                body="Bjud in den första deltagaren med formuläret ovan."
              />
            ) : (
              challenge &&
              today && (
                <>
                  {showAccounts && accountsQuery.isError && (
                    <p className={styles.accountsNote}>
                      Kontostatus är inte tillgänglig än (Edge Function inte
                      driftsatt).
                    </p>
                  )}
                  <ParticipantList
                    challenge={challenge}
                    today={today}
                    participants={participantsQuery.data}
                    accountStatuses={
                      showAccounts ? accountsQuery.data : undefined
                    }
                  />
                </>
              )
            )}
          </Card>
        </>
      )}
    </>
  );
}
