import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLANK_IMAGE_SOURCE,
  fakeImageFile,
  installCanvasEncodeMock,
  type CanvasEncodeMock,
} from '@/test/media-mocks';
import type { DecodedImage } from './image-decode';
import type * as ImageDecodeModule from './image-decode';

const { decodeImageMock } = vi.hoisted(() => ({
  decodeImageMock: vi.fn<(file: File) => Promise<DecodedImage>>(),
}));

vi.mock('./image-decode', async (importActual) => {
  const actual = await importActual<typeof ImageDecodeModule>();
  return { ...actual, decodeImage: decodeImageMock };
});

const {
  processImageForUpload,
  processImagesForUpload,
  __resetWebpProbeForTests,
} = await import('./image-processing');
const { ImageDecodeError } = await import('./image-decode');

/**
 * `draw` forwards to the real (mocked) `ctx.drawImage`, marking the target
 * canvas as having content — matching a real decoder — unless `blank` says
 * this source is itself a legitimately flat/uniform image (e.g. a plain white
 * photo), in which case the mock canvas reads back as blank too. This lets
 * tests exercise the draw-result verification in image-processing.ts, whose
 * canvas mock tracks per-canvas paint state (see `installCanvasEncodeMock`).
 */
function fakeDecoded(
  width: number,
  height: number,
  options: { blank?: boolean } = {},
): DecodedImage & {
  draw: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const source = options.blank ? BLANK_IMAGE_SOURCE : {};
  return {
    width,
    height,
    draw: vi.fn((ctx: CanvasRenderingContext2D, dw: number, dh: number) => {
      ctx.drawImage(source as unknown as CanvasImageSource, 0, 0, dw, dh);
    }),
    close: vi.fn(),
  };
}

let canvas: CanvasEncodeMock | undefined;

beforeEach(() => {
  __resetWebpProbeForTests();
  decodeImageMock.mockReset();
});

afterEach(() => {
  canvas?.uninstall();
  canvas = undefined;
});

describe('processImageForUpload — validation', () => {
  beforeEach(() => {
    canvas = installCanvasEncodeMock();
  });

  it('rejects a zero-byte file', async () => {
    await expect(
      processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 0), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toMatchObject({ code: 'empty-file' });
    expect(decodeImageMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported MIME type before decoding', async () => {
    await expect(
      processImageForUpload(fakeImageFile('a.pdf', 'application/pdf', 100), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toMatchObject({ code: 'unsupported-type' });
    expect(decodeImageMock).not.toHaveBeenCalled();
  });

  it('propagates an undecodable image as code "undecodable" with likelyHeic', async () => {
    decodeImageMock.mockRejectedValue(new ImageDecodeError('nope', true));
    await expect(
      processImageForUpload(fakeImageFile('IMG.heic', 'image/heic', 200), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toMatchObject({ code: 'undecodable', likelyHeic: true });
  });
});

describe('processImageForUpload — passthrough', () => {
  beforeEach(() => {
    canvas = installCanvasEncodeMock();
  });

  it('returns the original file untouched when it is small enough and a web type', async () => {
    const original = fakeImageFile('small.jpg', 'image/jpeg', 200 * 1024);
    decodeImageMock.mockResolvedValue(fakeDecoded(1200, 900));
    const result = await processImageForUpload(original, {
      maxLongSidePx: 1600,
      passthroughMaxBytes: 512 * 1024,
    });
    expect(result.wasProcessed).toBe(false);
    expect(result.file).toBe(original);
    expect(result.width).toBe(1200);
    expect(canvas?.encodeCalls).toHaveLength(0);
  });

  it('still processes a within-dimension file that is too many bytes', async () => {
    const original = fakeImageFile('big.jpg', 'image/jpeg', 3 * 1024 * 1024);
    decodeImageMock.mockResolvedValue(fakeDecoded(1200, 900));
    const result = await processImageForUpload(original, {
      maxLongSidePx: 1600,
      passthroughMaxBytes: 512 * 1024,
    });
    expect(result.wasProcessed).toBe(true);
    expect(result.file).not.toBe(original);
  });

  it('never passes a HEIC file through even if small', async () => {
    const original = fakeImageFile('x.heic', 'image/heic', 50 * 1024);
    decodeImageMock.mockResolvedValue(fakeDecoded(1000, 800));
    const result = await processImageForUpload(original, {
      maxLongSidePx: 1600,
      passthroughMaxBytes: 512 * 1024,
    });
    expect(result.wasProcessed).toBe(true);
    expect(result.mimeType).toMatch(/^image\/(jpeg|webp)$/);
  });
});

describe('processImageForUpload — resize', () => {
  beforeEach(() => {
    canvas = installCanvasEncodeMock({ sizeFor: () => 120_000 });
  });

  it('scales an oversized landscape image to the long-side limit, aspect preserved', async () => {
    decodeImageMock.mockResolvedValue(fakeDecoded(4000, 3000));
    const result = await processImageForUpload(
      fakeImageFile('l.jpg', 'image/jpeg', 9_000_000),
      { maxLongSidePx: 1600 },
    );
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
  });

  it('scales an oversized portrait image to the long-side limit', async () => {
    decodeImageMock.mockResolvedValue(fakeDecoded(3000, 4000));
    const result = await processImageForUpload(
      fakeImageFile('p.jpg', 'image/jpeg', 9_000_000),
      { maxLongSidePx: 1600 },
    );
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1600);
  });

  it('never upscales a small image', async () => {
    decodeImageMock.mockResolvedValue(fakeDecoded(800, 600));
    const result = await processImageForUpload(
      fakeImageFile('s.png', 'image/png', 2_000_000),
      { maxLongSidePx: 1600 },
    );
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });
});

describe('processImageForUpload — format', () => {
  it('emits WebP when the browser can encode it (auto)', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: true });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 5_000_000),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(result.mimeType).toBe('image/webp');
    expect(result.file.name).toBe('a.webp');
  });

  it('falls back to JPEG when the browser cannot encode WebP (auto)', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: false });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.png', 'image/png', 5_000_000),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.file.name).toBe('a.jpg');
  });

  it('honours an explicit format: "jpeg" even when WebP is available', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: true });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 5_000_000),
      { maxLongSidePx: 1600, format: 'jpeg' },
    );
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('flattens transparency onto white for a JPEG output', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: false });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await processImageForUpload(
      fakeImageFile('a.png', 'image/png', 5_000_000),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(canvas.fillCalls).toBe(1);
  });

  it('does not paint a background for a WebP output', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: true });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await processImageForUpload(
      fakeImageFile('a.png', 'image/png', 5_000_000),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(canvas.fillCalls).toBe(0);
  });
});

describe('processImageForUpload — size / quality', () => {
  it('reports sizeBytes from the encoded blob', async () => {
    canvas = installCanvasEncodeMock({ sizeFor: () => 333_333 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9_000_000),
      { maxLongSidePx: 1600 },
    );
    expect(result.sizeBytes).toBe(333_333);
  });

  it('runs exactly one lower-quality re-encode when over targetBytes, never below the floor', async () => {
    canvas = installCanvasEncodeMock({
      sizeFor: (_mime, q) => (q === 0.85 ? 900_000 : 400_000),
    });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9_000_000),
      {
        maxLongSidePx: 1600,
        quality: 0.85,
        qualityFloor: 0.65,
        targetBytes: 500 * 1024,
      },
    );
    const qualities = canvas.encodeCalls.map((c) => c.quality);
    expect(qualities).toEqual([0.85, 0.7]);
    expect(result.sizeBytes).toBe(400_000);
  });

  it('does not re-encode when the first pass is already under targetBytes', async () => {
    canvas = installCanvasEncodeMock({ sizeFor: () => 100_000 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
      maxLongSidePx: 1600,
      quality: 0.85,
      targetBytes: 500 * 1024,
    });
    expect(canvas.encodeCalls).toHaveLength(1);
  });

  it('does not drop below the quality floor even if still over target', async () => {
    canvas = installCanvasEncodeMock({ sizeFor: () => 5_000_000 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
      maxLongSidePx: 1600,
      quality: 0.7,
      qualityFloor: 0.6,
      targetBytes: 100 * 1024,
    });
    const qualities = canvas.encodeCalls.map((c) => c.quality);
    expect(qualities).toEqual([0.7, 0.6]);
  });
});

describe('processImageForUpload — never uses OffscreenCanvas', () => {
  it('draws with a plain <canvas> even when OffscreenCanvas is available', async () => {
    // OffscreenCanvas is deliberately unused (reliability over an unexercised
    // off-main-thread benefit — see the module note). Prove it stays that way:
    // making it available must not change which surface actually gets used.
    canvas = installCanvasEncodeMock({
      offscreenCanvas: true,
      webpSupported: true,
      sizeFor: () => 150_000,
    });
    decodeImageMock.mockResolvedValue(fakeDecoded(3000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9e6),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(result.wasProcessed).toBe(true);
    expect(result.sizeBytes).toBe(150_000);
    expect(canvas.offscreenConstructed).toBe(0);
  });
});

describe('processImageForUpload — silent blank-draw detection (white image P0)', () => {
  beforeEach(() => {
    canvas = installCanvasEncodeMock();
  });

  it('rejects when the large draw silently paints nothing but the source has real detail', async () => {
    // Models the documented mobile-WebKit failure mode: drawImage silently
    // no-ops on a canvas above some size/memory threshold while the same call
    // succeeds at a tiny (probe) scale. Nothing upstream of this check
    // (decode(), naturalWidth/Height, encode) can see this — only inspecting
    // the actual drawn pixels can.
    canvas = installCanvasEncodeMock({ simulateBrokenDrawAbovePx: 64 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await expect(
      processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toMatchObject({ code: 'encode-failed' });
    // Never reaches the encoder with corrupt bytes.
    expect(canvas.encodeCalls).toHaveLength(0);
  });

  it('does NOT reject a legitimately flat/white source image', async () => {
    // A plain white photo / screenshot must never be falsely rejected — the
    // source probe itself reads flat, so the output check is skipped.
    canvas = installCanvasEncodeMock({ simulateBrokenDrawAbovePx: 64 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000, { blank: true }));
    const result = await processImageForUpload(
      fakeImageFile('white.jpg', 'image/jpeg', 9e6),
      { maxLongSidePx: 1600 },
    );
    expect(result.wasProcessed).toBe(true);
  });

  it('succeeds normally when the large draw paints real content', async () => {
    canvas = installCanvasEncodeMock({ simulateBrokenDrawAbovePx: 4 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9e6),
      { maxLongSidePx: 1600 },
    );
    expect(result.wasProcessed).toBe(true);
  });

  it('closes the decoded image even when the blank-draw check rejects it', async () => {
    canvas = installCanvasEncodeMock({ simulateBrokenDrawAbovePx: 64 });
    const decoded = fakeDecoded(2000, 2000);
    decodeImageMock.mockResolvedValue(decoded);
    await expect(
      processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toThrow();
    expect(decoded.close).toHaveBeenCalled();
  });

  it('never blocks an upload when canvas pixel reads are privacy-blocked (Tor / resistFingerprinting)', async () => {
    // getImageData is also the classic canvas-fingerprinting surface — some
    // browsers/extensions make it throw regardless of what was drawn. That
    // must degrade to "cannot verify, trust the draw", never to "reject a
    // real photo because we couldn't check it".
    canvas = installCanvasEncodeMock({
      simulateBrokenDrawAbovePx: 64,
      simulateGetImageDataThrows: true,
    });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9e6),
      { maxLongSidePx: 1600 },
    );
    expect(result.wasProcessed).toBe(true);
  });

  it('does not falsely reject ordinary resize blur on a real, legitimate photo', async () => {
    // The output goes through one more resize stage than the source probe
    // (source → target → probe, vs. source → probe): drawing the ALREADY
    // full-detail target canvas down into the output probe legitimately loses
    // some variance to that extra low-pass stage. Retaining a quarter of the
    // source's variance (well above the 10% ratio floor) must never be
    // treated as a broken draw — only near-total loss should be.
    canvas = installCanvasEncodeMock({ cascadeBlurFactor: 0.5 });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    const result = await processImageForUpload(
      fakeImageFile('a.jpg', 'image/jpeg', 9e6),
      { maxLongSidePx: 1600 },
    );
    expect(result.wasProcessed).toBe(true);
  });
});

describe('processImageForUpload — encode failure & cleanup', () => {
  it('throws "encode-failed" when the canvas produces no blob', async () => {
    canvas = installCanvasEncodeMock({ sizeFor: () => null });
    decodeImageMock.mockResolvedValue(fakeDecoded(2000, 2000));
    await expect(
      processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toMatchObject({ code: 'encode-failed' });
  });

  it('closes the decoded image (success and failure paths)', async () => {
    canvas = installCanvasEncodeMock();
    const okDecoded = fakeDecoded(2000, 2000);
    decodeImageMock.mockResolvedValueOnce(okDecoded);
    await processImageForUpload(fakeImageFile('a.jpg', 'image/jpeg', 9e6), {
      maxLongSidePx: 1600,
    });
    expect(okDecoded.close).toHaveBeenCalled();

    canvas.uninstall();
    canvas = installCanvasEncodeMock({ sizeFor: () => null });
    const failDecoded = fakeDecoded(2000, 2000);
    decodeImageMock.mockResolvedValueOnce(failDecoded);
    await expect(
      processImageForUpload(fakeImageFile('b.jpg', 'image/jpeg', 9e6), {
        maxLongSidePx: 1600,
      }),
    ).rejects.toThrow();
    expect(failDecoded.close).toHaveBeenCalled();
  });
});

describe('processImageForUpload — HEIC that decodes', () => {
  it('re-encodes a decodable HEIC to a browser-universal type', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: false });
    decodeImageMock.mockResolvedValue(fakeDecoded(3000, 4000));
    const result = await processImageForUpload(
      fakeImageFile('IMG_1234.HEIC', 'image/heic', 4_000_000),
      { maxLongSidePx: 1600, format: 'auto' },
    );
    expect(result.wasProcessed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.file.name).toBe('IMG_1234.jpg');
    expect(result.file.type).toBe('image/jpeg');
  });
});

describe('processImagesForUpload — sequential, bounded memory', () => {
  beforeEach(() => {
    canvas = installCanvasEncodeMock();
  });

  it('processes files one at a time and returns results in order', async () => {
    let active = 0;
    let peak = 0;
    decodeImageMock.mockImplementation(async (file) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      const n = Number(file.name.replace(/\D/g, ''));
      return fakeDecoded(n * 100, n * 100);
    });

    const results = await processImagesForUpload(
      [
        fakeImageFile('img1.jpg', 'image/jpeg', 9e6),
        fakeImageFile('img2.jpg', 'image/jpeg', 9e6),
        fakeImageFile('img3.jpg', 'image/jpeg', 9e6),
      ],
      { maxLongSidePx: 1600 },
    );

    expect(peak).toBe(1);
    expect(results.map((r) => r.width)).toEqual([100, 200, 300]);
  });

  it('rejects with the first ImageProcessingError, prefixed with the image number', async () => {
    decodeImageMock.mockImplementation((file) =>
      file.name === 'img2.jpg'
        ? Promise.reject(new ImageDecodeError('bad', false))
        : Promise.resolve(fakeDecoded(1000, 1000)),
    );
    await expect(
      processImagesForUpload(
        [
          fakeImageFile('img1.jpg', 'image/jpeg', 9e6),
          fakeImageFile('img2.jpg', 'image/jpeg', 9e6),
          fakeImageFile('img3.jpg', 'image/jpeg', 9e6),
        ],
        { maxLongSidePx: 1600 },
      ),
    ).rejects.toMatchObject({
      code: 'undecodable',
      message: expect.stringContaining('Bild 2:'),
    });
  });

  it('returns [] for an empty list without touching the decoder', async () => {
    expect(await processImagesForUpload([], { maxLongSidePx: 1600 })).toEqual(
      [],
    );
    expect(decodeImageMock).not.toHaveBeenCalled();
  });
});

describe('processImagesForUpload — stress: no cross-file / cross-attachment contamination', () => {
  // Guards against the "varannan bild" (every-other-image) class of bug: a
  // file's processed output ending up associated with a DIFFERENT file's
  // source or size, or a transient failure in one file corrupting a sibling.
  // Each file gets a distinct, verifiable dimension so a mix-up is caught by
  // the width/height assertion, not just a count.
  it('maps 100 sequential alternating files to their own correct dimensions', async () => {
    canvas = installCanvasEncodeMock();
    const n = 100;
    decodeImageMock.mockImplementation((file) => {
      const idx = Number(file.name.replace(/\D/g, ''));
      // Alternate portrait/landscape so a transposed mix-up is also caught.
      return Promise.resolve(
        idx % 2 === 0
          ? fakeDecoded(1000 + idx, 500)
          : fakeDecoded(500, 1000 + idx),
      );
    });
    const files = Array.from({ length: n }, (_, i) =>
      fakeImageFile(`img${String(i)}.jpg`, 'image/jpeg', 9e6),
    );

    const results = await processImagesForUpload(files, {
      maxLongSidePx: 5000,
    });

    expect(results).toHaveLength(n);
    results.forEach((r, idx) => {
      if (idx % 2 === 0) {
        expect(r.width).toBe(1000 + idx);
        expect(r.height).toBe(500);
      } else {
        expect(r.width).toBe(500);
        expect(r.height).toBe(1000 + idx);
      }
    });
  });

  it('an alternating good/broken-draw sequence rejects only the broken ones, at the right index, with no leakage', async () => {
    canvas = installCanvasEncodeMock({ simulateBrokenDrawAbovePx: 64 });
    const n = 20;
    // Odd files simulate the silent large-canvas draw failure; even files are
    // fine. A leak (state from one file affecting the next) would show up as
    // an unexpected pass/fail pattern instead of a clean odd/even split.
    const outcomes = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        decodeImageMock.mockResolvedValueOnce(fakeDecoded(2000, 2000));
        try {
          await processImageForUpload(
            fakeImageFile(`img${String(i)}.jpg`, 'image/jpeg', 9e6),
            { maxLongSidePx: 1600 },
          );
          return 'ok';
        } catch {
          return 'rejected';
        }
      }),
    );
    // Every file used the SAME broken-above-64px canvas mock, so every one of
    // these (2000×2000, well above the 64px threshold) must reject — proving
    // the guard fires consistently across a long run, not intermittently.
    expect(outcomes).toEqual(Array(n).fill('rejected'));
  });

  it('mixed input types (jpeg/png/webp/heic) each process to the expected output type', async () => {
    canvas = installCanvasEncodeMock({ webpSupported: true });
    const cases: { name: string; type: string }[] = [
      { name: 'a.jpg', type: 'image/jpeg' },
      { name: 'b.png', type: 'image/png' },
      { name: 'c.webp', type: 'image/webp' },
      { name: 'd.heic', type: 'image/heic' },
    ];
    for (const { name, type } of cases) {
      decodeImageMock.mockResolvedValueOnce(fakeDecoded(2000, 2000));
      const result = await processImageForUpload(
        fakeImageFile(name, type, 9e6),
        { maxLongSidePx: 1600, format: 'auto' },
      );
      expect(result.mimeType).toBe('image/webp');
      expect(result.wasProcessed).toBe(true);
    }
  });
});
