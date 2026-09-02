import { useQuery } from '@tanstack/react-query';
import { ChallengeStatus } from '@/domain/challenge';
import { compareDates } from '@/domain/dates';
import { formatDayMonth } from '@/domain/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { fetchMyMemberships } from './challenge-api';
import styles from './MyChallengesCard.module.css';

interface Props {
  userId: string;
  today: string;
  /** The id of the challenge the app is currently focused on. */
  currentChallengeId: string;
}

type Bucket = 'current' | 'upcoming' | 'past';

function bucketOf(
  status: ChallengeStatus,
  startDate: string,
  today: string,
  isCurrent: boolean,
): Bucket {
  if (
    status === ChallengeStatus.Completed ||
    status === ChallengeStatus.Archived
  )
    return 'past';
  if (isCurrent) return 'current';
  if (compareDates(today, startDate) < 0) return 'upcoming';
  return status === ChallengeStatus.Active ? 'current' : 'upcoming';
}

const BUCKET_LABEL: Record<Bucket, string> = {
  current: 'Pågående',
  upcoming: 'Kommande',
  past: 'Avslutade',
};

/**
 * Read-oriented list of every challenge the participant is/has been in, clearly
 * separating the current one from upcoming and historical ones. The app's
 * "primary challenge" focus is unchanged — this is a switcher for context, not
 * a second active dataset.
 */
export function MyChallengesCard({ userId, today, currentChallengeId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['challenge', 'my-memberships', userId],
    queryFn: () => fetchMyMemberships(userId),
    staleTime: 60_000,
  });

  if (isLoading)
    return (
      <Card title="Mina utmaningar">
        <Spinner label="Laddar…" />
      </Card>
    );
  if (!data || data.length <= 1) return null;

  const rows = data
    .map((m) => ({
      m,
      bucket: bucketOf(
        m.challenge.status,
        m.challenge.startDate,
        today,
        m.challenge.id === currentChallengeId,
      ),
    }))
    .sort((a, b) =>
      a.m.challenge.startDate < b.m.challenge.startDate ? 1 : -1,
    );

  const buckets: Bucket[] = ['current', 'upcoming', 'past'];

  return (
    <Card title="Mina utmaningar">
      {buckets.map((bk) => {
        const items = rows.filter((r) => r.bucket === bk);
        if (items.length === 0) return null;
        return (
          <div key={bk} className={styles.group}>
            <p className={styles.groupLabel}>{BUCKET_LABEL[bk]}</p>
            {items.map(({ m }) => (
              <div key={m.challenge.id} className={styles.row}>
                <span>
                  <span className={styles.name}>{m.challenge.name}</span>
                  <span className={styles.meta}>
                    {formatDayMonth(m.challenge.startDate)} –{' '}
                    {formatDayMonth(m.challenge.endDate)}
                  </span>
                </span>
                {m.challenge.id === currentChallengeId && (
                  <Badge tone="accent" size="sm">
                    Visas nu
                  </Badge>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}
