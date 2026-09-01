import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { DayState } from '@/domain/dayState';
import { formatMinutes } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import {
  CameraIcon,
  CheckIcon,
  CloseIcon,
  ClockIcon,
} from '@/components/icons';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { formatDayMonth } from '@/domain/format';
import styles from './LogPage.module.css';

type Phase = 'form' | 'submitting' | 'success' | 'error';

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
  if (isError || !data) {
    return (
      <>
        <PageHeader title="Logga träning" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }

  return <LogForm data={data} />;
}

function LogForm({
  data,
}: {
  data: NonNullable<ReturnType<typeof useChallengeData>['data']>;
}) {
  const { challenge, today, self } = data;
  const existing = data.getEntry(self.userId, today);
  const alreadyLogged = self.todayState === DayState.Completed && existing;

  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [duration, setDuration] = useState<number>(
    existing?.durationMinutes ?? challenge.requiredMinutes,
  );
  const [activity, setActivity] = useState(existing?.activity ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const durationValid = duration >= challenge.requiredMinutes;
  const proofValid = !challenge.proofRequired || imageName !== null;
  const canSubmit = durationValid && proofValid;

  const streakAfter = useMemo(
    () =>
      self.todayState === DayState.Completed
        ? self.currentStreak
        : self.currentStreak + 1,
    [self],
  );

  function handleImage(event: SyntheticEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageName(file.name);
    setImageUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageName(null);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setTriedSubmit(true);
    if (!canSubmit) return;

    setPhase('submitting');
    await new Promise((r) => setTimeout(r, 1100));
    if (simulateFailure) {
      setPhase('error');
      return;
    }
    setPhase('success');
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
            {existing.activity} · {formatMinutes(existing.durationMinutes)}
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
        </Card>
      </>
    );
  }

  if (phase === 'success') {
    return (
      <div className={styles.successWrap}>
        <span className={styles.successMark} aria-hidden="true">
          <CheckIcon />
        </span>
        <h1 className={styles.successTitle}>Passet registrerat</h1>
        <p className={styles.successSub}>
          {activity || 'Träning'} · {formatMinutes(duration)}
        </p>
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

  return (
    <>
      <PageHeader
        title={editing ? 'Ändra pass' : 'Logga träning'}
        subtitle="Tid, aktivitet, kommentar och bildbevis – klart på under en minut."
      />

      <div className={styles.dateChip}>
        <ClockIcon className={styles.dateIcon} />
        <span>
          Idag · {capitalize(weekdayLong(today))} {formatDayMonth(today)}
        </span>
      </div>

      {phase === 'error' && (
        <ErrorState
          title="Passet kunde inte sparas"
          message="Kontrollera din uppkoppling och försök igen. Inget har registrerats."
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
          <input
            ref={fileRef}
            id="proof-input"
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.fileInput}
            onChange={handleImage}
          />
          {imageUrl ? (
            <div className={styles.preview}>
              <img src={imageUrl} alt="Förhandsvisning av bildbevis" />
              <button
                type="button"
                className={styles.previewRemove}
                onClick={clearImage}
                aria-label="Ta bort bild"
              >
                <CloseIcon />
              </button>
              <span className={styles.previewName}>{imageName}</span>
            </div>
          ) : (
            <label htmlFor="proof-input" className={styles.dropzone}>
              <CameraIcon className={styles.dropIcon} />
              <span className={styles.dropTitle}>Ta bild eller välj bild</span>
              <span className={styles.dropHint}>
                Kameran öppnas direkt på mobilen
              </span>
            </label>
          )}
          {triedSubmit && !proofValid && (
            <p className={styles.fieldError}>
              Bildbevis krävs för den här utmaningen.
            </p>
          )}
        </Card>

        {import.meta.env.DEV && (
          <label className={styles.devToggle}>
            <input
              type="checkbox"
              checked={simulateFailure}
              onChange={(e) => setSimulateFailure(e.target.checked)}
            />
            Simulera nätverksfel (förhandsvisning)
          </label>
        )}

        <div className={styles.submitBar}>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={phase === 'submitting'}
            disabled={triedSubmit && !canSubmit}
          >
            {phase === 'submitting'
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
    </>
  );
}
