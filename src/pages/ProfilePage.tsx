import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { challengeProgress } from '@/domain/challenge';
import { formatMinutes, formatPercent, formatDayMonth } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { StatTile } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import {
  ChevronRightIcon,
  ClockIcon,
  GroupIcon,
  ShieldIcon,
  SkullIcon,
} from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { useProfile } from '@/features/profile/useProfile';
import { useAuth } from '@/features/auth/useAuth';
import { EntryDetailSheet } from '@/features/challenge/EntryDetailSheet';
import { LiabilityCard } from '@/features/challenge/LiabilityCard';
import { MyChallengesCard } from '@/features/challenge/MyChallengesCard';
import { PersonalCalendar } from '@/features/profile/PersonalCalendar';
import { useStraffbank } from '@/features/straffbanken/useStraffbank';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import type { SelfEntry } from '@/features/challenge/types';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const { profile, isAdmin } = useProfile();
  const { signOut } = useAuth();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const progress = useMemo(
    () => (data ? challengeProgress(data.challenge, data.today) : null),
    [data],
  );

  const displayName = data?.self.displayName ?? profile?.displayName ?? '';

  const windowText = data
    ? data.self.membership.participationStartDate ===
        data.challenge.startDate &&
      data.self.membership.participationEndDate === null
      ? 'Deltar hela perioden'
      : data.self.membership.participationEndDate === null
        ? `Med sedan ${formatDayMonth(data.self.membership.participationStartDate)}`
        : `Deltar ${formatDayMonth(data.self.membership.participationStartDate)} – ${formatDayMonth(data.self.membership.participationEndDate)}`
    : null;

  const history = data ? data.selfEntries.slice(0, 6) : [];

  return (
    <>
      <PageHeader title="Profil" />

      {isLoading ? (
        <Skeleton height="6rem" radius="var(--radius-lg)" />
      ) : (
        <Card variant="raised" padding="lg" className={styles.identity}>
          <Avatar name={displayName || '?'} size="xl" ring />
          <div className={styles.identityBody}>
            <p className={styles.name}>{displayName}</p>
            {windowText && <p className={styles.window}>{windowText}</p>}
            <div className={styles.tags}>
              {isAdmin && (
                <Badge tone="accent" size="sm" icon={<ShieldIcon />}>
                  Administratör
                </Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {isLoading && (
        <>
          <Skeleton height="12rem" radius="var(--radius-lg)" />
          <Skeleton height="14rem" radius="var(--radius-lg)" />
        </>
      )}

      {!isLoading && isError && (
        <ErrorState
          title="Kunde inte ladda utmaningsdata"
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && !data && (
        <Card>
          <EmptyState
            icon={<GroupIcon />}
            title="Du är inte med i någon utmaning ännu"
            body={
              isAdmin
                ? 'Lägg till dig själv som deltagare under Administration → Deltagare.'
                : 'Be en administratör lägga till dig i en utmaning.'
            }
            action={
              isAdmin ? (
                <Link to="/admin/deltagare">
                  <Button variant="secondary">Till Deltagare</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      )}

      {!isLoading && !isError && data && progress && (
        <ChallengeSection
          data={data}
          progress={progress}
          history={history}
          onOpenDay={setOpenDate}
        />
      )}

      {isAdmin && (
        <Link to="/admin" className={styles.adminLink}>
          <ShieldIcon className={styles.adminIcon} />
          Till administration
        </Link>
      )}

      <div className={styles.signOutRow}>
        <Button
          variant="ghost"
          loading={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          Logga ut
        </Button>
      </div>

      {data && openDate && (
        <EntryDetailSheet
          open
          onClose={() => setOpenDate(null)}
          challenge={data.challenge}
          participantName={data.self.displayName}
          isSelf
          userId={data.self.userId}
          date={openDate}
          requirement={data.self.requirementByDate.get(openDate) ?? null}
        />
      )}
    </>
  );
}

function ChallengeSection({
  data,
  progress,
  history,
  onOpenDay,
}: {
  data: NonNullable<ReturnType<typeof useChallengeData>['data']>;
  progress: ReturnType<typeof challengeProgress>;
  history: SelfEntry[];
  onOpenDay: (date: string) => void;
}) {
  const { self, challenge, today } = data;
  const { liability } = self;
  const decidedElapsed = liability.completedDays + liability.missedDays;
  const straffbank = useStraffbank(
    challenge.id,
    self.userId,
    self.currentStreak,
  );

  return (
    <>
      <Link to="/straffbanken" className={styles.straffLink}>
        <Card padding="md" className={styles.straffCard}>
          <span className={styles.straffIcon} aria-hidden="true">
            <SkullIcon />
          </span>
          <span className={styles.straffBody}>
            <span className={styles.straffTitle}>Straffbanken</span>
            <span className={styles.straffText}>
              {straffbank.totalAvailable} redo ·{' '}
              {straffbank.received.length > 0
                ? `${straffbank.received.length} straff mot dig`
                : straffbank.nextMilestone
                  ? `nästa vid ${straffbank.nextMilestone.definition.unlockStreak} d`
                  : 'alla upplåsta'}
            </span>
          </span>
          <ChevronRightIcon className={styles.straffChev} />
        </Card>
      </Link>

      <div className={styles.heroRow}>
        <Card padding="lg" className={styles.ringCard}>
          <ProgressRing
            value={self.completionRate}
            size={148}
            stroke={12}
            tone="completed"
            label="Genomförandegrad"
          >
            <span className={styles.ringPct}>
              {formatPercent(self.completionRate * 100)}
            </span>
            <span className={styles.ringSub}>
              {liability.completedDays}/{decidedElapsed} dagar
            </span>
          </ProgressRing>
        </Card>

        <div className={styles.streakCol}>
          <Card padding="md" className={styles.streakCard}>
            <span className={styles.miniLabel}>Nuvarande streak</span>
            <span className={`${styles.streakBig} tnum`}>
              {self.currentStreak}
            </span>
            <span className={styles.miniHint}>dagar i rad</span>
          </Card>
          <Card padding="md" className={styles.streakCard}>
            <span className={styles.miniLabel}>Längsta streak</span>
            <span className={`${styles.streakBig} tnum`}>
              {self.longestStreak}
            </span>
            <span className={styles.miniHint}>dagar</span>
          </Card>
        </div>
      </div>

      <div className={styles.statGrid}>
        <StatTile
          label="Genomförda"
          value={liability.completedDays}
          unit="dagar"
          tone="completed"
        />
        <StatTile
          label="Missade"
          value={liability.missedDays}
          unit="dagar"
          tone={liability.missedDays > 0 ? 'missed' : 'default'}
        />
        <StatTile
          label="Dagar hittills"
          value={progress.elapsedDays}
          unit={`av ${String(progress.totalDays)}`}
          icon={<ClockIcon />}
        />
        <StatTile
          label="Kvar"
          value={liability.pendingDays + liability.futureDays}
          unit="dagar"
        />
      </div>

      <LiabilityCard
        liability={liability}
        missedDayCost={challenge.missedDayCost}
      />

      <MyChallengesCard
        userId={self.userId}
        today={today}
        currentChallengeId={challenge.id}
      />

      <Card title="Din kalender">
        <PersonalCalendar
          challenge={challenge}
          today={today}
          participant={self}
          onOpenDay={onOpenDay}
        />
      </Card>

      <Card title="Senaste passen">
        {history.length === 0 ? (
          <EmptyState
            title="Inga pass ännu"
            body="Dina registrerade pass dyker upp här."
          />
        ) : (
          <ul className={styles.history}>
            {history.map((e) => (
              <li key={e.entryId}>
                <button
                  type="button"
                  className={styles.historyRow}
                  onClick={() => onOpenDay(e.date)}
                >
                  <div className={styles.historyMain}>
                    <span className={styles.historyActivity}>
                      {e.activity ?? 'Träning'}
                    </span>
                    <span className={styles.historyDate}>
                      {capitalize(weekdayLong(e.date))} {formatDayMonth(e.date)}
                    </span>
                  </div>
                  <span className={`${styles.historyDuration} tnum`}>
                    {formatMinutes(e.durationMinutes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
