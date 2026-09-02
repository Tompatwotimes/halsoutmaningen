import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays } from '@/domain/dates';
import { DayState } from '@/domain/dayState';
import { formatPercent } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { CheckIcon, ChevronRightIcon } from '@/components/icons';
import { StatusLegend } from '@/components/status/StatusLegend';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { EntryDetailSheet } from '@/features/challenge/EntryDetailSheet';
import { RecentGrid } from '@/features/group/RecentGrid';
import { recentDates } from '@/features/challenge/labels';
import type { ParticipantView } from '@/features/challenge/types';
import styles from './GroupPage.module.css';

const RECENT_DAY_COUNT = 7;

export function GroupPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const [selected, setSelected] = useState<{
    participant: ParticipantView;
    date: string;
  } | null>(null);

  const dates = useMemo(
    () =>
      data
        ? recentDates(data.today, RECENT_DAY_COUNT, data.challenge.startDate)
        : [],
    [data],
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Gruppen" subtitle="Idag och de senaste dagarna." />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="22rem" radius="var(--radius-lg)" />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader title="Gruppen" />
        <ErrorState
          title="Kunde inte ladda gruppen"
          onRetry={() => void refetch()}
        />
      </>
    );
  }
  if (!data) {
    return <NoMembershipState title="Gruppen" />;
  }

  const { today, challenge, rosterToday } = data;
  const yesterday = addDays(today, -1);

  const doneToday = rosterToday.filter(
    (p) => p.todayState === DayState.Completed,
  );
  const pendingToday = rosterToday
    .filter((p) => p.todayState === DayState.Pending)
    .sort((a, b) => b.currentStreak - a.currentStreak);
  const doneYesterday = rosterToday.filter(
    (p) => p.statesByDate.get(yesterday) === DayState.Completed,
  ).length;

  const ratio =
    rosterToday.length === 0 ? 0 : doneToday.length / rosterToday.length;

  // Self first, then people still pending today, then the rest alphabetically.
  const orderedRows = [...rosterToday].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const aP = a.todayState === DayState.Pending ? 0 : 1;
    const bP = b.todayState === DayState.Pending ? 0 : 1;
    if (aP !== bP) return aP - bP;
    return a.displayName.localeCompare(b.displayName, 'sv');
  });

  const hiddenCount = data.participants.length - rosterToday.length;

  return (
    <>
      <PageHeader
        title="Gruppen"
        subtitle="Idag och de senaste dagarna – vem har tränat och vem saknas."
      />

      <Card variant="raised" padding="lg" className={styles.summary}>
        <p className={styles.headline}>
          <span className="tnum">{doneToday.length}</span>
          <span className={styles.of}>av {rosterToday.length}</span>
        </p>
        <p className={styles.headlineLabel}>har tränat idag</p>
        <ProgressBar value={ratio} tone="accent" label="Klara idag" />
        <div className={styles.summaryMeta}>
          <span>{formatPercent(ratio * 100)} klara</span>
          <span className={styles.dot}>·</span>
          <span>
            Igår: {doneYesterday} av {rosterToday.length}
          </span>
        </div>
      </Card>

      <Card title="Senaste dagarna" padding="md">
        <RecentGrid
          today={today}
          dates={dates}
          participants={orderedRows}
          onOpenEntry={(participant, date) =>
            setSelected({ participant, date })
          }
        />
        <div className={styles.legend}>
          <StatusLegend />
        </div>
        {hiddenCount > 0 && (
          <p className={styles.hiddenNote}>
            {hiddenCount} deltagare visas inte i dagsvyn (pausade eller utanför
            perioden) – alla finns i Översikt.
          </p>
        )}
      </Card>

      <Card
        title="Saknas idag"
        action={
          pendingToday.length > 0 ? (
            <span className={styles.count}>{pendingToday.length}</span>
          ) : undefined
        }
      >
        {pendingToday.length === 0 ? (
          <EmptyState
            icon={<CheckIcon />}
            title="Hela gruppen är klar för idag"
            body="Alla aktiva deltagare har registrerat dagens pass."
          />
        ) : (
          <ul className={styles.missingList}>
            {pendingToday.map((p) => (
              <li key={p.userId} className={styles.missingItem}>
                <Avatar name={p.displayName} size="sm" ring={p.isSelf} />
                <span className={styles.missingName}>{p.displayName}</span>
                {p.currentStreak >= 3 && (
                  <Badge tone="pending" size="sm">
                    {p.currentStreak} dagars streak på spel
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link to="/oversikt" className={styles.fullLink}>
        Se hela utmaningen
        <ChevronRightIcon className={styles.linkIcon} />
      </Link>

      {selected && (
        <EntryDetailSheet
          open
          onClose={() => setSelected(null)}
          challenge={challenge}
          participantName={selected.participant.displayName}
          isSelf={selected.participant.isSelf}
          userId={selected.participant.userId}
          date={selected.date}
        />
      )}
    </>
  );
}
