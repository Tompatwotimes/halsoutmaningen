import { useMemo, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChallengeStatus } from '@/domain/challenge';
import { compareDates } from '@/domain/dates';
import { DayState, isQualifyingEntry } from '@/domain/dayState';
import { formatLongDate, formatMinutes } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { SignedProofImage } from '@/components/proof/SignedProofImage';
import { ProofImagePicker } from '@/components/proof/ProofImagePicker';
import { CheckIcon, ClockIcon } from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { MultiSessionLog } from '@/features/challenge/MultiSessionLog';
import { useSubmitTraining } from '@/features/challenge/useSubmitTraining';
import { RetroactiveEntryLink } from '@/features/retroactive/RetroactiveEntryLink';
import { useEntryDetail } from '@/features/challenge/useEntryDetail';
import { useProfile } from '@/features/profile/useProfile';
import { SubmitTrainingError } from '@/features/challenge/submit-training';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import styles from './LogPage.module.css';

type Phase = 'form' | 'success' | 'error';

const QUICK_MINUTES = [30, 40, 45, 60];
const ACTIVITY_SUGGESTIONS = [
  'Löpning',
  'Promenad',
  'Styrketräning',
  'Cykling',
  'Simning',
  'Yoga',
  'Gym',
];

export function LogPage() {
  const { data, isLoading, isError, refetch } = useChallengeData();

  if (isLoading) {
    return (
      <>
        <PageHeader title="Logga träning" />
        <Skeleton height="4rem" radius="var(--radius-lg)" />
        <Skeleton height="18rem" radius="var(--radius-lg)" />
      </>
    );
  }
  if (isError) {
    return (
      <>
        <PageHeader title="Logga träning" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data) {
    return <NoMembershipState title="Logga träning" />;
  }

  // A penalised day gets the dedicated multi-session experience.
  const req = data.self.todayRequirement;
  if (req && req.penaltyType !== null) {
    return <MultiSessionLog data={data} requirement={req} />;
  }

  return <LogForm data={data} />;
}

function LogForm({
  data,
}: {
  data: NonNullable<ReturnType<typeof useChallengeData>['data']>;
}) {
  const { challenge, today, self } = data;
  const { isAdmin } = useProfile();
  const existing = data.getSelfEntry(today);
  const alreadyLogged = self.todayState === DayState.Completed && existing;

  const notStarted = compareDates(today, challenge.startDate) < 0;
  const ended = compareDates(today, challenge.endDate) > 0;
  const outsideMembership = !notStarted && !ended && self.todayState === null;
  const challengeInactive =
    challenge.status !== ChallengeStatus.Active && !isAdmin;

  const blockedMessage = notStarted
    ? `Utmaningen börjar ${formatLongDate(challenge.startDate)}. Du kan logga träning från och med det datumet.`
    : ended
      ? `Utmaningen avslutades ${formatLongDate(challenge.endDate)}.`
      : outsideMembership
        ? 'Du är utanför din deltagandeperiod i utmaningen just nu.'
        : challengeInactive
          ? 'Utmaningen är inte aktiv ännu. Be en administratör aktivera den innan du kan logga träning.'
          : null;

  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [duration, setDuration] = useState<number>(
    existing?.durationMinutes ?? challenge.requiredMinutes,
  );
  const [activity, setActivity] = useState(existing?.activity ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const submitMutation = useSubmitTraining();
  const existingProofQuery = useEntryDetail(
    challenge.id,
    self.userId,
    today,
    editing && Boolean(existing?.hasProof) && imageFile === null,
  );

  const durationValid = duration >= challenge.requiredMinutes;
  const keepsExistingProof =
    editing && Boolean(existing?.hasProof) && imageFile === null;
  const proofValid =
    !challenge.proofRequired || imageFile !== null || keepsExistingProof;
  const canSubmit = durationValid && proofValid;

  const streakAfter = useMemo(
    () =>
      self.todayState === DayState.Completed
        ? self.currentStreak
        : self.currentStreak + 1,
    [self],
  );

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setTriedSubmit(true);
    if (!canSubmit) return;

    try {
      await submitMutation.mutateAsync({
        challengeId: challenge.id,
        userId: self.userId,
        date: today,
        durationMinutes: duration,
        activity: activity.trim() || null,
        note: note.trim() || null,
        proofFile: imageFile,
      });
      setPhase('success');
    } catch {
      setPhase('error');
    }
  }

  if (blockedMessage && !alreadyLogged) {
    return (
      <>
        <PageHeader title="Logga träning" />
        <Card padding="lg">
          <EmptyState
            icon={<ClockIcon />}
            title="Går inte att logga just nu"
            body={blockedMessage}
          />
        </Card>
      </>
    );
  }

  if (alreadyLogged && !editing && phase === 'form') {
    return (
      <>
        <PageHeader title="Logga träning" />
        <Card variant="raised" padding="lg" className={styles.doneCard}>
          <Badge tone="completed" icon={<CheckIcon />}>
            Loggat idag
          </Badge>
          <p className={styles.doneActivity}>
            {existing.activity ?? 'Träning'} ·{' '}
            {formatMinutes(existing.durationMinutes)}
          </p>
          {existing.note && (
            <p className={styles.doneNote}>”{existing.note}”</p>
          )}
          <div className={styles.doneActions}>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Ändra pass
            </Button>
            <Link to="/gruppen">
              <Button variant="ghost">Till gruppen</Button>
            </Link>
          </div>
          <p className={styles.hint}>
            Du kan ändra dagens pass fram till midnatt.
          </p>
          <RetroactiveEntryLink data={data} />
        </Card>
      </>
    );
  }

  if (phase === 'success') {
    const nowQualifies = isQualifyingEntry(challenge, {
      durationMinutes: duration,
      hasProof: imageFile !== null || keepsExistingProof,
    });
    return (
      <div className={styles.successWrap}>
        <span className={styles.successMark} aria-hidden="true">
          <CheckIcon />
        </span>
        <h1 className={styles.successTitle}>Passet registrerat</h1>
        <p className={styles.successSub}>
          {activity || 'Träning'} · {formatMinutes(duration)}
        </p>
        {!nowQualifies && (
          <p className={styles.hint}>
            Observera: dagens krav är inte uppfyllt än (
            {formatMinutes(challenge.requiredMinutes)}
            {challenge.proofRequired ? ' + bildbevis' : ''}) — dagen räknas inte
            som genomförd förrän det stämmer.
          </p>
        )}
        <Card padding="md" className={styles.successStreak}>
          <span className={styles.streakLabel}>Din streak</span>
          <span className={`${styles.streakValue} tnum`}>
            {streakAfter} dagar
          </span>
        </Card>
        <div className={styles.successActions}>
          <Link to="/" className={styles.grow}>
            <Button fullWidth>Till hem</Button>
          </Link>
          <Link to="/gruppen" className={styles.grow}>
            <Button variant="secondary" fullWidth>
              Se gruppen
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const submitError =
    submitMutation.error instanceof SubmitTrainingError
      ? submitMutation.error.message
      : 'Passet kunde inte sparas. Kontrollera din uppkoppling och försök igen.';
  const entrySaved =
    submitMutation.error instanceof SubmitTrainingError &&
    submitMutation.error.entrySaved;

  return (
    <>
      <PageHeader
        title={editing ? 'Ändra pass' : 'Logga träning'}
        subtitle="Tid, aktivitet, kommentar och bildbevis – klart på under en minut."
      />

      <div className={styles.dateChip}>
        <ClockIcon className={styles.dateIcon} />
        <span>
          Idag · {capitalize(weekdayLong(today))} {formatLongDate(today)}
        </span>
      </div>

      {phase === 'error' && (
        <ErrorState
          title={
            entrySaved
              ? 'Passet sparades, bilden inte'
              : 'Passet kunde inte sparas'
          }
          message={submitError}
          onRetry={() => setPhase('form')}
        />
      )}

      <form
        className={styles.form}
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
      >
        {/* Duration */}
        <Card title="Tid" padding="md">
          <div className={styles.durationRow}>
            <button
              type="button"
              className={styles.stepBtn}
              onClick={() => setDuration((d) => Math.max(1, d - 5))}
              aria-label="Minska med 5 minuter"
            >
              −
            </button>
            <div className={styles.durationValue}>
              <span className="tnum">{duration}</span>
              <span className={styles.durationUnit}>min</span>
            </div>
            <button
              type="button"
              className={styles.stepBtn}
              onClick={() => setDuration((d) => d + 5)}
              aria-label="Öka med 5 minuter"
            >
              +
            </button>
          </div>
          <div className={styles.chips}>
            {QUICK_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className={[styles.chip, duration === m && styles.chipActive]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDuration(m)}
              >
                {m} min
              </button>
            ))}
          </div>
          {triedSubmit && !durationValid && (
            <p className={styles.fieldError}>
              Minst {formatMinutes(challenge.requiredMinutes)} krävs för en
              godkänd dag.
            </p>
          )}
          {durationValid && (
            <p className={styles.fieldOk}>
              <CheckIcon className={styles.okIcon} /> Uppfyller dagens krav
            </p>
          )}
        </Card>

        {/* Activity */}
        <Card title="Aktivitet (valfritt)" padding="md">
          <input
            type="text"
            className={styles.textInput}
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            placeholder="t.ex. Löpning"
            maxLength={120}
          />
          <div className={styles.chips}>
            {ACTIVITY_SUGGESTIONS.map((a) => (
              <button
                key={a}
                type="button"
                className={[styles.chip, activity === a && styles.chipActive]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setActivity(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </Card>

        {/* Note */}
        <Card title="Kommentar (valfritt)" padding="md">
          <textarea
            className={styles.textarea}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Hur kändes passet?"
            rows={3}
            maxLength={2000}
          />
        </Card>

        {/* Proof */}
        <Card
          title={challenge.proofRequired ? 'Bildbevis' : 'Bildbevis (valfritt)'}
          padding="md"
        >
          {keepsExistingProof && (
            <div className={styles.existingProof}>
              {existingProofQuery.data?.sessions[0]?.proofSignedUrl ? (
                <SignedProofImage
                  src={existingProofQuery.data.sessions[0].proofSignedUrl}
                  alt="Nuvarande bildbevis"
                />
              ) : (
                <Skeleton height="12rem" radius="var(--radius-md)" />
              )}
              <p className={styles.hint}>
                Behåller nuvarande bild om du inte väljer en ny.
              </p>
            </div>
          )}
          <ProofImagePicker
            file={imageFile}
            onChange={setImageFile}
            idPrefix="proof"
            promptTitle={
              keepsExistingProof ? 'Byt bild' : 'Lägg till bildbevis'
            }
          />
          {triedSubmit && !proofValid && (
            <p className={styles.fieldError}>
              Bildbevis krävs för den här utmaningen.
            </p>
          )}
        </Card>

        <div className={styles.submitBar}>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={submitMutation.isPending}
            disabled={triedSubmit && !canSubmit}
          >
            {submitMutation.isPending
              ? 'Sparar passet…'
              : editing
                ? 'Spara ändringar'
                : 'Registrera passet'}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setEditing(false);
                setPhase('form');
              }}
            >
              Avbryt
            </Button>
          )}
        </div>
      </form>

      {!editing && <RetroactiveEntryLink data={data} />}
    </>
  );
}
