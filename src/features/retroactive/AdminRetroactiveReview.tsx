import { useState } from 'react';
import { formatLongDate, formatMinutes, formatSek } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { SkeletonText } from '@/components/ui/Skeleton';
import {
  useApprovalPreview,
  useRetroactiveSessions,
  useReviewRetroactive,
} from './useRetroactive';
import {
  RetroactiveError,
  type RetroactiveRequestRow,
} from './retroactive-api';
import { RetroactiveProofThumb } from './RetroactiveProofThumb';
import styles from './AdminRetroactiveReview.module.css';

const STATUS_LABEL: Record<RetroactiveRequestRow['status'], string> = {
  pending: 'Väntar',
  approved: 'Godkänd',
  rejected: 'Avslagen',
  cancelled: 'Återkallad',
};
const STATUS_TONE = {
  pending: 'pending',
  approved: 'completed',
  rejected: 'missed',
  cancelled: 'neutral',
} as const;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function AdminRetroactiveReview({
  challengeId,
  request,
  participantName,
}: {
  challengeId: string;
  request: RetroactiveRequestRow;
  participantName: string;
}) {
  const pending = request.status === 'pending';
  const sessions = useRetroactiveSessions(request.id, true);
  const preview = useApprovalPreview(request.id, pending);
  const { approve, reject } = useReviewRetroactive(challengeId);

  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const busy = approve.isPending || reject.isPending;
  const err = approve.error ?? reject.error;
  const errMsg =
    err instanceof RetroactiveError
      ? err.message
      : err
        ? 'Åtgärden misslyckades. Försök igen.'
        : null;

  const p = preview.data;
  const impact = p
    ? p.wouldComplete && p.debtDeltaSek < 0
      ? `Vid godkännande blir dagen genomförd och skulden minskar med ${formatSek(
          -p.debtDeltaSek,
        )}.`
      : p.wouldComplete
        ? 'Vid godkännande blir dagen genomförd.'
        : 'Vid godkännande registreras passet, men dagens krav är fortfarande inte uppfyllt.'
    : null;

  return (
    <Card padding="md" className={styles.card}>
      <div className={styles.head}>
        <Avatar name={participantName} size="sm" />
        <div className={styles.headText}>
          <p className={styles.name}>{participantName}</p>
          <p className={styles.date}>
            {capitalize(weekdayLong(request.challengeDate))}{' '}
            {formatLongDate(request.challengeDate)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[request.status]} size="sm">
          {STATUS_LABEL[request.status]}
        </Badge>
      </div>

      <p className={styles.submitted}>
        Inskickad {timeOf(request.submittedAt)}
      </p>

      {preview.isLoading && <SkeletonText lines={2} />}
      {p && (
        <p className={styles.req}>
          Dagens krav:{' '}
          {p.requiredSessions > 1
            ? `${String(p.requiredSessions)} pass à minst ${formatMinutes(
                p.minMinutesPerSession,
              )}`
            : `minst ${formatMinutes(p.requiredMinutes)}`}
          {p.existingValidSessions > 0 &&
            ` · ${String(p.existingValidSessions)} godkänt pass redan (${String(
              p.existingValidMinutes,
            )} min)`}
        </p>
      )}

      <div className={styles.reason}>
        <span className={styles.reasonLabel}>Anledning</span>
        <p>”{request.participantReason}”</p>
      </div>

      {sessions.isLoading && <SkeletonText lines={3} />}
      {sessions.data?.map((s, i) => (
        <div key={i} className={styles.session}>
          <p className={styles.sessionHead}>
            {s.activity ?? 'Träning'} · {formatMinutes(s.durationMinutes)}
          </p>
          {s.note && <p className={styles.note}>”{s.note}”</p>}
          <RetroactiveProofThumb path={s.proofStoragePath} />
        </div>
      ))}

      {pending && impact && <p className={styles.impact}>{impact}</p>}

      {!pending && request.reviewNote && (
        <p className={styles.reviewNote}>
          {request.status === 'rejected' ? 'Avslag: ' : 'Notering: '}
          {request.reviewNote}
        </p>
      )}

      {errMsg && <p className={styles.err}>{errMsg}</p>}

      {pending && (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              setReason('');
              setConfirm('reject');
            }}
            disabled={busy}
          >
            Avslå
          </Button>
          <Button
            onClick={() => {
              setNote('');
              setConfirm('approve');
            }}
            disabled={busy}
          >
            Godkänn
          </Button>
        </div>
      )}

      <ConfirmSheet
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        title="Godkänn efterregistreringen?"
        body={
          <>
            Passet registreras för <strong>{participantName}</strong> den{' '}
            {formatLongDate(request.challengeDate)}. {impact}
          </>
        }
        confirmLabel="Godkänn"
        loading={approve.isPending}
        onConfirm={() =>
          approve.mutate(
            {
              requestId: request.id,
              targetUserId: request.userId,
              note: note.trim() || null,
            },
            { onSuccess: () => setConfirm(null) },
          )
        }
      >
        <label className={styles.field}>
          <span>Notering (valfritt)</span>
          <textarea
            value={note}
            rows={2}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </ConfirmSheet>

      <ConfirmSheet
        open={confirm === 'reject'}
        onClose={() => setConfirm(null)}
        title="Avslå efterregistreringen?"
        body="Ingen träning registreras. Deltagaren ser avslaget och din anledning."
        confirmLabel="Avslå"
        danger
        loading={reject.isPending}
        disabled={reason.trim().length < 3}
        onConfirm={() =>
          reject.mutate(
            {
              requestId: request.id,
              targetUserId: request.userId,
              reason: reason.trim(),
            },
            { onSuccess: () => setConfirm(null) },
          )
        }
      >
        <label className={styles.field}>
          <span>Anledning (obligatorisk)</span>
          <textarea
            value={reason}
            rows={2}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="T.ex. Bilden matchar inte datumet."
          />
        </label>
      </ConfirmSheet>
    </Card>
  );
}
