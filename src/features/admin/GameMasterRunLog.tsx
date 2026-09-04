import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import type { BadgeProps } from '@/components/ui/Badge';
import {
  useCancelGameMasterEvent,
  useGameMasterRuns,
  useRecentGameMasterEvents,
  type AdminGameMasterEvent,
} from './game-master-admin-api';
import styles from './GameMasterRunLog.module.css';

type BadgeTone = NonNullable<BadgeProps['tone']>;

/**
 * Read-only Game Master observability for admins (spec §16): the last pulse
 * decisions and the last events, plus a single audited "hide this event"
 * action. No manual pulse / roast / victim / winner control exists here.
 */

const FAMILY_LABELS: Record<string, string> = {
  missed_day: 'Avvikelse',
  streak_long: 'Status',
  streak_broken: 'Fall',
  debt_leader: 'Ekonomi',
  kassan: 'Kassan',
  comeback: 'Återkomst',
  ranking_position: 'Placering',
  historic_callback: 'Historik',
  general_system: 'System',
};

function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family;
}

const OUTCOME_LABELS: Record<string, string> = {
  event: 'Händelse',
  silence: 'Tystnad',
  disabled: 'Avstängt',
  cooldown: 'Nedkylning',
  error: 'Fel',
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  event: 'completed',
  silence: 'neutral',
  disabled: 'neutral',
  cooldown: 'pending',
  error: 'missed',
};

const SOURCE_LABELS: Record<string, string> = {
  event: 'Träningspass',
  scheduled: 'Schemalagd',
};

const STATUS_LABELS: Record<AdminGameMasterEvent['status'], string> = {
  active: 'Aktiv',
  expired: 'Utgången',
  cancelled: 'Dold',
};

const STATUS_TONE: Record<AdminGameMasterEvent['status'], BadgeTone> = {
  active: 'completed',
  expired: 'neutral',
  cancelled: 'missed',
};

function fmtTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function diagnosticsFamily(
  diagnostics: Record<string, unknown>,
): string | null {
  const f = diagnostics.family;
  return typeof f === 'string' && f.length > 0 ? f : null;
}

export interface GameMasterRunLogProps {
  challengeId: string;
}

export function GameMasterRunLog({ challengeId }: GameMasterRunLogProps) {
  const runs = useGameMasterRuns(challengeId);
  const events = useRecentGameMasterEvents(challengeId);
  const cancel = useCancelGameMasterEvent();

  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const cancelTarget =
    cancelId !== null
      ? ((events.data ?? []).find((e) => e.id === cancelId) ?? null)
      : null;

  function closeCancel() {
    setCancelId(null);
    setReason('');
    if (cancel.isError) cancel.reset();
  }

  return (
    <div className={styles.wrap}>
      <Card title="Senaste beslut">
        {runs.isLoading ? (
          <Spinner label="Laddar beslut…" />
        ) : runs.isError ? (
          <ErrorState
            title="Besluten kunde inte hämtas"
            onRetry={() => void runs.refetch()}
          />
        ) : (runs.data ?? []).length === 0 ? (
          <EmptyState
            title="Inga pulsbeslut än"
            body="Varje puls loggas här — även tystnad."
          />
        ) : (
          <ul className={styles.list}>
            {(runs.data ?? []).map((run) => {
              const fam =
                run.outcome === 'event'
                  ? diagnosticsFamily(run.diagnostics)
                  : null;
              return (
                <li key={run.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowTitle}>
                      {SOURCE_LABELS[run.source] ?? run.source}
                    </span>
                    <span className={styles.rowTime}>
                      {fmtTime(run.startedAt)}
                    </span>
                  </div>
                  <div className={styles.rowMeta}>
                    <Badge
                      tone={OUTCOME_TONE[run.outcome] ?? 'neutral'}
                      size="sm"
                    >
                      {OUTCOME_LABELS[run.outcome] ?? run.outcome}
                    </Badge>
                    <span className={styles.rowCounts}>
                      {run.candidateCount} kandidater · {run.eligibleCount}{' '}
                      möjliga
                    </span>
                    {fam && (
                      <span className={styles.rowFamily}>
                        {familyLabel(fam)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Senaste events">
        {events.isLoading ? (
          <Spinner label="Laddar händelser…" />
        ) : events.isError ? (
          <ErrorState
            title="Händelserna kunde inte hämtas"
            onRetry={() => void events.refetch()}
          />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState
            title="Inga händelser än"
            body="Skapade roasts visas här — privata som publika."
          />
        ) : (
          <ul className={styles.list}>
            {(events.data ?? []).map((event) => (
              <li key={event.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>{event.title}</span>
                  <span className={styles.rowTime}>
                    {fmtTime(event.createdAt)}
                  </span>
                </div>
                <div className={styles.rowMeta}>
                  <Badge tone="neutral" size="sm">
                    {familyLabel(event.family)}
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    {event.visibility === 'public' ? 'Publik' : 'Privat'}
                  </Badge>
                  <span className={styles.rowCounts}>
                    Allvar {event.severity}
                  </span>
                  <Badge tone={STATUS_TONE[event.status]} size="sm">
                    {STATUS_LABELS[event.status]}
                  </Badge>
                </div>
                <p className={styles.rowBody}>{event.body}</p>
                {event.status === 'cancelled' ? (
                  event.cancelledReason && (
                    <p className={styles.rowReason}>
                      Dold: {event.cancelledReason}
                    </p>
                  )
                ) : (
                  <div className={styles.rowActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReason('');
                        if (cancel.isError) cancel.reset();
                        setCancelId(event.id);
                      }}
                    >
                      Dölj
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmSheet
        open={cancelTarget !== null}
        onClose={closeCancel}
        title="Dölj händelsen?"
        body={
          <>
            Händelsen döljs för alla deltagare och tas bort ur Arkivet. Detta
            loggas i granskningsloggen med din angivna anledning.
          </>
        }
        confirmLabel="Dölj"
        danger
        loading={cancel.isPending}
        error={cancel.error?.message ?? null}
        disabled={reason.trim().length === 0}
        onConfirm={() => {
          if (!cancelTarget) return;
          cancel.mutate(
            { eventId: cancelTarget.id, reason: reason.trim() },
            { onSuccess: closeCancel },
          );
        }}
      >
        <label className={styles.field}>
          <span>Anledning (obligatorisk)</span>
          <textarea
            value={reason}
            rows={2}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="T.ex. Fel mottagare — data hann ändras."
          />
        </label>
      </ConfirmSheet>
    </div>
  );
}
