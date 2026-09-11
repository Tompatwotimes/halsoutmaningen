import { vi } from 'vitest';

/**
 * jsdom has no real image decoder or canvas raster backend. These helpers stub
 * exactly the browser surface `src/lib/media/*` touches, so the resize / encode
 * / orientation logic can be driven deterministically.
 *
 * Each installer returns an `uninstall()`; call it in `afterEach`.
 */

// ---------------------------------------------------------------------------
// <img> + object URL decode path
// ---------------------------------------------------------------------------

export type ImageLoadOutcome =
  | {
      width: number;
      height: number;
      /**
       * What `img.decode()` does for this file. Default `'resolve'`.
       * `'reject'` models WebKit rejecting `decode()` for a detached `<img>`
       * that nonetheless fired `load` — the state that produced blank uploads.
       * `'never'` models a `decode()` that hangs after a successful `load`.
       */
      decode?: 'resolve' | 'reject' | 'never';
    }
  | 'error'
  | 'never';

export interface ImageElementMock {
  uninstall: () => void;
  /** Object URLs passed to revokeObjectURL, in order. */
  readonly revoked: string[];
  /** Object URLs handed out by createObjectURL, in order. */
  readonly created: string[];
  /** Peak number of `<img>` elements loading at the same time. */
  readonly peakConcurrent: number;
}

/**
 * Stub `Image`, `HTMLImageElement.prototype.decode`, and
 * `URL.createObjectURL` / `revokeObjectURL`.
 *
 * `outcomeFor(file)` decides what happens when `img.src` is assigned:
 *  - `{ width, height }` → fires `load` and reports those natural dimensions
 *  - `'error'`           → fires `error`
 *  - `'never'`           → neither (simulates a hang; the caller must time out)
 */
export function installImageElementMock(
  outcomeFor: (name: string) => ImageLoadOutcome,
): ImageElementMock {
  const revoked: string[] = [];
  const created: string[] = [];
  let seq = 0;
  let concurrent = 0;
  let peak = 0;

  const urlToName = new Map<string, string>();
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;

  URL.createObjectURL = ((obj: Blob) => {
    const name = obj instanceof File ? obj.name : `blob-${String(seq)}`;
    const url = `blob:mock/${String(seq++)}`;
    urlToName.set(url, name);
    created.push(url);
    return url;
  }) as typeof URL.createObjectURL;

  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;

  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = 'auto';
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    #src = '';

    get src(): string {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      if (value === '') return;
      const name = urlToName.get(value) ?? value;
      const outcome = outcomeFor(name);
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      queueMicrotask(() => {
        concurrent -= 1;
        if (outcome === 'never') return;
        if (outcome === 'error') {
          this.onerror?.();
          return;
        }
        this.naturalWidth = outcome.width;
        this.naturalHeight = outcome.height;
        this.width = outcome.width;
        this.height = outcome.height;
        this.onload?.();
      });
    }

    decode(): Promise<void> {
      const name = urlToName.get(this.#src) ?? this.#src;
      const outcome = outcomeFor(name);
      if (outcome === 'error') return Promise.reject(new Error('decode'));
      if (outcome === 'never') return new Promise<void>(() => undefined);
      if (outcome.decode === 'reject') {
        return Promise.reject(new Error('decode'));
      }
      if (outcome.decode === 'never') {
        return new Promise<void>(() => undefined);
      }
      return Promise.resolve();
    }
  }

  const prevImage = globalThis.Image;
  vi.stubGlobal('Image', MockImage as unknown as typeof Image);

  return {
    uninstall() {
      URL.createObjectURL = prevCreate;
      URL.revokeObjectURL = prevRevoke;
      vi.stubGlobal('Image', prevImage);
    },
    get revoked() {
      return revoked;
    },
    get created() {
      return created;
    },
    get peakConcurrent() {
      return peak;
    },
  };
}

// ---------------------------------------------------------------------------
// createImageBitmap fallback path
// ---------------------------------------------------------------------------

export interface CreateImageBitmapMock {
  uninstall: () => void;
  /** Options bags passed to createImageBitmap, in order (undefined if none). */
  readonly calls: (ImageBitmapOptions | undefined)[];
  readonly closed: number;
}

export function installCreateImageBitmapMock(
  outcomeFor: (name: string) => { width: number; height: number } | 'error',
): CreateImageBitmapMock {
  const calls: (ImageBitmapOptions | undefined)[] = [];
  let closed = 0;
  const prev = (globalThis as { createImageBitmap?: unknown })
    .createImageBitmap;

  const fn = ((blob: Blob, options?: ImageBitmapOptions) => {
    calls.push(options);
    const name = blob instanceof File ? blob.name : 'blob';
    const outcome = outcomeFor(name);
    if (outcome === 'error') return Promise.reject(new Error('bitmap'));
    return Promise.resolve({
      width: outcome.width,
      height: outcome.height,
      close() {
        closed += 1;
      },
    } as ImageBitmap);
  }) as typeof createImageBitmap;

  vi.stubGlobal('createImageBitmap', fn);

  return {
    uninstall() {
      vi.stubGlobal('createImageBitmap', prev);
    },
    get calls() {
      return calls;
    },
    get closed() {
      return closed;
    },
  };
}

// ---------------------------------------------------------------------------
// Canvas encode surface (toBlob / convertToBlob / toDataURL)
// ---------------------------------------------------------------------------

export interface CanvasEncodeMock {
  uninstall: () => void;
  /** (mime, quality) pairs passed to the encoder, in order. */
  readonly encodeCalls: { mime: string; quality: number | undefined }[];
  /** drawImage invocations across all contexts. */
  readonly drawCalls: number;
  /** fillRect invocations (white background for JPEG). */
  readonly fillCalls: number;
  /** Number of `OffscreenCanvas` instances actually constructed. */
  readonly offscreenConstructed: number;
}

export interface CanvasEncodeConfig {
  /** Bytes a given mime encodes to. Return null to simulate an encode failure. */
  sizeFor?: (mime: string, quality: number | undefined) => number | null;
  /** Whether the synchronous WebP probe (`toDataURL('image/webp')`) succeeds. */
  webpSupported?: boolean;
  /** Also expose a matching `OffscreenCanvas` global (to prove it goes unused). */
  offscreenCanvas?: boolean;
  /**
   * Simulate mobile WebKit's documented large-canvas failure mode: `drawImage`
   * silently paints nothing (no throw) onto any canvas whose width OR height
   * exceeds this, while the same call still succeeds on a small canvas. Unset
   * = every draw succeeds.
   */
  simulateBrokenDrawAbovePx?: number;
  /**
   * Simulate privacy-hardened `getImageData` (Tor Browser, Firefox
   * `resistFingerprinting`, canvas-fingerprint-blocking extensions), which
   * can throw rather than return real pixel data.
   */
  simulateGetImageDataThrows?: boolean;
  /**
   * Applied only when copying FROM another canvas (the output probe reading
   * the just-rendered target canvas) — models the extra low-pass blur an
   * additional resize stage legitimately adds, distinct from a silent draw
   * failure. 1 (default) = lossless copy.
   */
  cascadeBlurFactor?: number;
}

/** Identity-marked source: a `decoded.draw` source representing a source
 * image that is itself flat/blank (used to prove the output check is skipped
 * for a legitimately uniform photo — never a false positive). */
export const BLANK_IMAGE_SOURCE = { __mock: 'blank-source' as const };

export function installCanvasEncodeMock(
  config: CanvasEncodeConfig = {},
): CanvasEncodeMock {
  const encodeCalls: { mime: string; quality: number | undefined }[] = [];
  let drawCalls = 0;
  let fillCalls = 0;
  let offscreenConstructed = 0;
  const sizeFor = config.sizeFor ?? (() => 1024);
  const webpSupported = config.webpSupported ?? false;
  // Tracks, per canvas element, the "strength" (0–1) of real content it has
  // ever received — via a successful drawImage from a real/partial source, or
  // a copy from another canvas that itself had content. Absent/0 = blank
  // (matches a fresh or fillRect-only canvas).
  const painted = new WeakMap<HTMLCanvasElement, number>();

  function sourceStrength(source: unknown): number {
    if (source === BLANK_IMAGE_SOURCE) return 0;
    if (
      typeof source === 'object' &&
      source !== null &&
      (source as { __mock?: string }).__mock === 'partial'
    ) {
      return (source as { strength: number }).strength;
    }
    if (source instanceof HTMLCanvasElement) {
      return (painted.get(source) ?? 0) * (config.cascadeBlurFactor ?? 1);
    }
    return 1;
  }

  function makeCtx(canvasEl: HTMLCanvasElement): CanvasRenderingContext2D {
    return {
      fillStyle: '',
      drawImage(source: unknown) {
        drawCalls += 1;
        const tooLarge =
          config.simulateBrokenDrawAbovePx != null &&
          (canvasEl.width > config.simulateBrokenDrawAbovePx ||
            canvasEl.height > config.simulateBrokenDrawAbovePx);
        if (tooLarge) return; // silent no-op — the bug under test
        painted.set(canvasEl, sourceStrength(source));
      },
      fillRect() {
        fillCalls += 1;
      },
      clearRect() {
        /* no-op */
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        if (config.simulateGetImageDataThrows) {
          throw new DOMException('canvas read blocked', 'SecurityError');
        }
        const strength = painted.get(canvasEl) ?? 0;
        const n = w * h;
        const data = new Uint8ClampedArray(n * 4);
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          if (strength > 0) {
            const v = Math.round(128 + (((i * 53) % 256) - 128) * strength);
            data[o] = v;
            data[o + 1] = 255 - v;
            data[o + 2] = (v * 3) % 256;
          } else {
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
          }
          data[o + 3] = 255;
        }
        return { data, width: w, height: h } as ImageData;
      },
    } as unknown as CanvasRenderingContext2D;
  }

  function encodeToBlob(
    mime: string,
    quality: number | undefined,
  ): Blob | null {
    encodeCalls.push({ mime, quality });
    const size = sizeFor(mime, quality);
    if (size === null) return null;
    return new Blob([new Uint8Array(Math.max(size, 1))], { type: mime });
  }

  const proto = HTMLCanvasElement.prototype;
  const prevGetContext = proto.getContext;
  const prevToBlob = proto.toBlob;
  const prevToDataURL = proto.toDataURL;

  proto.getContext = function (
    this: HTMLCanvasElement,
  ): CanvasRenderingContext2D {
    return makeCtx(this);
  } as unknown as typeof proto.getContext;

  proto.toBlob = ((cb: BlobCallback, type?: string, quality?: number) => {
    const mime = type ?? 'image/png';
    queueMicrotask(() => {
      cb(encodeToBlob(mime, quality));
    });
  }) as typeof proto.toBlob;

  proto.toDataURL = ((type?: string) =>
    type === 'image/webp' && webpSupported
      ? 'data:image/webp;base64,'
      : 'data:image/png;base64,') as typeof proto.toDataURL;

  let prevOffscreen: unknown;
  let hadOffscreen = false;
  if (config.offscreenCanvas) {
    hadOffscreen = 'OffscreenCanvas' in globalThis;
    prevOffscreen = (globalThis as { OffscreenCanvas?: unknown })
      .OffscreenCanvas;
    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        offscreenConstructed += 1;
        this.width = w;
        this.height = h;
      }
      getContext() {
        // Never exercised by production (OffscreenCanvas is unused there);
        // kept for completeness in case a test constructs one directly.
        return makeCtx(document.createElement('canvas') as HTMLCanvasElement);
      }
      convertToBlob(opts?: { type?: string; quality?: number }): Promise<Blob> {
        const blob = encodeToBlob(opts?.type ?? 'image/png', opts?.quality);
        return blob
          ? Promise.resolve(blob)
          : Promise.reject(new Error('encode'));
      }
    }
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  }

  return {
    uninstall() {
      proto.getContext = prevGetContext;
      proto.toBlob = prevToBlob;
      proto.toDataURL = prevToDataURL;
      if (config.offscreenCanvas) {
        if (hadOffscreen) vi.stubGlobal('OffscreenCanvas', prevOffscreen);
        else vi.stubGlobal('OffscreenCanvas', undefined);
      }
    },
    get encodeCalls() {
      return encodeCalls;
    },
    get drawCalls() {
      return drawCalls;
    },
    get fillCalls() {
      return fillCalls;
    },
    get offscreenConstructed() {
      return offscreenConstructed;
    },
  };
}

/** A tiny `File` with a controllable byte length and type. */
export function fakeImageFile(name: string, type: string, sizeBytes = 8): File {
  return new File([new Uint8Array(Math.max(sizeBytes, 0))], name, { type });
}
