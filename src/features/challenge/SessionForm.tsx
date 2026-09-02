import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { formatMinutes } from '@/domain/format';
import { Button } from '@/components/ui/Button';
import { CameraIcon, CloseIcon, ImageOffIcon } from '@/components/icons';
import {
  probeImage,
  HEIC_UNSUPPORTED_MESSAGE,
  GENERIC_UNSUPPORTED_MESSAGE,
} from './heic';
import styles from './SessionForm.module.css';

const QUICK_MINUTES = [30, 40, 45, 60];

export interface SessionFormValue {
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  proofFile: File | null;
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const durationValid = duration >= minMinutes;
  const proofValid = !proofRequired || imageFile !== null;
  const canSubmit = durationValid && proofValid;

  async function handleImage(event: SyntheticEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setImageError(null);
    const probe = await probeImage(file);
    if (!probe.decodable) {
      setImageError(
        probe.likelyHeic
          ? HEIC_UNSUPPORTED_MESSAGE
          : GENERIC_UNSUPPORTED_MESSAGE,
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageFile(null);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function submit(e: SyntheticEvent) {
    e.preventDefault();
    setTried(true);
    if (!canSubmit) return;
    onSubmit({
      durationMinutes: duration,
      activity: activity.trim() || null,
      note: note.trim() || null,
      proofFile: imageFile,
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.fileInput}
        id="session-proof"
        onChange={(e) => void handleImage(e)}
      />
      {imageUrl ? (
        <div className={styles.preview}>
          <img src={imageUrl} alt="Förhandsvisning" />
          <button
            type="button"
            className={styles.previewRemove}
            onClick={clearImage}
            aria-label="Ta bort bild"
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <label htmlFor="session-proof" className={styles.drop}>
          <CameraIcon className={styles.dropIcon} />
          <span>
            {proofRequired ? 'Bildbevis för passet' : 'Bildbevis (valfritt)'}
          </span>
        </label>
      )}
      {imageError && (
        <p className={styles.err}>
          <ImageOffIcon className={styles.errIcon} /> {imageError}
        </p>
      )}
      {tried && !proofValid && !imageError && (
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
