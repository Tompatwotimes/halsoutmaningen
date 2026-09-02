import { useMemo, useRef, useState } from 'react';
import { challengeProgress } from '@/domain/challenge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { StatusLegend } from '@/components/status/StatusLegend';
import { FlagIcon } from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { EntryDetailSheet } from '@/features/challenge/EntryDetailSheet';
import {
  MatrixGrid,
  type MatrixGridHandle,
} from '@/features/overview/MatrixGrid';
import type { ParticipantView } from '@/features/challenge/types';
import styles from './OverviewPage.module.css';

type SortKey = 'name' | 'result';

export function OverviewPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const gridRef = useRef<MatrixGridHandle>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [selected, setSelected] = useState<{
    participant: ParticipantView;
    date: string;
  } | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = [...data.participants];
    if (sort === 'result') {
      return list.sort((a, b) => b.completionRate - a.completionRate);
    }
    return list.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'sv');
    });
  }, [data, sort]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Översikt" subtitle="Hela utmaningen." />
        <Skeleton height="5rem" radius="var(--radius-lg)" />
        <Skeleton height="24rem" radius="var(--radius-lg)" />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <PageHeader title="Översikt" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data) {
    return <NoMembershipState title="Översikt" />;
  }

  const progress = challengeProgress(data.challenge, data.today);

  return (
    <>
      <PageHeader
        title="Översikt"
        subtitle="Alla deltagare och alla dagar i utmaningen."
      />

      <Card padding="md" className={styles.summary}>
        <div>
          <p className={styles.progressValue}>
            <span className="tnum">Dag {progress.elapsedDays}</span>
            <span className={styles.progressOf}>av {progress.totalDays}</span>
          </p>
          <p className={styles.progressSub}>
            {data.participants.length} deltagare · {progress.remainingDays}{' '}
            dagar kvar
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<FlagIcon />}
          onClick={() => gridRef.current?.scrollToToday()}
        >
          Hoppa till idag
        </Button>
      </Card>

      <Card padding="md" className={styles.matrixCard}>
        <div className={styles.controls}>
          <SegmentedControl
            ariaLabel="Sortera deltagare"
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'name', label: 'Namn' },
              { value: 'result', label: 'Resultat' },
            ]}
          />
        </div>
        <MatrixGrid
          challenge={data.challenge}
          today={data.today}
          participants={rows}
          handleRef={gridRef}
          onOpenEntry={(participant, date) =>
            setSelected({ participant, date })
          }
        />
        <div className={styles.legend}>
          <StatusLegend />
        </div>
      </Card>

      {selected && (
        <EntryDetailSheet
          open
          onClose={() => setSelected(null)}
          challenge={data.challenge}
          participantName={selected.participant.displayName}
          isSelf={selected.participant.isSelf}
          userId={selected.participant.userId}
          date={selected.date}
        />
      )}
    </>
  );
}
