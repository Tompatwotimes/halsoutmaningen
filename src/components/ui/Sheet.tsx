import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Hides the visible title bar but keeps an accessible label. */
  hideHeader?: boolean;
  ariaLabel?: string;
  children: ReactNode;
  /** Rendered as a sticky footer action row. */
  footer?: ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  hideHeader = false,
  ariaLabel,
  children,
  footer,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef<HTMLElement | null>(null);
  const headingId = useId();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => {
      const node = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (node ?? panelRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      lastActive.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Stäng"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !hideHeader ? headingId : undefined}
        aria-label={!title || hideHeader ? (ariaLabel ?? 'Dialog') : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {hideHeader ? (
          <>
            <span className={styles.grabberLoose} aria-hidden="true" />
            <button
              type="button"
              className={styles.closeFloat}
              onClick={onClose}
              aria-label="Stäng"
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <header className={styles.header}>
            <span className={styles.grabber} aria-hidden="true" />
            <div className={styles.headerRow}>
              <h2 id={headingId} className={styles.title}>
                {title}
              </h2>
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Stäng"
              >
                <CloseIcon />
              </button>
            </div>
          </header>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
