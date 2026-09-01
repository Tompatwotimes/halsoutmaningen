import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { challengeProgress } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { formatMinutes, formatPercent } from '@/domain/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatTile } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import {
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  LogIcon,
} from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { LiabilityCard } from '@/features/challenge/LiabilityCard';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { formatDayMonth } from '@/domain/format';
import styles from './HomePage.module.css';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'God natt';
  if (h < 10) return 'God morgon';
  if (h < 14) return 'Hej';
  if (h < 18) return 'God eftermiddag';
  return 'God kväll';
}

export function HomePage() {
  const { data, isLoading, isError, refetch } = useChallengeData();

  const progress = useMemo(
    () => (data ? challengeProgress(data.challenge, data.today) : null),
    [data],
  );

  if (isLoading) return <HomeSkeleton />;
  if (isError || !data || !progress) {
    return (
      <ErrorState
        title="Kunde inte ladda din översikt"
        message="Det gick inte att hämta utmaningsdata just nu."
        onRetry={() => void refetch()}
      />
    );
  }

  const { self, challenge, today } = data;
  const todayEntry = data.getEntry(self.userId, today);
  const completedToday = self.todayState === DayState.Completed;

  const roster = data.rosterToday;
  const doneToday = roster.filter(
    (p) => p.todayState === DayState.Completed,
  );
  const pendingToday = roster.filter(
    (p) => p.todayState === DayState.Pending,
  );
  const groupRatio = roster.length === 0 ? 0 : doneToday.length / roster.length;

  const firstName = self.displayName.split(' ')[0] ?? self.displayName;

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <span className={styles.date}>
          {capitalize(weekdayLong(today))} {formatDayMonth(today)}
        </span>
        <h1 className={styles.greeting}>
          {greeting()}, {firstName}
        </h1>
      </header>

      {/* --- Today hero --- */}
      <Card
        variant="gradient"
        padding="lg"
        className={styles.hero}
      >
        {completedToday && todayEntry ? (
          <>
            <Badge tone="completed" icon={<CheckIcon />}>
              Klart för idag
            </Badge>
            <p className={styles.heroLead}>
              {todayEntry.activity} · {formatMinutes(todayEntry.durationMinutes)}
            </p>
            <p className={styles.heroSub}>
              Bra jobbat. Din streak är uppe i{' '}
              <strong>{self.currentStreak} dagar</strong>.
            </p>
            <Link to="/gruppen" className={styles.heroLink}>
              Se hur gruppen ligger till
              <ChevronRightIcon className={styles.linkIcon} />
            </Link>
          </>
        ) : (
          <>
            <Badge tone="pending" dot>
              Dagens pass kvar
            </Badge>
            <p className={styles.heroLead}>Du har inte tränat idag</p>
            <p className={styles.heroSub}>
              {formatMinutes(challenge.requiredMinutes)} krävs
              {challenge.proofRequired ? ' · bildbevis behövs' : ''}
            </p>
            <Link to="/logga" className={styles.heroCta}>
              <Button size="lg" fullWidth icon={<LogIcon />}>
                Logga träning
              </Button>
            </Link>
          </>
        )}
      </Card>

      {/* --- Streak + challenge progress --- */}
      <div className={styles.duo}>
        <Card className={styles.streakCard} padding="md">
          <span className={styles.miniLabel}>Streak</span>
          <p className={styles.streakValue}>
            <span className="tnum">{self.currentStreak}</span>
            <span className={styles.streakUnit}>
              {self.currentStreak === 1 ? 'dag' : 'dagar'} i rad
            </span>
          </p>
          <span className={styles.streakHint}>
            Längsta: {self.longestStreak} dagar
          </span>
        </Card>

        <Card className={styles.progressCard} padding="md">
          <ProgressRing
            value={progress.elapsedDays / progress.totalDays}
            size={112}
            stroke={9}
            label="Utmaningens gång"
          >
            <span className={styles.ringValue}>
              <span className="tnum">{progress.elapsedDays}</span>
            </span>
            <span className={styles.ringUnit}>av {progress.totalDays} dgr</span>
          </ProgressRing>
          <span className={styles.progressHint}>
            {progress.remainingDays} dagar kvar
          </span>
        </Card>
      </div>

      {/* --- Group today --- */}
      <Card
        title="Gruppen idag"
        action={
          <Link to="/gruppen" className={styles.cardLink}>
            Gruppen <ChevronRightIcon className={styles.linkIcon} />
          </Link>
        }
      >
        <p className={styles.groupHeadline}>
          <span className="tnum">{doneToday.length}</span>
          <span className={styles.groupOf}>av {roster.length}</span>
          har tränat idag
        </p>
        <ProgressBar
          value={groupRatio}
          tone="accent"
          label={`${String(doneToday.length)} av ${String(roster.length)} klara idag`}
        />
        <div className={styles.avatarRow}>
          {doneToday.slice(0, 9).map((p) => (
            <Avatar key={p.userId} name={p.displayName} size="xs" />
          ))}
          {doneToday.length > 9 && (
            <span className={styles.avatarMore}>
              +{doneToday.length - 9}
            </span>
          )}
        </div>
        {pendingToday.length > 0 && (
          <p className={styles.remaining}>
            <span className={styles.remainingLabel}>Återstår:</span>{' '}
            {pendingToday
              .slice(0, 4)
              .map((p) => p.displayName.split(' ')[0])
              .join(', ')}
            {pendingToday.length > 4 && ` +${pendingToday.length - 4}`}
          </p>
        )}
      </Card>

      {/* --- Personal standing --- */}
      <Card
        title="Din status"
        action={
          <Link to="/profil" className={styles.cardLink}>
            Profil <ChevronRightIcon className={styles.linkIcon} />
          </Link>
        }
      >
        <div className={styles.statGrid}>
          <StatTile
            label="Genomfört"
            value={formatPercent(self.completionRate * 100)}
            hint={`${self.liability.completedDays} av ${self.decidedDays} dagar`}
            tone="accent"
          />
          <StatTile
            label="Missade"
            value={self.liability.missedDays}
            unit={self.liability.missedDays === 1 ? 'dag' : 'dagar'}
            tone={self.liability.missedDays > 0 ? 'missed' : 'default'}
          />
          <StatTile
            label="Kvar i utmaningen"
            value={self.liability.pendingDays + self.liability.futureDays}
            unit="dagar"
            icon={<ClockIcon />}
          />
        </div>
      </Card>

      <LiabilityCard
        liability={self.liability}
        missedDayCost={challenge.missedDayCost}
      />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className={styles.page}>
      <Skeleton width="9rem" height="0.8rem" />
      <Skeleton width="14rem" height="1.7rem" />
      <Skeleton height="10.5rem" radius="var(--radius-lg)" />
      <div className={styles.duo}>
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
      </div>
      <Skeleton height="12rem" radius="var(--radius-lg)" />
      <Skeleton height="9rem" radius="var(--radius-lg)" />
    </div>
  );
}
