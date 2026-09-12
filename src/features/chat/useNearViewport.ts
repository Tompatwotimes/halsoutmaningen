import { useEffect, useRef, useState } from 'react';

const DEFAULT_ROOT_MARGIN = '600px 0px 600px 0px';

/**
 * Whether the element `ref` is attached to has ever been near the viewport —
 * a one-way latch: once true, it never goes back to false, so a card that
 * scrolled into view once never re-fetches or re-hides its image on scrolling
 * away and back (regression brief requirement: "AFTER SCROLL INTO VIEW: image
 * loads exactly once").
 *
 * Introduced for the 2026-09 chat-image regression: native `<img
 * loading="lazy">` alone proved unreliable to gate on here (see
 * `SignedProofImage.tsx`'s fixed display:none deadlock) and gives no control
 * over how early to start preloading relative to this app's manually
 * scroll-pinned chat container. This hook is the app-controlled replacement —
 * it gates *signed URL generation* (the actual egress-relevant work), not
 * just image decoding.
 *
 * `root: null` (the browser viewport) is used deliberately rather than the
 * chat's own scroll container: IntersectionObserver's intersection rectangle
 * is already clipped by every intervening `overflow` ancestor in the chain,
 * so viewport-root correctly reports "on/near screen" for content inside a
 * nested scroll region without needing that container's ref threaded down
 * through props. Falls back to "always near" when IntersectionObserver
 * itself is unavailable (older WebKit, or a test environment) — offscreen
 * content must never silently stay hidden just because the API is missing.
 */
export function useNearViewport<T extends Element>(
  rootMargin: string = DEFAULT_ROOT_MARGIN,
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return [ref, near];
}
