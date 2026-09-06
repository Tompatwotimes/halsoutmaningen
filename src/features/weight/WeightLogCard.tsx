import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { formatDayMonth } from '@/domain/format';
import { useLogWeightEntry, useMyWeightEntries } from './useWeight';
import styles from './WeightLogCard.module.css';

/**
 * Optional daily weight logging. Today's value is editable in place all day;
 * once the challenge day rolls over the server won't touch the old row (this
 * card just re-primes from `today`). There is deliberately NO date input of
 * any kind — backdating isn't offered as a UI affordance, mirroring the RPC
 * having no date parameter.
 */
export function WeightLogCard({
  challengeId,
  userId,
  today,
}: {
  challengeId: string;
  userId: string;
  today: string;
}) {
  const { data, isLoading, isError } = useMyWeightEntries(challengeId, userId);
  const log = useLogWeightEntry();
  const [draft, setDraft] = useState('');

  const entries = useMemo(() => data ?? [], [data]);
  const todayEntry = entries.find((e) => e.entryDate === today) ?? null;
  const history = entries.filter((e) => e.entryDate !== today);

  const parsed = Number(draft.replace(',', '.'));
  const canSubmit =
    draft.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= 400 &&
    !log.isPending;

  const spark = useMemo(() => sparklinePoints(entries), [entries]);

  return (
    <Card title="Dagens vikt">
      {isLoading ? (
        <Skeleton height="4rem" radius="var(--radius-md)" />
      ) : isError ? (
        <ErrorState
          title="Viktloggen kunde inte hämtas"
          message="Försök igen om en stund."
        />
      ) : (
        <>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) {
                log.mutate({ challengeId, weightKg: parsed });
                setDraft('');
              }
            }}
          >
            <div className={styles.inputRow}>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="1"
                max="400"
                aria-label="Dagens vikt i kilo"
                placeholder={
                  todayEntry ? String(todayEntry.weightKg) : 'kg idag'
                }
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                className={styles.input}
              />
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {todayEntry ? 'Spara' : 'Logga'}
              </Button>
            </div>
            {todayEntry && (
              <p className={styles.todayNote}>
                Idag: {todayEntry.weightKg} kg — går att ändra hela dagen.
              </p>
            )}
          </form>

          {spark && (
            <svg
              className={styles.spark}
              viewBox="0 0 100 28"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline points={spark} />
            </svg>
          )}

          {history.length === 0 ? (
            <EmptyState title="Ingen tidigare viktlogg än" />
          ) : (
            <ul className={styles.history}>
              {history.map((e) => (
                <li
                  key={e.id}
                  className={styles.historyRow}
                  data-testid="weight-history-row"
                >
                  <span className={styles.historyDate}>
                    {formatDayMonth(e.entryDate)}
                  </span>
                  <span className={styles.historyKg}>{e.weightKg} kg</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function sparklinePoints(
  entries: readonly { entryDate: string; weightKg: number }[],
): string | null {
  if (entries.length < 2) return null;
  const asc = [...entries].sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));
  const values = asc.map((e) => e.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return asc
    .map((e, i) => {
      const x = (i / (asc.length - 1)) * 100;
      const y = 26 - ((e.weightKg - min) / span) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
