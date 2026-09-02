import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallenges } from '@/features/admin/challenges-api';
import { useAllProfiles } from '@/features/admin/add-membership-api';
import { useAuditLog, type AuditFilters } from '@/features/admin/audit-api';
import { describeAuditEvent } from '@/features/admin/audit-humanize';
import styles from './AuditPage.module.css';

type Cat = NonNullable<AuditFilters['category']>;

const CATEGORIES: { value: Cat; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'challenge', label: 'Utmaning' },
  { value: 'membership', label: 'Medlemskap' },
  { value: 'training', label: 'Träning' },
  { value: 'penalty', label: 'Straff' },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AuditPage() {
  const challenges = useChallenges();
  const profiles = useAllProfiles();
  const [challengeId, setChallengeId] = useState<string>('');
  const [category, setCategory] = useState<Cat>('all');
  const [userId, setUserId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');

  const filters: AuditFilters = {
    challengeId: challengeId || null,
    category,
    userId: userId || null,
    fromDate: fromDate || null,
  };
  const { data, isLoading, isError, refetch } = useAuditLog(filters);

  const nameOf = useMemo(() => {
    const m = new Map((profiles.data ?? []).map((p) => [p.id, p.displayName]));
    return (id: string | null | undefined) =>
      id ? (m.get(id) ?? 'Okänd') : 'Systemet';
  }, [profiles.data]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Granskningslogg"
        subtitle="Alla viktiga ändringar — regler, medlemskap, rättningar och straff."
      />
      <p className={styles.back}>
        <Link to="/admin">← Administration</Link>
      </p>

      <Card padding="md" className={styles.filters}>
        <SegmentedControl
          ariaLabel="Kategori"
          size="sm"
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
        />
        <div className={styles.selects}>
          <select
            value={challengeId}
            onChange={(e) => setChallengeId(e.target.value)}
            aria-label="Utmaning"
          >
            <option value="">Alla utmaningar</option>
            {(challenges.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            aria-label="Person"
          >
            <option value="">Alla personer</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Från datum"
          />
        </div>
      </Card>

      {isLoading && <Spinner label="Laddar logg…" />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <Card>
          <EmptyState
            title="Inga händelser"
            body="Ingen loggpost matchar filtren."
          />
        </Card>
      )}

      {data && data.length > 0 && (
        <ul className={styles.list}>
          {data.map((row) => {
            const d = describeAuditEvent(row, nameOf);
            return (
              <li key={row.id} className={styles.event}>
                <div className={styles.eventHead}>
                  <span className={styles.title}>{d.title}</span>
                  <span className={styles.time}>{fmtTime(row.createdAt)}</span>
                </div>
                <p className={styles.detail}>{d.detail}</p>
                {d.changes.length > 0 && (
                  <ul className={styles.changes}>
                    {d.changes.map((c) => (
                      <li key={c.label}>
                        <span className={styles.chLabel}>{c.label}:</span>{' '}
                        <span className={styles.chBefore}>{c.before}</span>
                        <span className={styles.chArrow}> → </span>
                        <span className={styles.chAfter}>{c.after}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
