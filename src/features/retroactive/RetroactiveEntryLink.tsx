import { useState } from 'react';
import { addDays, compareDates } from '@/domain/dates';
import {
  effectiveEligibleEnd,
  effectiveEligibleStart,
} from '@/domain/membership';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import type { ChallengeDataset } from '@/features/challenge/types';
import { RetroactiveRequestSheet } from './RetroactiveRequestSheet';
import { useMyRetroactiveRequests } from './useRetroactive';
import styles from './RetroactiveEntryLink.module.css';

/**
 * The secondary "register a previous session" affordance on the Logga page.
 * Deliberately quiet — it must not compete with today's primary logging action.
 */
export function RetroactiveEntryLink({ data }: { data: ChallengeDataset }) {
  const { challenge, self, today } = data;
  const [pickOpen, setPickOpen] = useState(false);
  const [date, setDate] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const myRequests = useMyRetroactiveRequests(challenge.id, self.userId);

  const min = effectiveEligibleStart(challenge, self.membership);
  const maxExclusive = today; // strictly before today
  const max =
    compareDates(effectiveEligibleEnd(challenge, self.membership), today) < 0
      ? effectiveEligibleEnd(challenge, self.membership)
      : addDays(maxExclusive, -1);

  const valid =
    date !== '' &&
    compareDates(date, min) >= 0 &&
    compareDates(date, today) < 0 &&
    compareDates(date, effectiveEligibleEnd(challenge, self.membership)) <= 0;

  if (compareDates(min, max) > 0) return null; // no past eligible day yet

  return (
    <>
      <button
        type="button"
        className={styles.link}
        onClick={() => setPickOpen(true)}
      >
        Efterregistrera tidigare pass
      </button>

      <Sheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="Efterregistrera tidigare pass"
      >
        <p className={styles.lead}>
          Välj den dag du tränade men inte hann logga. En administratör granskar
          och godkänner passet.
        </p>
        <label className={styles.field}>
          <span>Datum</span>
          <input
            type="date"
            value={date}
            min={min}
            max={max}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => setPickOpen(false)}>
            Avbryt
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              setConfirmed(date);
              setPickOpen(false);
            }}
          >
            Fortsätt
          </Button>
        </div>
      </Sheet>

      {confirmed && (
        <RetroactiveRequestSheet
          open
          onClose={() => setConfirmed(null)}
          challenge={challenge}
          userId={self.userId}
          challengeDate={confirmed}
          requirement={self.requirementByDate.get(confirmed) ?? null}
          onSubmitted={() => void myRequests.refetch()}
        />
      )}
    </>
  );
}
