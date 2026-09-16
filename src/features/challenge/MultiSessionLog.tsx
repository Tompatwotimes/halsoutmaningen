import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DayState } from '@/domain/dayState';
import { formatMinutes } from '@/domain/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { CheckIcon, SkullIcon } from '@/components/icons';
import type { ChallengeDataset, DayRequirement } from './types';
import {
  describeRequirement,
  sessionCounterLabel,
} from '@/features/straffbanken/straffbanken';
import { useSubmitTraining } from './useSubmitTraining';
import { useAddTrainingSession } from './add-training-session';
import { SessionForm, type SessionFormValue } from './SessionForm';
import { SubmitTrainingError } from './submit-training';
import styles from './MultiSessionLog.module.css';

/**
 * The voluntary multi-session logging experience — a participant's own extra
 * sessions on an ordinary day, or the penalty-day flow when the day's
 * effective requirement carries a penalty. Each session is registered
 * independently, with its own proof when the challenge requires proof.
 *
 * DOMAIN RULE (v1.10.0): there is no limit on how many sessions a day may
 * have, but multiple sub-threshold sessions are never summed to complete it
 * — completion needs at least `requirement.requiredSessions` sessions that
 * EACH individually reach `requirement.minMinutesPerSession`
 * (`sessionValid` below). A short extra session still counts toward the
 * day's total training-time display, just never toward completion.
 */
export function MultiSessionLog({
  data,
  requirement,
}: {
  data: ChallengeDataset;
  requirement: DayRequirement;
}) {
  const { challenge, today, self } = data;
  const sessions = data
    .getSelfSessions(today)
    .filter((s) => s.status === 'active');
  const submit = useSubmitTraining();
  const addSession = useAddTrainingSession();
  const [showForm, setShowForm] = useState(sessions.length === 0);

  const isPenalty = requirement.penaltyType !== null;
  const copy = describeRequirement(requirement);
  const isDouble = requirement.requiredSessions > 1;
  const perSessionMin = requirement.minMinutesPerSession;
  const dayComplete = self.todayState === DayState.Completed;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);

  const penalisedBy =
    requirement.penaltyFromUserId != null
      ? (data.participants.find(
          (p) => p.userId === requirement.penaltyFromUserId,
        )?.displayName ?? 'Någon')
      : null;

  /** A session must ALONE reach the per-session floor — never summed with another. */
  function sessionValid(s: (typeof sessions)[number]): boolean {
    if (s.durationMinutes < perSessionMin) return false;
    if (challenge.proofRequired && !s.hasProof) return false;
    return true;
  }
  const qualifyingCount = sessions.filter(sessionValid).length;

  async function handleSubmit(value: SessionFormValue) {
    const isPrimary = sessions.length === 0;
    try {
      if (isPrimary) {
        await submit.mutateAsync({
          challengeId: challenge.id,
          userId: self.userId,
          date: today,
          durationMinutes: value.durationMinutes,
          activity: value.activity,
          note: value.note,
          proofFiles: value.proofFiles,
        });
      } else {
        await addSession.mutateAsync({
          challengeId: challenge.id,
          userId: self.userId,
          date: today,
          durationMinutes: value.durationMinutes,
          activity: value.activity,
          note: value.note,
          proofFiles: value.proofFiles,
        });
      }
      setShowForm(false);
    } catch {
      /* surfaced below */
    }
  }

  const busy = submit.isPending || addSession.isPending;
  const err = [submit.error, addSession.error].find(Boolean);
  const errMsg =
    err instanceof SubmitTrainingError
      ? err.message
      : err
        ? 'Passet kunde inte sparas. Försök igen.'
        : null;

  return (
    <>
      <PageHeader
        title={
          isPenalty
            ? isDouble
              ? 'Dubbelpass'
              : copy.headline
            : 'Logga träning'
        }
        subtitle={
          isPenalty
            ? copy.detail + '.'
            : 'Flera pass samma dag går bra — bara ett av dem behöver räcka.'
        }
      />

      <Card
        variant="raised"
        padding="lg"
        className={[styles.head, !isPenalty && styles.headNormal]
          .filter(Boolean)
          .join(' ')}
      >
        {isPenalty ? (
          <>
            <Badge
              tone={dayComplete ? 'completed' : 'missed'}
              icon={<SkullIcon />}
            >
              {dayComplete
                ? 'Straffet klarat'
                : (copy.penaltyName ?? 'Straff idag')}
            </Badge>
            <p className={styles.headLead}>
              {penalisedBy
                ? `${penalisedBy.split(' ')[0]} har gett dig ${copy.penaltyName ?? 'ett straff'}.`
                : `Du har ${copy.penaltyName ?? 'ett straff'} idag.`}
            </p>
          </>
        ) : (
          <Badge
            tone={dayComplete ? 'completed' : 'pending'}
            dot={!dayComplete}
          >
            {dayComplete ? 'Dagens krav uppfyllt' : 'Dagens pass'}
          </Badge>
        )}
        <p className={styles.progress}>
          {isDouble
            ? sessionCounterLabel(
                Math.min(qualifyingCount + 1, requirement.requiredSessions),
                requirement.requiredSessions,
              )
            : `${String(sessions.length)} pass · ${formatMinutes(totalMinutes)} totalt`}
        </p>
      </Card>

      {sessions.length > 0 && (
        <Card title="Dagens pass" padding="md">
          <ul className={styles.list}>
            {sessions.map((s, i) => {
              const ok = sessionValid(s);
              return (
                <li key={s.entryId} className={styles.item}>
                  <span
                    className={[styles.dot, ok ? styles.dotOk : styles.dotBad]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  >
                    {ok ? '✓' : '!'}
                  </span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemName}>
                      Pass {i + 1} · {s.activity ?? 'Träning'}
                    </span>
                    <span className={styles.itemMeta}>
                      {formatMinutes(s.durationMinutes)}
                      {challenge.proofRequired
                        ? s.hasProof
                          ? ' · bild ✓'
                          : ' · bild saknas'
                        : ''}
                      {s.durationMinutes < perSessionMin
                        ? ` · under ${formatMinutes(perSessionMin)}`
                        : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {!isDouble && !dayComplete && (
            <p className={styles.hint}>
              För att dagen ska räknas måste minst ett enskilt pass vara minst{' '}
              {formatMinutes(perSessionMin)}.
            </p>
          )}
        </Card>
      )}

      {/*
       * Completion never locks out further logging on an ordinary day — a
       * participant may keep adding voluntary extra sessions after the day
       * is already complete. Only the penalty flow ends in a takeover "done"
       * card; a normal day just shows an inline note alongside the ongoing
       * session list + add-another affordance.
       */}
      {!isPenalty && dayComplete && (
        <p className={styles.doneNote}>Dagens pass är klart.</p>
      )}

      {isPenalty && dayComplete ? (
        <Card variant="raised" padding="lg" className={styles.done}>
          <span className={styles.doneMark} aria-hidden="true">
            <CheckIcon />
          </span>
          <p className={styles.doneTitle}>Dagens straff är klarat</p>
          <p className={styles.doneSub}>
            Streak: <strong>{self.currentStreak} dagar</strong>.
          </p>
          <div className={styles.doneActions}>
            <Link to="/">
              <Button>Till hem</Button>
            </Link>
            <Link to="/gruppen">
              <Button variant="secondary">Se gruppen</Button>
            </Link>
          </div>
        </Card>
      ) : showForm ? (
        <Card
          title={
            sessions.length === 0
              ? 'Registrera pass 1'
              : `Registrera pass ${String(sessions.length + 1)}`
          }
          padding="md"
        >
          {errMsg && <p className={styles.err}>{errMsg}</p>}
          <SessionForm
            minMinutes={perSessionMin}
            // Straffbanken keeps guiding toward a genuinely qualifying pass;
            // a voluntary extra session on an ordinary day has no minimum
            // length to log at all (v1.10.1) — it still counts toward total
            // training time even when it can't complete the day alone.
            enforceMinimum={isPenalty}
            proofRequired={challenge.proofRequired}
            submitting={busy}
            submitLabel="Registrera passet"
            onSubmit={(v) => void handleSubmit(v)}
            onCancel={
              sessions.length > 0 ? () => setShowForm(false) : undefined
            }
          />
        </Card>
      ) : (
        <div className={styles.addRow}>
          <Button fullWidth onClick={() => setShowForm(true)}>
            Logga ytterligare pass
          </Button>
          <p className={styles.hint}>
            {isDouble
              ? `Ett långt pass räknas som ett — Dubbelpass kräver ${String(requirement.requiredSessions)} separata pass à minst ${formatMinutes(perSessionMin)}.`
              : `Varje extra pass räknas till din totala träningstid — men det är bara ett enskilt pass på minst ${formatMinutes(perSessionMin)} som gör dagen klar.`}
          </p>
        </div>
      )}
    </>
  );
}
