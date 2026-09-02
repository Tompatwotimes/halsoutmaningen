import { useState } from 'react';
import { formatLongDate } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { SkullIcon, SparkIcon } from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { useStraffbank } from '@/features/straffbanken/useStraffbank';
import { AssignPenaltySheet } from '@/features/straffbanken/AssignPenaltySheet';
import type { InventoryItem } from '@/features/straffbanken/straffbanken';
import styles from './StraffbankenPage.module.css';

export function StraffbankenPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const [assigning, setAssigning] = useState<InventoryItem | null>(null);

  const straffbank = useStraffbank(
    data?.challenge.id ?? null,
    data?.self.userId ?? null,
    data?.self.currentStreak ?? 0,
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Straffbanken" />
        <Skeleton height="9rem" radius="var(--radius-lg)" />
        <Skeleton height="12rem" radius="var(--radius-lg)" />
      </>
    );
  }
  if (isError) {
    return (
      <>
        <PageHeader title="Straffbanken" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data) return <NoMembershipState title="Straffbanken" />;

  const { self, participants, today } = data;
  const nameOf = (id: string) =>
    participants.find((p) => p.userId === id)?.displayName ?? 'Någon';

  return (
    <>
      <PageHeader
        title="Straffbanken"
        subtitle="Streaks ger dig ammunition. Ingen nåd, inga fripass — bara sätt att göra någon annans dag jobbigare."
      />

      {/* --- Received --- */}
      {straffbank.received.length > 0 && (
        <Card variant="raised" padding="lg" className={styles.received}>
          <Badge tone="missed" icon={<SkullIcon />}>
            Du har blivit straffad
          </Badge>
          <ul className={styles.receivedList}>
            {straffbank.received.map((a) => (
              <li key={a.id}>
                <span className={styles.rName}>{a.displayName}</span>
                <span className={styles.rMeta}>
                  {nameOf(a.fromUserId).split(' ')[0]} ·{' '}
                  {capitalize(weekdayLong(a.targetDate))}{' '}
                  {formatLongDate(a.targetDate)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* --- Inventory --- */}
      <Card title={`Din straffbank · ${String(straffbank.totalAvailable)}`}>
        {straffbank.isLoading ? (
          <Skeleton height="6rem" radius="var(--radius-md)" />
        ) : straffbank.inventory.length === 0 ? (
          <EmptyState
            icon={<SkullIcon />}
            title="Tom straffbank"
            body="Håll en streak i gång så börjar det trilla in. 20 dagar i rad ger första straffet."
          />
        ) : (
          <ul className={styles.inv}>
            {straffbank.inventory.map((item) => (
              <li key={item.key} className={styles.invItem}>
                <div className={styles.invBody}>
                  <span className={styles.invName}>{item.displayName}</span>
                  <span className={styles.invCount}>×{item.count}</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<SkullIcon />}
                  onClick={() => setAssigning(item)}
                >
                  Jävlas
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- Next milestone --- */}
      <Card title="Nästa upplåsning">
        {straffbank.nextMilestone ? (
          <p className={styles.next}>
            <SparkIcon className={styles.nextIcon} aria-hidden="true" />
            <span>
              <strong>{straffbank.nextMilestone.daysAway} dagar</strong> till{' '}
              {straffbank.nextMilestone.definition.displayName}
              <span className={styles.nextSub}>
                {' '}
                (vid {straffbank.nextMilestone.definition.unlockStreak} dagars
                streak · din streak: {self.currentStreak})
              </span>
            </span>
          </p>
        ) : (
          <p className={styles.next}>
            Du har låst upp alla straff i den här utmaningen.
          </p>
        )}
      </Card>

      {/* --- Sent --- */}
      {straffbank.sent.length > 0 && (
        <Card title="Straff du delat ut">
          <ul className={styles.sent}>
            {straffbank.sent.map((a) => (
              <li key={a.id} className={styles.sentRow}>
                <span className={styles.sName}>{nameOf(a.toUserId)}</span>
                <span className={styles.sMeta}>
                  {a.displayName} · {a.targetDate < today ? 'utfördes ' : ''}
                  {capitalize(weekdayLong(a.targetDate))}{' '}
                  {formatLongDate(a.targetDate)}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.sentHint}>
            Bara en administratör kan ångra ett utdelat straff.
          </p>
        </Card>
      )}

      {assigning && (
        <AssignPenaltySheet
          open
          onClose={() => setAssigning(null)}
          challengeId={data.challenge.id}
          selfUserId={self.userId}
          item={assigning}
          participants={participants}
        />
      )}
    </>
  );
}
