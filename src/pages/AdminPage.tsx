import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import {
  ChevronRightIcon,
  ClockIcon,
  GroupIcon,
  OverviewIcon,
  ShieldIcon,
} from '@/components/icons';
import { ChallengeStatus, challengeDurationDays } from '@/domain/challenge';
import { formatDayMonth } from '@/domain/format';
import { useChallenges } from '@/features/admin/challenges-api';
import { useRetroactiveQueue } from '@/features/retroactive/useRetroactive';
import styles from './AdminPage.module.css';

function EfterregTile({ challengeId }: { challengeId: string | null }) {
  const queue = useRetroactiveQueue(challengeId);
  const pending = (queue.data ?? []).filter(
    (r) => r.status === 'pending',
  ).length;

  return (
    <Link to="/admin/efterregistreringar" className={styles.tile}>
      <span className={styles.tileIcon}>
        <ClockIcon />
      </span>
      <span className={styles.tileBody}>
        <span className={styles.tileTitle}>
          Efterregistreringar
          {pending > 0 && (
            <Badge tone="pending" size="sm">
              {pending} väntar
            </Badge>
          )}
        </span>
        <span className={styles.tileText}>
          Granska och godkänn begäran om att registrera tidigare pass.
        </span>
      </span>
      <ChevronRightIcon className={styles.tileChevron} />
    </Link>
  );
}

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
  const activeChallengeId =
    challenges?.find((c) => c.status === ChallengeStatus.Active)?.id ?? null;

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

        <Link to="/admin/utmaningar" className={styles.tile}>
          <span className={styles.tileIcon}>
            <OverviewIcon />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileTitle}>Utmaningar</span>
            <span className={styles.tileText}>
              Skapa, konfigurera, aktivera, avsluta och kopiera utmaningar.
            </span>
          </span>
          <ChevronRightIcon className={styles.tileChevron} />
        </Link>

        <EfterregTile challengeId={activeChallengeId} />

        <Link to="/admin/granskningslogg" className={styles.tile}>
          <span className={styles.tileIcon}>
            <ShieldIcon />
          </span>
          <span className={styles.tileBody}>
            <span className={styles.tileTitle}>Granskningslogg</span>
            <span className={styles.tileText}>
              Ändringar av medlemskap, regler, straff och rättade pass.
            </span>
          </span>
          <ChevronRightIcon className={styles.tileChevron} />
        </Link>
      </nav>

      <Card
        title="Utmaningar"
        action={
          <Link to="/admin/utmaningar" className={styles.cardLink}>
            Alla <ChevronRightIcon className={styles.tileChevron} />
          </Link>
        }
      >
        {isLoading ? (
          <Spinner label="Laddar utmaningar…" />
        ) : challenges && challenges.length > 0 ? (
          <ul className={styles.challengeList}>
            {challenges.slice(0, 4).map((c) => (
              <li key={c.id} className={styles.challengeRow}>
                <Link
                  to={`/admin/utmaningar/${c.id}`}
                  className={styles.challengeLink}
                >
                  <span className={styles.challengeName}>{c.name}</span>
                  <span className={styles.challengeMeta}>
                    {formatDayMonth(c.startDate)} – {formatDayMonth(c.endDate)}{' '}
                    · {challengeDurationDays(c)} dagar
                  </span>
                </Link>
                <Badge tone={STATUS_TONE[c.status]} size="sm">
                  {STATUS_LABEL[c.status]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            Inga utmaningar ännu.{' '}
            <Link to="/admin/utmaningar/ny">Skapa den första</Link>.
          </p>
        )}
      </Card>
    </>
  );
}
