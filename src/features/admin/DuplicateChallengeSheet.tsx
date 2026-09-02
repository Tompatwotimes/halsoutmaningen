import { useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { challengeDurationDays } from '@/domain/challenge';
import { addDays } from '@/domain/dates';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import {
  duplicateChallenge,
  useChallengeAdminMutation,
} from './challenge-admin-api';
import styles from './DuplicateChallengeSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  source: ChallengeConfig;
  onCreated: (newId: string) => void;
}

export function DuplicateChallengeSheet({
  open,
  onClose,
  source,
  onCreated,
}: Props) {
  const days = challengeDurationDays(source);
  const nextStart = addDays(currentPlainDateInTimeZone(source.timeZone), 30);
  const [name, setName] = useState(`${source.name} (kopia)`);
  const [startDate, setStartDate] = useState(nextStart);
  const [endDate, setEndDate] = useState(addDays(nextStart, days - 1));
  const [copyRoster, setCopyRoster] = useState(false);

  const mutation = useChallengeAdminMutation(duplicateChallenge);
  const valid = name.trim().length >= 1 && startDate <= endDate;

  async function submit() {
    if (!valid) return;
    try {
      const created = await mutation.mutateAsync({
        sourceId: source.id,
        name: name.trim(),
        startDate,
        endDate,
        copyRoster,
      });
      onCreated(created.id);
    } catch {
      /* surfaced */
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Skapa ny från denna">
      <p className={styles.lead}>
        Kopierar regler ({source.requiredMinutes} min/dag,{' '}
        {source.missedDayCost} kr, bildkrav) och alla straffdefinitioner till
        ett nytt utkast. Träning, bevis, intjänade straff och historik kopieras{' '}
        <strong>inte</strong>.
      </p>

      <label className={styles.field}>
        <span>Namn</span>
        <input
          type="text"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Slut</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={copyRoster}
          onChange={(e) => setCopyRoster(e.target.checked)}
        />
        <span>Kopiera deltagarlistan (samma personer, ny period)</span>
      </label>

      {mutation.error && (
        <p className={styles.err}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Kunde inte kopiera utmaningen.'}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button
          loading={mutation.isPending}
          disabled={!valid}
          onClick={() => void submit()}
        >
          Skapa utkast
        </Button>
      </div>
    </Sheet>
  );
}
