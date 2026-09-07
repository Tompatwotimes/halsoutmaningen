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
  { width: number; height: number } | 'error' | 'never';

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
}

export interface CanvasEncodeConfig {
  /** Bytes a given mime encodes to. Return null to simulate an encode failure. */
  sizeFor?: (mime: string, quality: number | undefined) => number | null;
  /** Whether the synchronous WebP probe (`toDataURL('image/webp')`) succeeds. */
  webpSupported?: boolean;
  /** Also expose a matching `OffscreenCanvas` global. */
  offscreenCanvas?: boolean;
}

export function installCanvasEncodeMock(
  config: CanvasEncodeConfig = {},
): CanvasEncodeMock {
  const encodeCalls: { mime: string; quality: number | undefined }[] = [];
  let drawCalls = 0;
  let fillCalls = 0;
  const sizeFor = config.sizeFor ?? (() => 1024);
  const webpSupported = config.webpSupported ?? false;

  function makeCtx(): CanvasRenderingContext2D {
    return {
      fillStyle: '',
      drawImage() {
        drawCalls += 1;
      },
      fillRect() {
        fillCalls += 1;
      },
      clearRect() {
        /* no-op */
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

  proto.getContext = (() => makeCtx()) as unknown as typeof proto.getContext;

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
        this.width = w;
        this.height = h;
      }
      getContext() {
        return makeCtx();
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
  };
}

/** A tiny `File` with a controllable byte length and type. */
export function fakeImageFile(name: string, type: string, sizeBytes = 8): File {
  return new File([new Uint8Array(Math.max(sizeBytes, 0))], name, { type });
}
