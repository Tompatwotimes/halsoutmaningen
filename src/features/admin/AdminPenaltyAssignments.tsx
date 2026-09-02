import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatLongDate } from '@/domain/format';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { SkullIcon } from '@/components/icons';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import {
  fetchPenaltyAssignments,
  type PenaltyAssignmentRow,
} from '@/features/straffbanken/straffbank-api';
import { useCancelPenaltyAssignment } from '@/features/straffbanken/useStraffbank';
import styles from './AdminPenaltyAssignments.module.css';

interface Props {
  challengeId: string;
  today: string;
  /** Resolves a user id to a display name. */
  nameOf: (userId: string) => string;
  /** An admin user id — the cancel mutation invalidates their straffbank too. */
  adminUserId: string;
}

/**
 * Admin-only list of ACTIVE penalty assignments whose target day is still in
 * the future, each with an audited, reason-required cancellation
 * (`cancel_penalty_assignment`). After cancellation the ammunition returns to
 * the sender as `available` (or `expired` if the challenge is no longer active)
 * — current backend semantics.
 */
export function AdminPenaltyAssignments({
  challengeId,
  today,
  nameOf,
  adminUserId,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['straffbank', 'assignments', challengeId],
    queryFn: () => fetchPenaltyAssignments(challengeId),
    staleTime: 15_000,
  });

  const cancel = useCancelPenaltyAssignment(challengeId, adminUserId);
  const [target, setTarget] = useState<PenaltyAssignmentRow | null>(null);
  const [reason, setReason] = useState('');

  const upcoming = useMemo(
    () =>
      [...(data ?? [])]
        .filter((a) => a.status === 'active' && a.targetDate >= today)
        .sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1)),
    [data, today],
  );

  if (isLoading) return <Spinner label="Laddar straff…" />;
  if (upcoming.length === 0)
    return (
      <EmptyState
        icon={<SkullIcon />}
        title="Inga aktiva straff framåt"
        body="Det finns inga utdelade straff med en framtida måldag att ångra."
      />
    );

  async function confirmCancel() {
    if (!target || reason.trim().length < 3) return;
    try {
      await cancel.mutateAsync({
        assignmentId: target.id,
        reason: reason.trim(),
      });
      setTarget(null);
      setReason('');
    } catch {
      /* surfaced in the sheet */
    }
  }

  return (
    <>
      <ul className={styles.list}>
        {upcoming.map((a) => (
          <li key={a.id} className={styles.row}>
            <div className={styles.body}>
              <span className={styles.line}>
                <strong>{nameOf(a.fromUserId)}</strong> →{' '}
                <strong>{nameOf(a.toUserId)}</strong>
              </span>
              <span className={styles.meta}>
                <SkullIcon className={styles.icon} aria-hidden="true" />
                {a.displayName} · {capitalize(weekdayLong(a.targetDate))}{' '}
                {formatLongDate(a.targetDate)}
              </span>
            </div>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => {
                setTarget(a);
                setReason('');
              }}
            >
              Ångra
            </button>
          </li>
        ))}
      </ul>

      <ConfirmSheet
        open={target !== null}
        onClose={() => {
          setTarget(null);
          setReason('');
        }}
        title="Ångra straffet?"
        danger
        body={
          target ? (
            <>
              <strong>{nameOf(target.fromUserId)}</strong> gav{' '}
              <strong>{nameOf(target.toUserId)}</strong> "{target.displayName}"
              den {capitalize(weekdayLong(target.targetDate))}{' '}
              {formatLongDate(target.targetDate)}. Straffet tas bort från den
              dagen och ammunitionen går tillbaka till{' '}
              {nameOf(target.fromUserId).split(' ')[0]}
              {' (blir tillgänglig igen). Åtgärden loggas.'}
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Ja, ångra straffet"
        loading={cancel.isPending}
        disabled={reason.trim().length < 3}
        error={cancel.error instanceof Error ? cancel.error.message : null}
        onConfirm={() => void confirmCancel()}
      >
        <label className={styles.reasonLabel}>
          Anledning (obligatorisk)
          <textarea
            className={styles.reason}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="t.ex. fel person, tekniskt fel, överenskommelse"
          />
        </label>
      </ConfirmSheet>
    </>
  );
}
