/**
 * Browser image decoding, abstracted over the two ways to turn a `File` into
 * drawable pixels — so the rest of the media pipeline never has to care which
 * one ran, and orientation handling is explicit rather than assumed.
 *
 * ## Why not just `createImageBitmap(file, { imageOrientation: 'from-image' })`
 *
 * WebKit has a documented history of ignoring `imageOrientation` for
 * `createImageBitmap` from a `Blob`, so a pipeline that rests solely on it can
 * silently upload sideways iPhone photos. Instead:
 *
 * 1. **Primary — `HTMLImageElement` + object URL.** Every current browser
 *    (Chrome 81+, Firefox 77+, Safari 13.1+) applies EXIF orientation natively
 *    when rendering an `<img>`; `naturalWidth` / `naturalHeight` and
 *    `drawImage` then all speak in already-oriented pixels. This is the most
 *    robust path and needs no orientation flag.
 * 2. **Fallback — `createImageBitmap`** (with `imageOrientation: 'from-image'`
 *    as the best available hint), used only when the `<img>` path is
 *    unavailable or fails to load but `createImageBitmap` is present. Keeps the
 *    module usable in contexts without a DOM.
 *
 * Both HEIC decode paths depend on an OS codec: Safari / iOS decodes HEIC,
 * most desktop Chrome / Firefox do not. When neither path can decode the file
 * this throws `ImageDecodeError` (never a broken upload).
 *
 * Every decoded resource (`<img>`, object URL, `ImageBitmap`) is released via
 * `close()`, which is idempotent.
 */

export class ImageDecodeError extends Error {
  /** Heuristic from the file name / type — used only to tailor UI copy. */
  readonly likelyHeic: boolean;

  constructor(message: string, likelyHeic: boolean) {
    super(message);
    this.name = 'ImageDecodeError';
    this.likelyHeic = likelyHeic;
  }
}

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DecodedImage {
  /** Oriented (display) width in device pixels. */
  readonly width: number;
  /** Oriented (display) height in device pixels. */
  readonly height: number;
  /** Draw the whole image into `ctx`, scaled to `dw` × `dh`. */
  draw(ctx: Ctx2d, dw: number, dh: number): void;
  /** Release the underlying `<img>` / object URL / `ImageBitmap`. Idempotent. */
  close(): void;
}

function looksLikeHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

function canUseImageElement(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof Image === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/** Primary path: load into an `<img>`, which orients from EXIF natively. */
async function decodeViaImageElement(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    img.src = '';
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        resolve();
      };
      img.onerror = () => {
        reject(new Error('image load failed'));
      };
      img.src = url;
      // `decode()` rejects on a genuine decode failure in browsers that support
      // it; where it is missing, `onload` / `onerror` above still settle us.
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => {
            resolve();
          },
          () => {
            reject(new Error('image decode failed'));
          },
        );
      }
    });
  } catch (err) {
    release();
    throw err;
  }

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width === 0 || height === 0) {
    release();
    throw new Error('image decoded to zero dimensions');
  }

  return {
    width,
    height,
    draw(ctx, dw, dh) {
      ctx.drawImage(img, 0, 0, dw, dh);
    },
    close: release,
  };
}

/** Fallback path: `createImageBitmap`, orientation hint applied where honoured. */
async function decodeViaImageBitmap(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap unavailable');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older engines reject the options bag — retry without it.
    bitmap = await createImageBitmap(file);
  }

  let released = false;
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw(ctx, dw, dh) {
      ctx.drawImage(bitmap, 0, 0, dw, dh);
    },
    close() {
      if (released) return;
      released = true;
      bitmap.close();
    },
  };
}

/**
 * Decode `file` to drawable, correctly-oriented pixels. Tries the `<img>` path
 * first, then `createImageBitmap`. Throws `ImageDecodeError` if neither works
 * (e.g. HEIC on a browser without a HEIC codec).
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  const heic = looksLikeHeic(file);

  if (canUseImageElement()) {
    try {
      return await decodeViaImageElement(file);
    } catch {
      // fall through to the bitmap path
    }
  }

  try {
    return await decodeViaImageBitmap(file);
  } catch {
    throw new ImageDecodeError(
      heic
        ? 'Bilden kunde inte avkodas (trolig HEIC/HEIF).'
        : 'Bilden kunde inte avkodas.',
      heic,
    );
  }
}
