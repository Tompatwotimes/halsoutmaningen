import { useCallback, useEffect, useState } from 'react';
import { CloseIcon, ImageOffIcon } from '@/components/icons';
import styles from './ChatLightbox.module.css';

/**
 * Full-screen image viewer for a chat message's attachments. Original aspect
 * ratio (`object-fit: contain`). Closes on the button, a backdrop tap or
 * `Escape`; left/right arrows and the on-screen chevrons move between images.
 * No dependency — a small in-repo component.
 */
export function ChatLightbox({
  urls,
  startIndex,
  onClose,
}: {
  /** Signed URLs in display order; a slot may be null (denied/failed). */
  urls: (string | null)[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [failed, setFailed] = useState(false);
  const count = urls.length;

  const go = useCallback(
    (delta: number) => {
      setFailed(false);
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, go]);

  const url = urls[index] ?? null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Bildvisning"
      onClick={onClose}
    >
      <button
        type="button"
        className={styles.close}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Stäng"
      >
        <CloseIcon />
      </button>

      {count > 1 && (
        <button
          type="button"
          className={[styles.nav, styles.prev].join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Föregående bild"
        >
          ‹
        </button>
      )}

      <div className={styles.stage} onClick={(e) => e.stopPropagation()}>
        {url === null || failed ? (
          <div className={styles.broken}>
            <ImageOffIcon />
            <span>Bilden kunde inte laddas.</span>
          </div>
        ) : (
          <img
            src={url}
            alt={`Bild ${index + 1} av ${count}`}
            className={styles.image}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className={[styles.nav, styles.next].join(' ')}
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Nästa bild"
          >
            ›
          </button>
          <p className={styles.counter}>
            {index + 1} / {count}
          </p>
        </>
      )}
    </div>
  );
}
