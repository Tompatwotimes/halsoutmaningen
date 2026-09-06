import { vi } from 'vitest';

/**
 * jsdom ships no `ResizeObserver`. `ChatPanel` uses one to re-assert its
 * "pinned to the newest message" position after asynchronous media / layout
 * growth (B1). This installs a controllable stub: every observed element's
 * callback fires only when the test calls `trigger()`, so a layout change can
 * be simulated deterministically.
 */
export interface ResizeObserverMockHandle {
  /** Synchronously invoke every registered observer callback. */
  trigger: () => void;
  /** Restore whatever `globalThis.ResizeObserver` was before install. */
  uninstall: () => void;
  /** How many observers are currently connected (observe minus disconnect). */
  readonly observerCount: number;
}

export function installResizeObserverMock(): ResizeObserverMockHandle {
  const callbacks = new Set<ResizeObserverCallback>();
  const previous = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  class ResizeObserverMock {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(): void {
      callbacks.add(this.cb);
    }
    unobserve(): void {
      callbacks.delete(this.cb);
    }
    disconnect(): void {
      callbacks.delete(this.cb);
    }
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  return {
    trigger() {
      for (const cb of callbacks) {
        cb([], {} as ResizeObserver);
      }
    },
    uninstall() {
      if (previous === undefined) {
        vi.stubGlobal('ResizeObserver', undefined);
      } else {
        vi.stubGlobal('ResizeObserver', previous);
      }
      callbacks.clear();
    },
    get observerCount() {
      return callbacks.size;
    },
  };
}
