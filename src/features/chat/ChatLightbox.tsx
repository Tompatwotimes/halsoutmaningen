import { useCallback, useEffect, useRef, useState } from 'react';
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
  const backdropRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const go = useCallback(
    (delta: number) => {
      setFailed(false);
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  // Move focus into the viewer on open and restore it to whatever opened it on
  // close (the thumbnail button), so it never lands on an element hidden
  // behind the backdrop.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    backdropRef.current?.focus();
    const opener = openerRef.current;
    return () => opener?.focus();
  }, []);

  // Keyboard handling lives on a `document` capture-phase listener rather than
  // a React `onKeyDown` on the backdrop. Two reasons:
  //   1. It works no matter where focus currently is. A React handler on the
  //      backdrop only fires while focus is inside that subtree — but focus can
  //      drift to <body> (e.g. an admin hides the image message while the
  //      viewer is open and the focus-restore target is now detached). The old
  //      backdrop-only handler left Escape/arrows dead in that state.
  //   2. Capture phase + stopImmediatePropagation runs BEFORE the ancestor
  //      Sheet's own key handling, so one Escape closes only the image, never
  //      the whole chat.
  // Tab is trapped within the viewer's own controls so it never walks into the
  // chat behind the backdrop.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.stopImmediatePropagation();
        go(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.stopImmediatePropagation();
        go(1);
        return;
      }
      if (e.key === 'Tab') {
        const backdrop = backdropRef.current;
        const focusables = backdrop?.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        e.stopImmediatePropagation();
        if (!focusables || focusables.length === 0) {
          e.preventDefault();
          backdrop?.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const inside = backdrop?.contains(active) ?? false;
        if (
          e.shiftKey &&
          (active === first || active === backdrop || !inside)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [go, onClose]);

  const url = urls[index] ?? null;

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Bildvisning"
      tabIndex={-1}
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
