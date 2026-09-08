import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMessageGestures } from './useMessageGestures';

/**
 * A minimal synthetic PointerEvent-ish object. Only the fields the hook reads.
 */
function pe(over: Partial<Record<string, unknown>> = {}) {
  const el = (over.currentTarget as HTMLElement) ?? document.createElement('div');
  return {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 0,
    clientY: 0,
    target: (over.target as EventTarget) ?? el,
    currentTarget: el,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...over,
  } as unknown as React.PointerEvent;
}

function base() {
  return {
    enabled: true,
    likedByMe: false,
    likePending: false,
    onArmReply: vi.fn(),
    onDoubleTapLike: vi.fn(),
    onCloseLightbox: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useMessageGestures — swipe to reply', () => {
  it('a right drag past the threshold then release arms reply exactly once', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el, clientX: 0 }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 40 }));
    });
    expect(result.current.swipeDx).toBe(40);
    expect(result.current.armed).toBe(false);
    act(() => {
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 80 }));
    });
    expect(result.current.armed).toBe(true);
    act(() => {
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 80 }));
    });
    expect(p.onArmReply).toHaveBeenCalledTimes(1);
    expect(result.current.swipeDx).toBe(0);
    expect(result.current.armed).toBe(false);
  });

  it('a right drag that never reaches the threshold does NOT arm reply', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 30 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 30 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    expect(result.current.swipeDx).toBe(0);
  });

  it('merely crossing the threshold mid-drag does not fire — the action commits on release', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 90 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    act(() => {
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 20 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 20 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
  });

  it('clamps the visual follow so the card cannot slide off-screen', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 400 }));
    });
    expect(result.current.swipeDx).toBe(96);
  });

  it('a leftward drag never arms reply and never translates', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: -90 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: -90 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    expect(result.current.swipeDx).toBe(0);
  });

  it('a vertical move classifies as scroll and can never become a swipe', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(
        pe({ currentTarget: el, clientX: 3, clientY: 40 }),
      );
      // now a big rightward move — must stay classified as vscroll
      result.current.handlers.onPointerMove(
        pe({ currentTarget: el, clientX: 120, clientY: 45 }),
      );
      result.current.handlers.onPointerUp(
        pe({ currentTarget: el, clientX: 120, clientY: 45 }),
      );
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    expect(result.current.swipeDx).toBe(0);
  });

  it('does not start a swipe when the gesture begins on an interactive child', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    const button = document.createElement('button');
    act(() => {
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, target: button }),
      );
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 90 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 90 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    expect(result.current.swipeDx).toBe(0);
  });

  it('pointercancel snaps the card back and arms nothing', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 80 }));
    });
    expect(result.current.swipeDx).toBe(80);
    act(() => {
      result.current.handlers.onPointerCancel(pe({ currentTarget: el }));
    });
    expect(result.current.swipeDx).toBe(0);
    expect(p.onArmReply).not.toHaveBeenCalled();
  });

  it('a second pointer is ignored while one is being tracked', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, pointerId: 1, clientX: 0 }),
      );
      result.current.handlers.onPointerMove(
        pe({ currentTarget: el, pointerId: 2, clientX: 200 }),
      );
    });
    // the 2nd pointer's move did not drive the swipe
    expect(result.current.swipeDx).toBe(0);
  });

  it('resets fully so a later independent swipe still works', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 80 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 80 }));
    });
    expect(p.onArmReply).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 90 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 90 }));
    });
    expect(p.onArmReply).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when disabled', () => {
    const p = { ...base(), enabled: false };
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 90 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 90 }));
    });
    expect(p.onArmReply).not.toHaveBeenCalled();
    expect(result.current.swipeDx).toBe(0);
  });
});

describe('useMessageGestures — double tap to like', () => {
  function twoTaps(
    result: { current: ReturnType<typeof useMessageGestures> },
    el: HTMLElement,
    gapMs: number,
    target?: EventTarget,
  ) {
    act(() => {
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, target, clientX: 0, clientY: 0 }),
      );
      result.current.handlers.onPointerUp(
        pe({ currentTarget: el, target, clientX: 0, clientY: 0 }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(gapMs);
    });
    act(() => {
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, target, clientX: 0, clientY: 0 }),
      );
      result.current.handlers.onPointerUp(
        pe({ currentTarget: el, target, clientX: 0, clientY: 0 }),
      );
    });
  }

  it('two quick taps on an unliked message request a like exactly once', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    twoTaps(result, el, 100);
    expect(p.onDoubleTapLike).toHaveBeenCalledTimes(1);
  });

  it('a double tap on an already-liked message does NOT call the like handler', () => {
    const p = { ...base(), likedByMe: true };
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    twoTaps(result, el, 100);
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('a double tap while a like is pending does nothing', () => {
    const p = { ...base(), likePending: true };
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    twoTaps(result, el, 100);
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('two taps outside the time window are not a double tap', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    twoTaps(result, el, 400);
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('a swipe between the taps clears tap eligibility', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el }));
    });
    act(() => {
      // a swipe gesture in between
      result.current.handlers.onPointerDown(pe({ currentTarget: el, clientX: 0 }));
      result.current.handlers.onPointerMove(pe({ currentTarget: el, clientX: 80 }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el, clientX: 80 }));
    });
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el }));
    });
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('a mouse pointer never triggers the gesture double-tap', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    act(() => {
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, pointerType: 'mouse' }),
      );
      result.current.handlers.onPointerUp(
        pe({ currentTarget: el, pointerType: 'mouse' }),
      );
      result.current.handlers.onPointerDown(
        pe({ currentTarget: el, pointerType: 'mouse' }),
      );
      result.current.handlers.onPointerUp(
        pe({ currentTarget: el, pointerType: 'mouse' }),
      );
    });
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('a double tap on an action button does NOT heart the row', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    const button = document.createElement('button');
    twoTaps(result, el, 100, button);
    expect(p.onDoubleTapLike).not.toHaveBeenCalled();
  });

  it('a double tap on an image thumb hearts the row AND closes the lightbox', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    const thumb = document.createElement('button');
    thumb.setAttribute('data-chat-image', '');
    twoTaps(result, el, 100, thumb);
    expect(p.onDoubleTapLike).toHaveBeenCalledTimes(1);
    expect(p.onCloseLightbox).toHaveBeenCalled();
  });

  it('resets tap state after a successful double tap (a third tap is a fresh single tap)', () => {
    const p = base();
    const { result } = renderHook(() => useMessageGestures(p));
    const el = document.createElement('div');
    twoTaps(result, el, 100);
    expect(p.onDoubleTapLike).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.handlers.onPointerDown(pe({ currentTarget: el }));
      result.current.handlers.onPointerUp(pe({ currentTarget: el }));
      vi.advanceTimersByTime(400);
    });
    expect(p.onDoubleTapLike).toHaveBeenCalledTimes(1);
  });
});
