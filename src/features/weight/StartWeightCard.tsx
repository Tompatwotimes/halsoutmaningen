import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { hoursUntilLock, isStartWeightLocked } from './weight';
import { useMyWeightProfile, useSetStartWeight } from './useWeight';
import styles from './StartWeightCard.module.css';

/**
 * Start weight, under Profile. Three states derived purely from the fetched
 * `startWeightLockedAt` (no network call to decide which): not-yet-set →
 * editable; inside the 24h window → editable + "låses om Xh"; locked →
 * read-only "låst" with the value (correction is an admin action).
 */
export function StartWeightCard({
  challengeId,
  userId,
}: {
  challengeId: string;
  userId: string;
}) {
  const { data, isLoading, isError } = useMyWeightProfile(challengeId, userId);
  const save = useSetStartWeight();
  const [draft, setDraft] = useState('');

  const nowIso = new Date().toISOString();
  const lockedAt = data?.startWeightLockedAt ?? null;
  const locked = isStartWeightLocked(lockedAt, nowIso);
  const parsed = Number(draft.replace(',', '.'));
  const canSave =
    draft.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= 400 &&
    !save.isPending;

  return (
    <Card title="Startvikt">
      {isLoading ? (
        <Skeleton height="3rem" radius="var(--radius-md)" />
      ) : isError ? (
        <ErrorState
          title="Vikten kunde inte hämtas"
          message="Försök igen om en stund."
        />
      ) : locked && data?.startWeightKg != null ? (
        <div className={styles.row}>
          <p className={styles.value}>{data.startWeightKg} kg</p>
          <span className={styles.locked}>Låst</span>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) {
              save.mutate({ challengeId, weightKg: parsed });
              setDraft('');
            }
          }}
        >
          {data?.startWeightKg != null && (
            <p className={styles.current}>Nuvarande: {data.startWeightKg} kg</p>
          )}
          <div className={styles.inputRow}>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="1"
              max="400"
              aria-label="Startvikt i kilo"
              placeholder="kg"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={styles.input}
            />
            <Button type="submit" size="sm" disabled={!canSave}>
              Spara
            </Button>
          </div>
          {lockedAt != null && !locked && (
            <p className={styles.countdown}>
              Låses om {Math.ceil(hoursUntilLock(lockedAt, nowIso))} h
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
