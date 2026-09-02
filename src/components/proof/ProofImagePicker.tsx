import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  CameraIcon,
  CloseIcon,
  ImageIcon,
  ImageOffIcon,
} from '@/components/icons';
import {
  probeImage,
  HEIC_UNSUPPORTED_MESSAGE,
  GENERIC_UNSUPPORTED_MESSAGE,
} from '@/features/challenge/heic';
import styles from './ProofImagePicker.module.css';

export interface ProofImagePickerProps {
  /** The currently selected proof file, or null. Owned by the parent form. */
  file: File | null;
  /** Receives a validated, browser-decodable image — or null when cleared. */
  onChange: (file: File | null) => void;
  /**
   * Unique prefix for the two hidden file-input `id`s. Must be unique among
   * pickers mounted on the same page.
   */
  idPrefix: string;
  /** Heading shown in the empty prompt. */
  promptTitle?: string;
  /** Sub-text under the heading in the empty prompt. */
  promptHint?: string;
  className?: string;
}

/**
 * Shared proof-image input used by every training-logging surface.
 *
 * The two choices map to two separate `<input type="file">` elements:
 *
 * - "Ta foto" carries `capture="environment"`, so mobile browsers open the
 *   rear camera directly.
 * - "Välj från bilder" has **no** `capture` attribute, so mobile browsers open
 *   the normal photo library / file picker.
 *
 * A single input with `capture` set (the previous implementation) gave phones
 * no obvious way to reach the gallery. Desktop browsers ignore `capture`, so
 * both choices behave as an ordinary file dialog there.
 *
 * Both inputs feed the same handler: HEIC/undecodable files are rejected up
 * front (see `heic.ts`) before the parent ever sees the file.
 */
export function ProofImagePicker({
  file,
  onChange,
  idPrefix,
  promptTitle = 'Lägg till bildbevis',
  promptHint,
  className,
}: ProofImagePickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // The preview URL is derived entirely from the current file — created and
  // revoked together so a rejected or replaced file never leaks an object URL.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetInputs() {
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  }

  async function handleFiles(event: SyntheticEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    if (!picked) return;
    setError(null);

    const probe = await probeImage(picked);
    if (!probe.decodable) {
      setError(
        probe.likelyHeic
          ? HEIC_UNSUPPORTED_MESSAGE
          : GENERIC_UNSUPPORTED_MESSAGE,
      );
      resetInputs();
      onChange(null);
      return;
    }

    onChange(picked);
  }

  function clear() {
    setError(null);
    resetInputs();
    onChange(null);
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <input
        ref={cameraRef}
        id={`${idPrefix}-camera`}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.input}
        tabIndex={-1}
        aria-label="Ta foto med kameran"
        onChange={(e) => void handleFiles(e)}
      />
      <input
        ref={galleryRef}
        id={`${idPrefix}-gallery`}
        type="file"
        accept="image/*"
        className={styles.input}
        tabIndex={-1}
        aria-label="Välj bild från galleriet"
        onChange={(e) => void handleFiles(e)}
      />

      {previewUrl ? (
        <div className={styles.preview}>
          <img src={previewUrl} alt="Förhandsvisning av bildbevis" />
          <button
            type="button"
            className={styles.remove}
            onClick={clear}
            aria-label="Ta bort bild"
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <div className={styles.prompt}>
          <CameraIcon className={styles.promptIcon} aria-hidden="true" />
          <span className={styles.promptTitle}>{promptTitle}</span>
          {promptHint && (
            <span className={styles.promptHint}>{promptHint}</span>
          )}
          <div className={styles.choices}>
            <button
              type="button"
              className={styles.choice}
              onClick={() => cameraRef.current?.click()}
            >
              <CameraIcon className={styles.choiceIcon} aria-hidden="true" />
              Ta foto
            </button>
            <button
              type="button"
              className={styles.choice}
              onClick={() => galleryRef.current?.click()}
            >
              <ImageIcon className={styles.choiceIcon} aria-hidden="true" />
              Välj från bilder
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          <ImageOffIcon className={styles.errorIcon} aria-hidden="true" />{' '}
          {error}
        </p>
      )}
    </div>
  );
}
