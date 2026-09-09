import { afterEach, describe, expect, it } from 'vitest';
import {
  fakeImageFile,
  installCreateImageBitmapMock,
  installImageElementMock,
  type CreateImageBitmapMock,
  type ImageElementMock,
} from '@/test/media-mocks';
import { decodeImage, ImageDecodeError } from './image-decode';

let imgMock: ImageElementMock | undefined;
let bitmapMock: CreateImageBitmapMock | undefined;

afterEach(() => {
  imgMock?.uninstall();
  bitmapMock?.uninstall();
  imgMock = undefined;
  bitmapMock = undefined;
});

describe('decodeImage — <img> primary path', () => {
  it('decodes via <img> and reports the oriented natural dimensions', async () => {
    imgMock = installImageElementMock(() => ({ width: 4000, height: 3000 }));
    const decoded = await decodeImage(
      fakeImageFile('portrait.jpg', 'image/jpeg'),
    );
    expect(decoded.width).toBe(4000);
    expect(decoded.height).toBe(3000);
    decoded.close();
  });

  it('revokes the object URL when closed', async () => {
    imgMock = installImageElementMock(() => ({ width: 10, height: 10 }));
    const decoded = await decodeImage(fakeImageFile('a.jpg', 'image/jpeg'));
    expect(imgMock.created).toHaveLength(1);
    expect(imgMock.revoked).toHaveLength(0);
    decoded.close();
    expect(imgMock.revoked).toEqual(imgMock.created);
    // idempotent
    decoded.close();
    expect(imgMock.revoked).toHaveLength(1);
  });

  it('draws through the 2D context at the requested size', async () => {
    imgMock = installImageElementMock(() => ({ width: 100, height: 100 }));
    const decoded = await decodeImage(fakeImageFile('a.jpg', 'image/jpeg'));
    let drawn: unknown[] = [];
    decoded.draw(
      {
        drawImage: (...args: unknown[]) => {
          drawn = args;
        },
      } as unknown as CanvasRenderingContext2D,
      50,
      50,
    );
    expect(drawn.slice(1)).toEqual([0, 0, 50, 50]);
    decoded.close();
  });
});

describe('decodeImage — createImageBitmap fallback', () => {
  it('falls back to createImageBitmap when the <img> load errors', async () => {
    imgMock = installImageElementMock(() => 'error');
    bitmapMock = installCreateImageBitmapMock(() => ({
      width: 1600,
      height: 900,
    }));
    const decoded = await decodeImage(fakeImageFile('a.jpg', 'image/jpeg'));
    expect(decoded.width).toBe(1600);
    expect(bitmapMock.calls[0]).toEqual({ imageOrientation: 'from-image' });
    decoded.close();
    expect(bitmapMock.closed).toBe(1);
  });
});

describe('decodeImage — <img> paint-readiness gate (blank-upload regression)', () => {
  it('does NOT return an <img> that fired load but whose decode() rejected — uses createImageBitmap instead', async () => {
    // Production BUG: on WebKit a detached <img> can fire `load` before its
    // pixels are decoded; drawing it then composites nothing → a solid white
    // JPEG upload. `decode()` is the only reliable "safe to drawImage" gate, so
    // a decode() rejection must send us to the reliable createImageBitmap path,
    // never fall through to an <img> that draws blank.
    imgMock = installImageElementMock(() => ({
      width: 2000,
      height: 1500,
      decode: 'reject',
    }));
    bitmapMock = installCreateImageBitmapMock(() => ({
      width: 2000,
      height: 1500,
    }));

    const decoded = await decodeImage(
      fakeImageFile('portrait.jpg', 'image/jpeg'),
    );

    expect(bitmapMock.calls).toHaveLength(1);
    expect(decoded.width).toBe(2000);
    expect(decoded.height).toBe(1500);
    decoded.close();
    expect(bitmapMock.closed).toBe(1);
    // the <img> object URL that we abandoned was still revoked (no leak)
    expect(imgMock.revoked).toEqual(imgMock.created);
  });

  it('throws undecodable when the <img> decode() rejects AND createImageBitmap is unavailable', async () => {
    imgMock = installImageElementMock(() => ({
      width: 100,
      height: 100,
      decode: 'reject',
    }));
    // no createImageBitmap mock installed → the fallback path is unavailable
    await expect(
      decodeImage(fakeImageFile('a.jpg', 'image/jpeg')),
    ).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('decodes normally via <img> when decode() resolves (no needless fallback)', async () => {
    imgMock = installImageElementMock(() => ({
      width: 800,
      height: 600,
      decode: 'resolve',
    }));
    bitmapMock = installCreateImageBitmapMock(() => ({ width: 1, height: 1 }));
    const decoded = await decodeImage(fakeImageFile('a.jpg', 'image/jpeg'));
    expect(decoded.width).toBe(800);
    expect(bitmapMock.calls).toHaveLength(0); // <img> path was enough
    decoded.close();
  });
});

describe('decodeImage — undecodable', () => {
  it('throws ImageDecodeError with likelyHeic when both paths fail for a .heic file', async () => {
    imgMock = installImageElementMock(() => 'error');
    bitmapMock = installCreateImageBitmapMock(() => 'error');
    await expect(
      decodeImage(fakeImageFile('IMG_9.heic', 'image/heic')),
    ).rejects.toMatchObject({
      name: 'ImageDecodeError',
      likelyHeic: true,
    });
  });

  it('throws ImageDecodeError with likelyHeic=false for a plain jpg that will not decode', async () => {
    imgMock = installImageElementMock(() => 'error');
    bitmapMock = installCreateImageBitmapMock(() => 'error');
    await expect(
      decodeImage(fakeImageFile('broken.jpg', 'image/jpeg')),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    await expect(
      decodeImage(fakeImageFile('broken.jpg', 'image/jpeg')),
    ).rejects.toMatchObject({ likelyHeic: false });
  });
});
