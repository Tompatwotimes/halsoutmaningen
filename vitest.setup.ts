import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom 25 ships no PointerEvent and no pointer-capture methods. A minimal
// polyfill so the chat message gesture tests (swipe-to-reply, double-tap) can
// dispatch realistic Pointer Events.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
      this.isPrimary = params.isPrimary ?? false;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
    }
  }
  globalThis.PointerEvent =
    PointerEventPolyfill as unknown as typeof globalThis.PointerEvent;
}

for (const method of [
  'setPointerCapture',
  'releasePointerCapture',
  'hasPointerCapture',
] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, {
      value:
        method === 'hasPointerCapture'
          ? () => false
          : () => {
              /* no-op */
            },
      writable: true,
      configurable: true,
    });
  }
}

// jsdom implements no `matchMedia` at all. A safe default (nothing matches —
// "no system dark mode", "not installed standalone") so any component that
// merely reads it (theme system prefers-color-scheme, PWA isStandalone())
// doesn't crash a test that isn't specifically exercising that behaviour.
// Tests that DO care about a specific matchMedia outcome already override it
// per-file with `vi.stubGlobal('matchMedia', ...)`.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
