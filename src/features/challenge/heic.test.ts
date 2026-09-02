import { afterEach, describe, expect, it, vi } from 'vitest';
import { looksLikeHeic, probeImage } from './heic';

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('looksLikeHeic', () => {
  it('flags the HEIC/HEIF mime types', () => {
    expect(looksLikeHeic(makeFile('bild.heic', 'image/heic'))).toBe(true);
    expect(looksLikeHeic(makeFile('bild.heif', 'image/heif'))).toBe(true);
  });

  it('flags a .heic filename even with a generic reported mime type', () => {
    expect(looksLikeHeic(makeFile('IMG_0001.HEIC', 'image/jpeg'))).toBe(true);
  });

  it('does not flag a normal JPEG', () => {
    expect(looksLikeHeic(makeFile('foto.jpg', 'image/jpeg'))).toBe(false);
  });
});

describe('probeImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports decodable when createImageBitmap succeeds', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() =>
        Promise.resolve({ width: 800, height: 600, close: () => undefined }),
      ),
    );

    const result = await probeImage(makeFile('foto.jpg', 'image/jpeg'));
    expect(result).toEqual({
      decodable: true,
      width: 800,
      height: 600,
      likelyHeic: false,
    });
  });

  it('reports not decodable when createImageBitmap rejects (typical for HEIC)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('Unsupported image type'))),
    );

    const result = await probeImage(makeFile('IMG_0002.heic', 'image/heic'));
    expect(result.decodable).toBe(false);
    expect(result.likelyHeic).toBe(true);
  });

  it('does not block the file when the environment cannot verify at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined);

    const result = await probeImage(makeFile('foto.jpg', 'image/jpeg'));
    expect(result.decodable).toBe(true);
    expect(result.width).toBeNull();
  });
});
