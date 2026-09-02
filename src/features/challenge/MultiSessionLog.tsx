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
 * The penalty-day / multi-session logging experience. Used whenever the day's
 * effective requirement carries a penalty. Each session is registered
 * independently, with its own proof when the challenge requires proof.
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

  const copy = describeRequirement(requirement);
  const isDouble = requirement.requiredSessions > 1;
  const perSessionMin = isDouble
    ? requirement.minMinutesPerSession
    : challenge.requiredMinutes;
  const dayComplete = self.todayState === DayState.Completed;

  const penalisedBy =
    requirement.penaltyFromUserId != null
      ? (data.participants.find(
          (p) => p.userId === requirement.penaltyFromUserId,
        )?.displayName ?? 'Någon')
      : null;

  function sessionValid(s: (typeof sessions)[number]): boolean {
    if (isDouble && s.durationMinutes < perSessionMin) return false;
    if (challenge.proofRequired && !s.hasProof) return false;
    return true;
  }

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
          proofFile: value.proofFile,
        });
      } else {
        await addSession.mutateAsync({
          challengeId: challenge.id,
          userId: self.userId,
          date: today,
          durationMinutes: value.durationMinutes,
          activity: value.activity,
          note: value.note,
          proofFile: value.proofFile,
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
        title={isDouble ? 'Dubbelpass' : copy.headline}
        subtitle={copy.detail + '.'}
      />

      <Card variant="raised" padding="lg" className={styles.head}>
        <Badge tone={dayComplete ? 'completed' : 'missed'} icon={<SkullIcon />}>
          {dayComplete
            ? 'Straffet klarat'
            : (copy.penaltyName ?? 'Straff idag')}
        </Badge>
        <p className={styles.headLead}>
          {penalisedBy
            ? `${penalisedBy.split(' ')[0]} har gett dig ${copy.penaltyName ?? 'ett straff'}.`
            : `Du har ${copy.penaltyName ?? 'ett straff'} idag.`}
        </p>
        <p className={styles.progress}>
          {isDouble
            ? sessionCounterLabel(
                Math.min(
                  sessions.filter(sessionValid).length + 1,
                  requirement.requiredSessions,
                ),
                requirement.requiredSessions,
              )
            : `${String(requirement.totalValidMinutes)} / ${String(requirement.requiredMinutes)} min giltiga`}
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
                      {isDouble && s.durationMinutes < perSessionMin
                        ? ` · under ${formatMinutes(perSessionMin)}`
                        : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dayComplete ? (
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
            Lägg till ytterligare ett pass
          </Button>
          <p className={styles.hint}>
            {isDouble
              ? `Ett långt pass räknas som ett — Dubbelpass kräver ${String(requirement.requiredSessions)} separata pass à minst ${formatMinutes(perSessionMin)}.`
              : `Flera pass räknas ihop mot ${formatMinutes(requirement.requiredMinutes)}.`}
          </p>
        </div>
      )}
    </>
  );
}
