import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import {
  ChevronRightIcon,
  GroupIcon,
  OverviewIcon,
  ShieldIcon,
} from '@/components/icons';
import { challengeDurationDays } from '@/domain/challenge';
import { formatDayMonth } from '@/domain/format';
import { useChallenges } from '@/features/admin/challenges-api';
import styles from './AdminPage.module.css';

const STATUS_TONE = {
  active: 'completed',
  draft: 'pending',
  completed: 'neutral',
  archived: 'neutral',
} as const;

const STATUS_LABEL = {
  active: 'Aktiv',
  draft: 'Utkast',
  completed: 'Avslutad',
  archived: 'Arkiverad',
} as const;

export function AdminPage() {
  const { data: challenges, isLoading } = useChallenges();

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Översikt"
        subtitle="Deltagare, utmaningar och granskningslogg."
      />

      <nav className={styles.tiles}>
        <Link to="/admin/deltagare" className={styles.tile}>
          <span className={styles.tileIcon}>
            <GroupIcon />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileTitle}>Deltagare</span>
            <span className={styles.tileText}>
              Bjud in deltagare, hantera medlemskap och deltagandeperioder.
            </span>
          </span>
          <ChevronRightIcon className={styles.tileChevron} />
        </Link>

        <span className={`${styles.tile} ${styles.tileDisabled}`}>
          <span className={styles.tileIcon}>
            <OverviewIcon />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileTitle}>
              Utmaningar
              <Badge tone="neutral" size="sm">
                Fas 9
              </Badge>
            </span>
            <span className={styles.tileText}>
              Skapa och konfigurera utmaningar utan kodändring.
            </span>
          </span>
        </span>

        <span className={`${styles.tile} ${styles.tileDisabled}`}>
          <span className={styles.tileIcon}>
            <ShieldIcon />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileTitle}>
              Granskningslogg
              <Badge tone="neutral" size="sm">
                Fas 9
              </Badge>
            </span>
            <span className={styles.tileText}>
              Ändringar av medlemskap, regler och ogiltigförklarade pass.
            </span>
          </span>
        </span>
      </nav>

      <Card title="Utmaningar">
        {isLoading ? (
          <Spinner label="Laddar utmaningar…" />
        ) : challenges && challenges.length > 0 ? (
          <ul className={styles.challengeList}>
            {challenges.map((c) => (
              <li key={c.id} className={styles.challengeRow}>
                <div>
                  <span className={styles.challengeName}>{c.name}</span>
                  <span className={styles.challengeMeta}>
                    {formatDayMonth(c.startDate)} – {formatDayMonth(c.endDate)}{' '}
                    · {challengeDurationDays(c)} dagar
                  </span>
                </div>
                <Badge tone={STATUS_TONE[c.status]} size="sm">
                  {STATUS_LABEL[c.status]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Inga utmaningar ännu.</p>
        )}
      </Card>
    </>
  );
}
