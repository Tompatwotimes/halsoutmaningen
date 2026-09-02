import { useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { formatLongDate } from '@/domain/format';
import type { RosterMember } from '@/features/challenge/roster-api';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { membershipDisplayState } from './membershipState';
import { useUpdateMembership } from './membership-api';
import styles from './EditMembershipSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  today: string;
  member: RosterMember;
}

export function EditMembershipSheet({
  open,
  onClose,
  challenge,
  today,
  member,
}: Props) {
  const [startDate, setStartDate] = useState(member.participationStartDate);
  const [endDate, setEndDate] = useState(member.participationEndDate ?? '');
  const [active, setActive] = useState(member.membershipActive);

  const mutation = useUpdateMembership(challenge.id);

  const displayNow = membershipDisplayState(
    challenge,
    {
      userId: member.userId,
      participationStartDate: member.participationStartDate,
      participationEndDate: member.participationEndDate,
      active: member.membershipActive,
    },
    today,
  );

  const endValid = endDate === '' || endDate >= startDate;
  const dirty =
    startDate !== member.participationStartDate ||
    (endDate || null) !== member.participationEndDate ||
    active !== member.membershipActive;

  async function save() {
    if (!endValid || !dirty) return;
    try {
      await mutation.mutateAsync({
        membershipId: member.membershipId,
        challengeId: challenge.id,
        userId: member.userId,
        participationStartDate: startDate,
        participationEndDate: endDate || null,
        active,
      });
      onClose();
    } catch {
      /* surfaced */
    }
  }

  function endParticipationToday() {
    setEndDate(today < startDate ? startDate : today);
  }

  return (
    <Sheet open={open} onClose={onClose} title={member.displayName}>
      <p className={styles.now}>
        Nu: <strong>{displayNow.label}</strong> · räknas{' '}
        {formatLongDate(displayNow.effectiveStart)} –{' '}
        {formatLongDate(displayNow.effectiveEnd)}
      </p>

      <label className={styles.field}>
        <span>Deltagande från</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Deltagande till (tomt = hela utmaningen)</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </label>
      <div className={styles.quick}>
        <button
          type="button"
          className={styles.link}
          onClick={endParticipationToday}
        >
          Avsluta idag
        </button>
        {endDate !== '' && (
          <button
            type="button"
            className={styles.link}
            onClick={() => setEndDate('')}
          >
            Ta bort slutdatum
          </button>
        )}
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span>
          Aktivt medlemskap (avmarkera för att pausa — historiken påverkas inte)
        </span>
      </label>

      {!endValid && (
        <p className={styles.err}>Slutdatum kan inte vara före startdatum.</p>
      )}
      {mutation.error && (
        <p className={styles.err}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Kunde inte spara.'}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button
          loading={mutation.isPending}
          disabled={!dirty || !endValid}
          onClick={() => void save()}
        >
          Spara
        </Button>
      </div>
    </Sheet>
  );
}
