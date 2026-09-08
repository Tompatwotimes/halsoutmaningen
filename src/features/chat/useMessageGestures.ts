import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DOUBLE_TAP_MS,
  TAP_SLOP_PX,
  classifyPointerMove,
  clampSwipeDx,
  isChatImageTarget,
  isInteractiveEventTarget,
  isSwipeArmed,
} from './chat';

/**
 * Touch/pen gesture layer for one chat message card (design §6). Mouse is left
 * to the existing desktop `onDoubleClick` + explicit buttons — a `mouse`
 * pointer makes this hook completely inert, so the two paths never both fire.
 *
 *  - **Swipe right** past `REPLY_SWIPE_ARM_PX` and release → `onArmReply()`
 *    once. The card follows the finger up to `REPLY_SWIPE_MAX_PX`; below the
 *    threshold (or any leftward / vertical move) it just snaps back. A vertical
 *    move classifies as `vscroll` and can never become a swipe, so native chat
 *    scrolling is untouched. `preventDefault` is called only once the move is
 *    confidently horizontal.
 *  - **Double-tap** (two stationary taps within `DOUBLE_TAP_MS`) on a
 *    non-control area → `onDoubleTapLike()` **only when not already liked and
 *    not pending** (MAKE LIKED — never a toggle, never an unlike) + always
 *    `onCloseLightbox()` (a photo double-tap hearts the message and dismisses
 *    the viewer the first tap opened). A double-tap on an action / moderation
 *    button does nothing; a double-tap on an image thumb still likes.
 *
 * One `pointerId` is tracked at a time; a second finger is ignored. Every exit
 * path (release, cancel, unmount) fully resets the translation and state.
 */
export interface UseMessageGesturesInput {
  /** `false` for a hidden message — no swipe, no double-tap, no pop. */
  enabled: boolean;
  likedByMe: boolean;
  likePending: boolean;
  onArmReply: () => void;
  onDoubleTapLike: () => void;
  onCloseLightbox: () => void;
}

export interface UseMessageGesturesResult {
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
  };
  /** px to translate the card by right now (`0` at rest). */
  swipeDx: number;
  /** the swipe has passed the arm threshold — for the affordance's "armed" look. */
  armed: boolean;
  /** an active swipe drag is in progress — suppress the snap-back transition. */
  dragging: boolean;
  /** brief `true` after a successful double-tap like — for the heart pop. */
  popping: boolean;
}

type Phase = 'idle' | 'vscroll' | 'swipe';

interface GestureState {
  pointerId: number | null;
  phase: Phase;
  startX: number;
  startY: number;
  startedInteractive: boolean;
  startedOnImage: boolean;
  moved: boolean;
  tapCount: number;
  tapTimer: ReturnType<typeof setTimeout> | null;
}

function isTouchLike(t: string): boolean {
  return t === 'touch' || t === 'pen';
}

export function useMessageGestures(
  input: UseMessageGesturesInput,
): UseMessageGesturesResult {
  const [swipeDx, setSwipeDx] = useState(0);
  const [armed, setArmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [popping, setPopping] = useState(false);

  // Live props, so a gesture that began under old props still finishes with
  // the current liked / pending state and the current callbacks.
  const p = useRef(input);
  p.current = input;

  const g = useRef<GestureState>({
    pointerId: null,
    phase: 'idle',
    startX: 0,
    startY: 0,
    startedInteractive: false,
    startedOnImage: false,
    moved: false,
    tapCount: 0,
    tapTimer: null,
  });
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (g.current.tapTimer) clearTimeout(g.current.tapTimer);
      if (popTimer.current) clearTimeout(popTimer.current);
    },
    [],
  );

  const clearTap = useCallback(() => {
    if (g.current.tapTimer) clearTimeout(g.current.tapTimer);
    g.current.tapTimer = null;
    g.current.tapCount = 0;
  }, []);

  const resetSwipe = useCallback(() => {
    g.current.pointerId = null;
    g.current.phase = 'idle';
    g.current.moved = false;
    setSwipeDx(0);
    setArmed(false);
    setDragging(false);
  }, []);

  const releaseCapture = useCallback((e: ReactPointerEvent) => {
    const el = e.currentTarget as unknown as {
      releasePointerCapture?: (id: number) => void;
      hasPointerCapture?: (id: number) => boolean;
    };
    try {
      if (el.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture?.(e.pointerId);
      }
    } catch {
      /* jsdom / unsupported — nothing to release */
    }
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!p.current.enabled) return;
    if (!isTouchLike(e.pointerType)) return; // mouse → desktop path
    if (g.current.pointerId !== null) return; // already tracking a pointer

    g.current.pointerId = e.pointerId;
    g.current.phase = 'idle';
    g.current.startX = e.clientX;
    g.current.startY = e.clientY;
    g.current.startedInteractive = isInteractiveEventTarget(e.target);
    g.current.startedOnImage = isChatImageTarget(e.target);
    g.current.moved = false;

    // If a first tap is already pending, this pointerdown is very likely the
    // second tap of a double-tap → suppress its compat click so an image thumb
    // does not re-open the lightbox we are about to close.
    if (g.current.tapCount === 1 && g.current.startedOnImage) {
      e.preventDefault();
    }
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const s = g.current;
    if (s.pointerId === null || e.pointerId !== s.pointerId) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      s.moved = true;
    }

    if (s.phase === 'idle') {
      const next = classifyPointerMove({ dx, dy });
      if (next === 'vscroll') {
        s.phase = 'vscroll';
        return;
      }
      if (next === 'swipe' && !s.startedInteractive) {
        s.phase = 'swipe';
        const el = e.currentTarget as unknown as {
          setPointerCapture?: (id: number) => void;
        };
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          /* unsupported */
        }
        setDragging(true);
      } else {
        return;
      }
    }

    if (s.phase === 'swipe') {
      e.preventDefault();
      const clamped = clampSwipeDx(dx);
      setSwipeDx(clamped);
      setArmed(isSwipeArmed(dx));
    }
  }, []);

  const finishTapSequence = useCallback(
    (e: ReactPointerEvent) => {
      const s = g.current;
      // A tap must be stationary and must not have started on an action /
      // moderation control (an image thumb is allowed — a photo double-tap
      // likes the message).
      const isTapEligible =
        !s.moved && (!s.startedInteractive || s.startedOnImage);
      if (!isTapEligible) {
        clearTap();
        return;
      }

      s.tapCount += 1;
      if (s.tapCount === 1) {
        if (s.tapTimer) clearTimeout(s.tapTimer);
        s.tapTimer = setTimeout(() => {
          s.tapTimer = null;
          s.tapCount = 0;
        }, DOUBLE_TAP_MS);
        return;
      }

      // second tap within the window → double-tap
      e.preventDefault();
      clearTap();
      p.current.onCloseLightbox();
      if (!p.current.likedByMe && !p.current.likePending) {
        p.current.onDoubleTapLike();
        setPopping(true);
        if (popTimer.current) clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => setPopping(false), 200);
      }
    },
    [clearTap],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const s = g.current;
      if (s.pointerId === null || e.pointerId !== s.pointerId) return;
      releaseCapture(e);

      if (s.phase === 'swipe') {
        const dx = e.clientX - s.startX;
        if (isSwipeArmed(dx)) p.current.onArmReply();
        clearTap(); // a swipe is never part of a double-tap
        resetSwipe();
        return;
      }

      // idle / vscroll release → maybe a tap
      if (s.phase === 'idle') {
        finishTapSequence(e);
      } else {
        clearTap(); // vscroll clears tap eligibility
      }
      resetSwipe();
    },
    [releaseCapture, clearTap, resetSwipe, finishTapSequence],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      if (g.current.pointerId !== null && e.pointerId === g.current.pointerId) {
        releaseCapture(e);
      }
      clearTap();
      resetSwipe();
    },
    [releaseCapture, clearTap, resetSwipe],
  );

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    swipeDx,
    armed,
    dragging,
    popping,
  };
}
