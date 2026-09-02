import { useState, type SyntheticEvent } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { maxDate } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { useAllProfiles, useAddExistingMember } from './add-membership-api';
import type { RosterMember } from '@/features/challenge/roster-api';
import styles from './AddExistingParticipantForm.module.css';

interface Props {
  challenge: ChallengeConfig;
  today: string;
  existingMembers: RosterMember[];
}

const SUCCESS_TEXT = {
  created: 'Deltagaren lades till i utmaningen.',
  updated: 'Deltagandet uppdaterades.',
  unchanged: 'Personen är redan deltagare med dessa inställningar.',
} as const;

/**
 * Admin workflow to add an EXISTING profile/account to an existing challenge
 * (Part 2 of the real-data phase) — no invite email, no Edge Function. This
 * is also how the current administrator adds themselves as a participant.
 */
export function AddExistingParticipantForm({
  challenge,
  today,
  existingMembers,
}: Props) {
  const { user } = useAuth();
  const profilesQuery = useAllProfiles();
  const mutation = useAddExistingMember(challenge.id);

  const defaultStart = maxDate(challenge.startDate, today);
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const memberByUserId = new Map(existingMembers.map((m) => [m.userId, m]));

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setSuccess(null);
    if (!userId || !user) return;

    mutation.mutate(
      {
        challengeId: challenge.id,
        userId,
        participationStartDate: startDate,
        participationEndDate: endDate.trim() === '' ? null : endDate,
        callerId: user.id,
      },
      {
        onSuccess: (result) => {
          setSuccess(SUCCESS_TEXT[result.status]);
        },
      },
    );
  }

  return (
    <Card title="Lägg till befintlig profil">
      {profilesQuery.isLoading ? (
        <Spinner label="Laddar profiler…" />
      ) : profilesQuery.isError ? (
        <p className={styles.error}>Kunde inte hämta profiler.</p>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label htmlFor="existing-profile">Profil</label>
            <select
              id="existing-profile"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              <option value="" disabled>
                Välj en person…
              </option>
              {profilesQuery.data?.map((p) => {
                const member = memberByUserId.get(p.id);
                const suffix = [
                  p.role === 'admin' ? 'admin' : null,
                  !p.active ? 'inaktiv profil' : null,
                  member ? 'redan deltagare' : null,
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {suffix ? ` (${suffix})` : ''}
                  </option>
                );
              })}
            </select>
            <span className={styles.hint}>
              Denna lista visar alla konton, inklusive dig själv.
            </span>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="existing-start">Deltar från</label>
              <input
                id="existing-start"
                type="date"
                min={challenge.startDate}
                max={challenge.endDate}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="existing-end">Deltar till (valfritt)</label>
              <input
                id="existing-end"
                type="date"
                min={startDate}
                max={challenge.endDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {mutation.isError && (
            <p className={styles.error} role="alert">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Medlemskapet kunde inte sparas.'}
            </p>
          )}
          {success && (
            <p className={styles.success} role="status">
              {success}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            disabled={mutation.isPending || !userId}
          >
            {mutation.isPending ? 'Sparar…' : 'Lägg till i utmaningen'}
          </Button>
        </form>
      )}
    </Card>
  );
}
