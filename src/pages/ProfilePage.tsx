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
import { ClockIcon, ShieldIcon } from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { useProfile } from '@/features/profile/useProfile';
import { useAuth } from '@/features/auth/useAuth';
import { EntryDetailSheet } from '@/features/challenge/EntryDetailSheet';
import { LiabilityCard } from '@/features/challenge/LiabilityCard';
import { PersonalCalendar } from '@/features/profile/PersonalCalendar';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { data, isLoading, isError, refetch } = useChallengeData();
  const { isAdmin } = useProfile();
  const { signOut } = useAuth();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const progress = useMemo(
    () => (data ? challengeProgress(data.challenge, data.today) : null),
    [data],
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Profil" />
        <Skeleton height="6rem" radius="var(--radius-lg)" />
        <Skeleton height="12rem" radius="var(--radius-lg)" />
        <Skeleton height="14rem" radius="var(--radius-lg)" />
      </>
    );
  }

  if (isError || !data || !progress) {
    return (
      <>
        <PageHeader title="Profil" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }

  const { self, challenge, today } = data;
  const { membership, liability } = self;

  const windowText =
    membership.participationStartDate === challenge.startDate &&
    membership.participationEndDate === null
      ? 'Deltar hela perioden'
      : membership.participationEndDate === null
        ? `Med sedan ${formatDayMonth(membership.participationStartDate)}`
        : `Deltar ${formatDayMonth(membership.participationStartDate)} – ${formatDayMonth(membership.participationEndDate)}`;

  const history = [...data.entries.values()]
    .filter((e) => e.userId === self.userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  const decidedElapsed = liability.completedDays + liability.missedDays;

  return (
    <>
      <PageHeader title="Profil" />

      <Card variant="raised" padding="lg" className={styles.identity}>
        <Avatar name={self.displayName} size="xl" ring />
        <div className={styles.identityBody}>
          <p className={styles.name}>{self.displayName}</p>
          <p className={styles.window}>{windowText}</p>
          <div className={styles.tags}>
            {isAdmin && (
              <Badge tone="accent" size="sm" icon={<ShieldIcon />}>
                Administratör
              </Badge>
            )}
          </div>
        </div>
      </Card>

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

      <Card title="Din kalender">
        <PersonalCalendar
          challenge={challenge}
          today={today}
          participant={self}
          onOpenDay={setOpenDate}
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
                  onClick={() => setOpenDate(e.date)}
                >
                  <div className={styles.historyMain}>
                    <span className={styles.historyActivity}>{e.activity}</span>
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

      {openDate && (
        <EntryDetailSheet
          open
          onClose={() => setOpenDate(null)}
          challenge={challenge}
          participantName={self.displayName}
          isSelf
          date={openDate}
          entry={data.getEntry(self.userId, openDate)}
        />
      )}
    </>
  );
}
