import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

function fakeDecoded(
  width: number,
  height: number,
): DecodedImage & {
  draw: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { width, height, draw: vi.fn(), close: vi.fn() };
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

describe('processImageForUpload — OffscreenCanvas path', () => {
  it('uses OffscreenCanvas.convertToBlob when available', async () => {
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
    expect(canvas.encodeCalls.length).toBeGreaterThanOrEqual(1);
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
