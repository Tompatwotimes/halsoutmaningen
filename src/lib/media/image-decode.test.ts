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
