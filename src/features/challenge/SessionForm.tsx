import { useState, type SyntheticEvent } from 'react';
import { formatMinutes } from '@/domain/format';
import { Button } from '@/components/ui/Button';
import { ProofSlots } from '@/components/proof/ProofSlots';
import styles from './SessionForm.module.css';

const QUICK_MINUTES = [30, 40, 45, 60];

export interface SessionFormValue {
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  /** 0, 1 or 2 files — `[0]` is the primary proof slot, `[1]` the optional one. */
  proofFiles: File[];
}

interface Props {
  /** Minimum minutes for this individual session to count. */
  minMinutes: number;
  proofRequired: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (value: SessionFormValue) => void;
  onCancel?: (() => void) | undefined;
}

/** Compact single-session capture — a lighter sibling of the main LogPage form. */
export function SessionForm({
  minMinutes,
  proofRequired,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [duration, setDuration] = useState(Math.max(minMinutes, 30));
  const [activity, setActivity] = useState('');
  const [note, setNote] = useState('');
  const [image1, setImage1] = useState<File | null>(null);
  const [image2, setImage2] = useState<File | null>(null);
  const [tried, setTried] = useState(false);

  const durationValid = duration >= minMinutes;
  const proofValid = !proofRequired || image1 !== null;
  const canSubmit = durationValid && proofValid;

  function submit(e: SyntheticEvent) {
    e.preventDefault();
    setTried(true);
    if (!canSubmit) return;
    onSubmit({
      durationMinutes: duration,
      activity: activity.trim() || null,
      note: note.trim() || null,
      proofFiles: [image1, image2].filter((f): f is File => f !== null),
    });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
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
      {tried && !durationValid && (
        <p className={styles.err}>
          Minst {formatMinutes(minMinutes)} för att passet ska räknas.
        </p>
      )}

      <input
        type="text"
        className={styles.text}
        value={activity}
        onChange={(e) => setActivity(e.target.value)}
        placeholder="Aktivitet (valfritt)"
        maxLength={120}
      />
      <input
        type="text"
        className={styles.text}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Kommentar (valfritt)"
        maxLength={2000}
      />

      <ProofSlots
        image1={image1}
        image2={image2}
        onChange1={setImage1}
        onChange2={setImage2}
        idPrefix="session-proof"
        proofRequired={proofRequired}
      />
      {tried && !proofValid && (
        <p className={styles.err}>Bildbevis krävs för det här passet.</p>
      )}

      <div className={styles.actions}>
        <Button type="submit" fullWidth loading={submitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" fullWidth onClick={onCancel}>
            Avbryt
          </Button>
        )}
      </div>
    </form>
  );
}
