import { useMemo, useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { PenaltyType } from '@/domain/penalties';
import { formatLongDate, formatMinutes } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { CheckIcon } from '@/components/icons';
import {
  SessionForm,
  type SessionFormValue,
} from '@/features/challenge/SessionForm';
import type { DayRequirement } from '@/features/challenge/types';
import { useSubmitRetroactive } from './useRetroactive';
import {
  RetroactiveError,
  removeRetroactiveProofs,
  uploadRetroactiveProof,
  type ProposedSessionInput,
} from './retroactive-api';
import styles from './RetroactiveRequestSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  userId: string;
  challengeDate: string;
  /** The effective (penalty-aware) requirement for that historical day. */
  requirement: DayRequirement | null;
  onSubmitted?: () => void;
}

/** Human "the day's requirement was …" line. */
function requirementText(
  challenge: ChallengeConfig,
  req: DayRequirement | null,
): string {
  if (req?.penaltyType === PenaltyType.DoubleSession) {
    return `Dagens krav var ${req.penaltyDisplayName ?? 'Dubbelpass'} · ${String(
      req.requiredSessions,
    )} × minst ${formatMinutes(req.minMinutesPerSession)}`;
  }
  const minutes = req?.requiredMinutes ?? challenge.requiredMinutes;
  return `Dagens krav var ${formatMinutes(minutes)}${
    challenge.proofRequired ? ' + bildbevis' : ''
  }`;
}

export function RetroactiveRequestSheet({
  open,
  onClose,
  challenge,
  userId,
  challengeDate,
  requirement,
  onSubmitted,
}: Props) {
  const submit = useSubmitRetroactive(challenge.id, userId);
  const [sessions, setSessions] = useState<SessionFormValue[]>([]);
  const [showForm, setShowForm] = useState(true);
  const [reason, setReason] = useState('');
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [phase, setPhase] = useState<'form' | 'success'>('form');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isDouble =
    requirement?.penaltyType === PenaltyType.DoubleSession &&
    requirement.requiredSessions > 1;
  const perSessionMin = isDouble
    ? requirement.minMinutesPerSession
    : challenge.requiredMinutes;

  const reasonValid = reason.trim().length >= 3;
  const canSubmit = sessions.length > 0 && reasonValid;

  const dayLabel = useMemo(
    () =>
      `${capitalize(weekdayLong(challengeDate))} ${formatLongDate(challengeDate)}`,
    [challengeDate],
  );

  function addSession(value: SessionFormValue) {
    setSessions((prev) => [...prev, value]);
    setShowForm(false);
  }

  async function handleSubmit() {
    setTriedSubmit(true);
    setUploadError(null);
    if (!canSubmit) return;

    const uploaded: string[] = [];
    try {
      const payload: ProposedSessionInput[] = [];
      for (const s of sessions) {
        let proof = null;
        if (s.proofFile) {
          const meta = await uploadRetroactiveProof(
            challenge.id,
            userId,
            challengeDate,
            s.proofFile,
          );
          uploaded.push(meta.storagePath);
          proof = meta;
        }
        payload.push({
          durationMinutes: s.durationMinutes,
          activity: s.activity,
          note: s.note,
          proof,
        });
      }

      await submit.mutateAsync({
        challengeId: challenge.id,
        challengeDate,
        reason: reason.trim(),
        sessions: payload,
      });
      setPhase('success');
      onSubmitted?.();
    } catch (err) {
      await removeRetroactiveProofs(uploaded);
      setUploadError(
        err instanceof RetroactiveError
          ? err.message
          : 'Efterregistreringen kunde inte skickas. Försök igen.',
      );
    }
  }

  const busy = submit.isPending;

  return (
    <Sheet open={open} onClose={onClose} title="Efterregistrera pass">
      {phase === 'success' ? (
        <div className={styles.success}>
          <span className={styles.successMark} aria-hidden="true">
            <CheckIcon />
          </span>
          <p className={styles.successTitle}>
            Efterregistreringen är inskickad
          </p>
          <p className={styles.successSub}>
            Passet räknas först när en administratör har godkänt det. Du hittar
            statusen under Profil.
          </p>
          <Button fullWidth onClick={onClose}>
            Klart
          </Button>
        </div>
      ) : (
        <>
          <p className={styles.lead}>
            Registrera ett pass du genomförde <strong>{dayLabel}</strong> men
            inte hann logga. En administratör granskar och godkänner det.
          </p>
          <p className={styles.req}>
            {requirementText(challenge, requirement)}
          </p>
          {isDouble && (
            <p className={styles.hint}>
              Ett långt pass räknas som ett — Dubbelpass kräver{' '}
              {String(requirement.requiredSessions)} separata pass à minst{' '}
              {formatMinutes(perSessionMin)}.
            </p>
          )}

          {sessions.length > 0 && (
            <ul className={styles.list}>
              {sessions.map((s, i) => (
                <li key={i} className={styles.item}>
                  <span className={styles.itemName}>
                    Pass {i + 1} · {s.activity ?? 'Träning'}
                  </span>
                  <span className={styles.itemMeta}>
                    {formatMinutes(s.durationMinutes)}
                    {challenge.proofRequired
                      ? s.proofFile
                        ? ' · bild ✓'
                        : ' · bild saknas'
                      : ''}
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() =>
                      setSessions((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label={`Ta bort pass ${String(i + 1)}`}
                  >
                    Ta bort
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showForm ? (
            <div className={styles.formWrap}>
              <p className={styles.formTitle}>Pass {sessions.length + 1}</p>
              <SessionForm
                minMinutes={perSessionMin}
                proofRequired={challenge.proofRequired}
                submitting={false}
                submitLabel="Lägg till passet"
                onSubmit={addSession}
                onCancel={
                  sessions.length > 0 ? () => setShowForm(false) : undefined
                }
              />
            </div>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => setShowForm(true)}
            >
              Lägg till ytterligare ett pass
            </Button>
          )}

          <label className={styles.reasonLabel}>
            <span>Varför registreras passet i efterhand?</span>
            <textarea
              className={styles.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="T.ex. Ingen täckning under kvällen."
            />
          </label>
          {triedSubmit && !reasonValid && (
            <p className={styles.err}>En kort motivering krävs.</p>
          )}
          {triedSubmit && sessions.length === 0 && (
            <p className={styles.err}>Lägg till minst ett pass.</p>
          )}
          {uploadError && <p className={styles.err}>{uploadError}</p>}

          <div className={styles.actions}>
            <Button
              fullWidth
              size="lg"
              loading={busy}
              disabled={triedSubmit && !canSubmit}
              onClick={() => void handleSubmit()}
            >
              Skicka efterregistrering
            </Button>
            <Button variant="ghost" fullWidth onClick={onClose} disabled={busy}>
              Avbryt
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
