import { useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { compareDates } from '@/domain/dates';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { formatLongDate } from '@/domain/format';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useActivateChallenge } from './activate-challenge-api';
import styles from './ActivateChallengeControl.module.css';

interface Props {
  challenge: ChallengeConfig;
}

/**
 * Admin control to activate a `draft` challenge (Part 3 of the real-data
 * phase). Participants cannot log training until the challenge is active
 * (`training_entries_guard`), so this is a required step before real use —
 * but it is not a rules change: once a challenge has started in its own
 * timezone, the rule fields are already locked (`challenges_guard`)
 * regardless of status, which this dialog explains rather than hides.
 */
export function ActivateChallengeControl({ challenge }: Props) {
  const [open, setOpen] = useState(false);
  const mutation = useActivateChallenge();

  const today = currentPlainDateInTimeZone(challenge.timeZone);
  const alreadyStarted = compareDates(today, challenge.startDate) >= 0;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Aktivera
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Aktivera utmaningen?"
      >
        <p className={styles.body}>
          Detta gör <strong>{challenge.name}</strong> synlig och loggbar för
          deltagarna. Innan dess kan ingen delta skapa träningspass.
        </p>
        <p className={styles.body}>
          {alreadyStarted ? (
            <>
              Utmaningens regler (starttid {formatLongDate(challenge.startDate)}
              , {challenge.requiredMinutes} min/dag, bildkrav, kostnad per
              missad dag) är redan låsta eftersom startdatumet har passerat —
              aktivering ändrar inga regler, bara statusen.
            </>
          ) : (
            <>
              Reglerna låses automatiskt när utmaningen startar (
              {formatLongDate(challenge.startDate)}) eller så fort statusen inte
              längre är utkast — beroende på vad som inträffar först.
            </>
          )}
        </p>
        {mutation.isError && (
          <p className={styles.error} role="alert">
            Aktiveringen misslyckades. Försök igen.
          </p>
        )}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Avbryt
          </Button>
          <Button
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(challenge.id, {
                onSuccess: () => setOpen(false),
              })
            }
          >
            Ja, aktivera
          </Button>
        </div>
      </Sheet>
    </>
  );
}
