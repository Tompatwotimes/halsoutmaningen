import { ProofImagePicker } from './ProofImagePicker';
import styles from './ProofSlots.module.css';

export interface ProofSlotsProps {
  /** Slot 1 (primary) file. */
  image1: File | null;
  /** Slot 2 (optional) file. */
  image2: File | null;
  onChange1: (file: File | null) => void;
  onChange2: (file: File | null) => void;
  /** Unique prefix for the underlying inputs on the page. */
  idPrefix: string;
  /** Whether slot 1 is mandatory for this challenge. */
  proofRequired: boolean;
  /**
   * When true (edit flow), an existing proof is kept if no new file is picked —
   * so slot 1 is not "missing" and slot 2 is available immediately.
   */
  hasExistingProof?: boolean;
}

/**
 * Two labelled proof slots — "Bevis 1 · Obligatoriskt" and
 * "Bevis 2 · Valfritt". Each is a full `ProofImagePicker` (camera / gallery,
 * remove, replace). Slot 2 stays disabled until slot 1 has a file (or an
 * existing proof is being kept), so a participant is never asked to fill a
 * second image before the first. Nothing here reserves an empty placeholder in
 * a read-only / historical view — this component is composer-only.
 */
export function ProofSlots({
  image1,
  image2,
  onChange1,
  onChange2,
  idPrefix,
  proofRequired,
  hasExistingProof = false,
}: ProofSlotsProps) {
  const slot2Enabled = image1 !== null || hasExistingProof;

  return (
    <div className={styles.slots}>
      <div className={styles.slot}>
        <div className={styles.slotHead}>
          <span className={styles.slotTitle}>Bevis 1</span>
          <span className={styles.slotTag}>
            {proofRequired ? 'Obligatoriskt' : 'Valfritt'}
          </span>
        </div>
        <ProofImagePicker
          file={image1}
          onChange={(f) => {
            onChange1(f);
            if (f === null) onChange2(null);
          }}
          idPrefix={`${idPrefix}-1`}
          promptTitle={hasExistingProof ? 'Byt bild 1' : 'Lägg till bildbevis'}
        />
      </div>

      <div
        className={[styles.slot, !slot2Enabled && styles.slotDisabled]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.slotHead}>
          <span className={styles.slotTitle}>Bevis 2</span>
          <span className={styles.slotTag}>Valfritt</span>
        </div>
        {slot2Enabled ? (
          <ProofImagePicker
            file={image2}
            onChange={onChange2}
            idPrefix={`${idPrefix}-2`}
            promptTitle="Lägg till en till bild"
            promptHint="T.ex. en skärmdump från Strava"
          />
        ) : (
          <p className={styles.slotLocked}>
            Lägg till Bevis 1 först om du vill ha med en andra bild.
          </p>
        )}
      </div>
    </div>
  );
}
