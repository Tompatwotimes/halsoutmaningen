import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ImageOffIcon } from '@/components/icons';
import styles from './SignedProofImage.module.css';

export interface SignedProofImageProps {
  /** Short-lived signed URL from Supabase Storage — never a public URL. */
  src: string;
  alt: string;
  /**
   * Called when the caller should mint a fresh signed URL (e.g. the visible
   * one may have expired) before this component retries the image itself.
   * Omit to hide the retry action entirely.
   */
  onRetry?: () => void;
}

/**
 * Renders a private proof photo from a short-lived signed URL, with its own
 * loading and failed-to-load states (Part 8 of the real-data phase). The URL
 * itself is requested by the caller only when the detail view is opened.
 *
 * `loading="lazy"` (egress forensics, 2026-09): a chat page can render many
 * of these at once (one per training card); without native lazy-loading the
 * browser downloaded every image's full bytes on mount regardless of scroll
 * position.
 *
 * PRODUCTION REGRESSION, fixed same cycle (2026-09): the loading placeholder
 * used to hide the `<img>` itself via inline `display: none` while
 * `status === 'loading'`. Combined with `loading="lazy"`, that was a
 * deadlock: an element with no layout box has no measurable distance from
 * the viewport, so the browser (WebKit in particular, confirmed on a real
 * iOS Home Screen PWA) never decided the image was "near" and never even
 * started the fetch — `onLoad` could then never fire, so `status` could
 * never leave `'loading'`, so the image stayed hidden forever, for every
 * proof image regardless of actual scroll position. Fixed by never removing
 * the `<img>` from layout: it always renders at full size and only its
 * `opacity` changes, with the loading Skeleton absolutely positioned on top
 * (`.frame` is already `position: relative`) instead of swapped in via
 * conditional rendering. This keeps a real, measurable layout box present
 * for `loading="lazy"` (or any IntersectionObserver-based caller, see
 * `useNearViewport`) at every point in the lifecycle.
 */
export function SignedProofImage({ src, alt, onRetry }: SignedProofImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );
  // Bumped on retry so React mounts a genuinely new <img> element — reusing
  // the same element with an unchanged `src` would not make the browser
  // reattempt a fetch it already marked failed.
  const [attempt, setAttempt] = useState(0);

  return (
    <div className={styles.frame}>
      {status !== 'error' && (
        <img
          key={attempt}
          src={src}
          alt={alt}
          className={styles.img}
          loading="lazy"
          style={{ opacity: status === 'loaded' ? 1 : 0 }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
      {status === 'loading' && (
        <div className={styles.skeletonOverlay}>
          <Skeleton width="100%" height="100%" radius="0" />
        </div>
      )}
      {status === 'error' && (
        <div className={styles.fallback}>
          <ImageOffIcon className={styles.fallbackIcon} />
          <span>Bilden kunde inte laddas.</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Retrying the same element is always safe (a transient network
              // failure needs no new URL); `onRetry` additionally lets the
              // caller mint a fresh signed URL first, for when the old one
              // itself has expired.
              onRetry?.();
              setAttempt((a) => a + 1);
              setStatus('loading');
            }}
          >
            Försök igen
          </Button>
        </div>
      )}
    </div>
  );
}
