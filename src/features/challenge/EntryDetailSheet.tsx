import { useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { formatLongDate, formatMinutes } from '@/domain/format';
import { Sheet } from '@/components/ui/Sheet';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { SkeletonText } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { SignedProofImage } from '@/components/proof/SignedProofImage';
import {
  CheckIcon,
  ClockIcon,
  ImageOffIcon,
  SkullIcon,
} from '@/components/icons';
import { useProfile } from '@/features/profile/useProfile';
import {
  INVALIDATION_REASONS,
  useTrainingCorrection,
  type InvalidationReasonCode,
} from '@/features/admin/corrections-api';
import type { RetroactiveRequestRow } from '@/features/retroactive/retroactive-api';
import { useEntryDetail, type SessionDetailWithProof } from './useEntryDetail';
import { weekdayLong, capitalize } from './labels';
import type { DayRequirement } from './types';
import styles from './EntryDetailSheet.module.css';

export interface RetroactivePrompt {
  /** The signed-in participant may request efterregistrering for this day. */
  canRequest: boolean;
  /** An existing request for this exact day, if any. */
  existing: RetroactiveRequestRow | null;
  onRequest: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  participantName: string;
  isSelf: boolean;
  userId: string;
  date: string;
  /** Effective (penalty-aware) requirement for this day, when known. */
  requirement?: DayRequirement | null;
  /** Efterregistrering affordance for the signed-in participant's own past day. */
  retroactive?: RetroactivePrompt | null;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EntryDetailSheet({
  open,
  onClose,
  challenge,
  participantName,
  isSelf,
  userId,
  date,
  requirement,
  retroactive,
}: Props) {
  const { data, isLoading, isError, refetch } = useEntryDetail(
    challenge.id,
    userId,
    date,
    open,
  );
  const { isAdmin } = useProfile();
  const sessions = data?.sessions ?? [];
  const effectiveMinutes =
    requirement?.requiredMinutes ?? challenge.requiredMinutes;
  const perSessionMin =
    requirement && requirement.requiredSessions > 1
      ? requirement.minMinutesPerSession
      : challenge.requiredMinutes;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      hideHeader
      ariaLabel={`Träningspass för ${participantName}`}
    >
      <div className={styles.head}>
        <Avatar name={participantName} size="lg" ring={isSelf} />
        <div>
          <p className={styles.name}>
            {participantName}
            {isSelf && <span className={styles.you}> · du</span>}
          </p>
          <p className={styles.date}>
            {capitalize(weekdayLong(date))} {formatLongDate(date)}
          </p>
        </div>
      </div>

      {requirement?.penaltyType != null && (
        <p className={styles.reqLine}>
          <SkullIcon className={styles.reqIcon} aria-hidden="true" />
          {requirement.penaltyDisplayName ?? 'Straff'} —{' '}
          {requirement.requiredSessions > 1
            ? `${String(requirement.requiredSessions)} pass à minst ${formatMinutes(perSessionMin)} · ${String(requirement.validSessionCount)}/${String(requirement.requiredSessions)} klara`
            : `minst ${formatMinutes(effectiveMinutes)} totalt · ${String(requirement.totalValidMinutes)}/${String(effectiveMinutes)} giltiga`}
        </p>
      )}

      {isLoading && <SkeletonText lines={4} />}
      {isError && (
        <ErrorState
          title="Kunde inte hämta passet"
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && sessions.length === 0 && (
        <EmptyState
          icon={<ImageOffIcon />}
          title="Ingen registrering"
          body={`${isSelf ? 'Du har' : `${participantName} har`} inget pass registrerat den här dagen.`}
        />
      )}

      {!isLoading &&
        !isError &&
        sessions.map((s, i) => (
          <SessionBlock
            key={s.entryId}
            session={s}
            index={i}
            total={sessions.length}
            challengeId={challenge.id}
            targetUserId={userId}
            perSessionMin={perSessionMin}
            proofRequired={challenge.proofRequired}
            isAdmin={isAdmin}
          />
        ))}

      {isSelf && retroactive && <RetroactiveBlock prompt={retroactive} />}
    </Sheet>
  );
}

function RetroactiveBlock({ prompt }: { prompt: RetroactivePrompt }) {
  const existing = prompt.existing;
  if (existing) {
    const line =
      existing.status === 'pending'
        ? 'Efterregistrering väntar på godkännande.'
        : existing.status === 'approved'
          ? 'Efterregistreringen är godkänd.'
          : existing.status === 'rejected'
            ? `Efterregistreringen avslogs${existing.reviewNote ? `: ${existing.reviewNote}` : '.'}`
            : 'Efterregistreringen återkallades.';
    return (
      <div className={styles.retro}>
        <p className={styles.retroStatus}>{line}</p>
      </div>
    );
  }
  if (!prompt.canRequest) return null;
  return (
    <div className={styles.retro}>
      <p className={styles.retroHint}>
        Tränade du men hann inte logga? Be en administratör registrera passet i
        efterhand.
      </p>
      <Button variant="secondary" size="sm" onClick={prompt.onRequest}>
        Begär efterregistrering
      </Button>
    </div>
  );
}

function SessionBlock({
  session,
  index,
  total,
  challengeId,
  targetUserId,
  perSessionMin,
  proofRequired,
  isAdmin,
}: {
  session: SessionDetailWithProof;
  index: number;
  total: number;
  challengeId: string;
  targetUserId: string;
  perSessionMin: number;
  proofRequired: boolean;
  isAdmin: boolean;
}) {
  const s = session;
  const invalid = s.status === 'invalidated';
  const meetsMinutes = s.durationMinutes >= perSessionMin;
  const correction = useTrainingCorrection(challengeId, targetUserId);
  const [mode, setMode] = useState<'idle' | 'invalidate' | 'revalidate'>(
    'idle',
  );
  const [reasonCode, setReasonCode] =
    useState<InvalidationReasonCode>('felregistrerad');
  const [reasonText, setReasonText] = useState('');

  const busy =
    correction.invalidate.isPending || correction.revalidate.isPending;

  async function submit() {
    if (reasonText.trim().length < 3) return;
    try {
      if (mode === 'invalidate') {
        await correction.invalidate.mutateAsync({
          entryId: s.entryId,
          reason: reasonText.trim(),
          reasonCode,
        });
      } else {
        await correction.revalidate.mutateAsync({
          entryId: s.entryId,
          reason: reasonText.trim(),
        });
      }
      setMode('idle');
      setReasonText('');
    } catch {
      /* surfaced below */
    }
  }

  return (
    <div
      className={`${styles.session} ${invalid ? styles.sessionInvalid : ''}`}
    >
      {total > 1 && (
        <p className={styles.sessionLabel}>
          Pass {index + 1} av {total}
        </p>
      )}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Tid</span>
          <span className={`${styles.metricValue} tnum`}>
            {formatMinutes(s.durationMinutes)}
          </span>
          {invalid ? (
            <Badge tone="missed" size="sm">
              Ogiltigförklarat
            </Badge>
          ) : meetsMinutes && (!proofRequired || s.proofSignedUrl) ? (
            <Badge tone="completed" size="sm" icon={<CheckIcon />}>
              Räknas
            </Badge>
          ) : (
            <Badge tone="pending" size="sm">
              Räknas inte
            </Badge>
          )}
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Aktivitet</span>
          <span className={styles.metricValue}>{s.activity ?? '—'}</span>
          <span className={styles.metricSub}>
            Minst {formatMinutes(perSessionMin)} krävs
          </span>
        </div>
      </div>

      {invalid && s.invalidatedReason && (
        <p className={styles.invalidReason}>Anledning: {s.invalidatedReason}</p>
      )}
      {s.note && !invalid && <p className={styles.note}>”{s.note}”</p>}

      {s.proofSignedUrl ? (
        <SignedProofImage src={s.proofSignedUrl} alt="Bildbevis" />
      ) : (
        <EmptyState
          icon={<ImageOffIcon />}
          title="Inget bildbevis"
          body="Passet registrerades utan bild."
        />
      )}

      <p className={styles.submitted}>
        <ClockIcon className={styles.clock} />
        Registrerad kl. {timeOf(s.submittedAt)}
      </p>

      {isAdmin && (
        <div className={styles.admin}>
          {mode === 'idle' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode(invalid ? 'revalidate' : 'invalidate')}
            >
              {invalid ? 'Återställ passet' : 'Ogiltigförklara passet'}
            </Button>
          ) : (
            <div className={styles.correction}>
              {mode === 'invalidate' && (
                <select
                  className={styles.select}
                  value={reasonCode}
                  onChange={(e) =>
                    setReasonCode(e.target.value as InvalidationReasonCode)
                  }
                >
                  {INVALIDATION_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                className={styles.reasonText}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Anledning (obligatorisk)"
                rows={2}
                maxLength={1000}
              />
              {(correction.invalidate.error ?? correction.revalidate.error) && (
                <p className={styles.err}>Kunde inte spara korrigeringen.</p>
              )}
              <div className={styles.correctionActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMode('idle');
                    setReasonText('');
                  }}
                >
                  Avbryt
                </Button>
                <Button
                  variant={mode === 'invalidate' ? 'danger' : 'primary'}
                  size="sm"
                  loading={busy}
                  disabled={reasonText.trim().length < 3}
                  onClick={() => void submit()}
                >
                  Bekräfta
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
