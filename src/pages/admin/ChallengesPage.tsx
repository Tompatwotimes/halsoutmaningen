import { Link } from 'react-router-dom';
import {
  ChallengeStatus,
  challengeDurationDays,
  type ChallengeConfig,
} from '@/domain/challenge';
import { formatDayMonth } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ChevronRightIcon, PlusIcon } from '@/components/icons';
import { useChallenges } from '@/features/admin/challenges-api';
import styles from './ChallengesPage.module.css';

const STATUS: Record<
  ChallengeConfig['status'],
  { label: string; tone: 'completed' | 'pending' | 'neutral' }
> = {
  draft: { label: 'Utkast', tone: 'pending' },
  active: { label: 'Aktiv', tone: 'completed' },
  completed: { label: 'Avslutad', tone: 'neutral' },
  archived: { label: 'Arkiverad', tone: 'neutral' },
};

export function ChallengesPage() {
  const { data, isLoading, isError, refetch } = useChallenges();

  const groups = [
    { key: 'active', label: 'Aktiva', status: ChallengeStatus.Active },
    { key: 'draft', label: 'Utkast', status: ChallengeStatus.Draft },
    { key: 'completed', label: 'Avslutade', status: ChallengeStatus.Completed },
    { key: 'archived', label: 'Arkiverade', status: ChallengeStatus.Archived },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Utmaningar"
        subtitle="Skapa, konfigurera, aktivera och avsluta utmaningar."
        action={
          <Link to="/admin/utmaningar/ny">
            <Button size="sm" icon={<PlusIcon />}>
              Skapa
            </Button>
          </Link>
        }
      />
      <p className={styles.back}>
        <Link to="/admin">← Administration</Link>
      </p>

      {isLoading && <Spinner label="Laddar utmaningar…" />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data &&
        groups.map((g) => {
          const rows = data.filter((c) => c.status === g.status);
          if (rows.length === 0) return null;
          return (
            <Card key={g.key} title={g.label}>
              <ul className={styles.list}>
                {rows.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/admin/utmaningar/${c.id}`}
                      className={styles.row}
                    >
                      <span className={styles.rowBody}>
                        <span className={styles.name}>{c.name}</span>
                        <span className={styles.meta}>
                          {formatDayMonth(c.startDate)} –{' '}
                          {formatDayMonth(c.endDate)} ·{' '}
                          {challengeDurationDays(c)} dagar · {c.requiredMinutes}{' '}
                          min · {c.missedDayCost} kr
                        </span>
                      </span>
                      <Badge tone={STATUS[c.status].tone} size="sm">
                        {STATUS[c.status].label}
                      </Badge>
                      <ChevronRightIcon className={styles.chev} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}

      {data?.length === 0 && (
        <Card>
          <p className={styles.empty}>
            Inga utmaningar ännu.{' '}
            <Link to="/admin/utmaningar/ny">Skapa den första</Link>.
          </p>
        </Card>
      )}
    </>
  );
}
