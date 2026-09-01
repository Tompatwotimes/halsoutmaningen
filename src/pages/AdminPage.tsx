import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { useChallenges } from '@/features/admin/challenges-api';
import styles from './AdminPage.module.css';

export function AdminPage() {
  const { data: challenges } = useChallenges();

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Deltagare, utmaningar och granskningslogg."
      />

      <div className={styles.grid}>
        <Card>
          <Link to="/admin/deltagare" className={styles.tile}>
            <span className={styles.tileTitle}>Deltagare</span>
            <span className={styles.tileBody}>
              Bjud in nya deltagare och hantera medlemskap och
              deltagandeperioder.
            </span>
          </Link>
        </Card>

        <Card title="Utmaningar">
          {challenges && challenges.length > 0 ? (
            <ul className={styles.list}>
              {challenges.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <span className={styles.status}>{c.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Inga utmaningar ännu.</p>
          )}
          <p className={styles.muted}>
            Att skapa och konfigurera utmaningar byggs i Fas 9.
          </p>
        </Card>
      </div>
    </>
  );
}
