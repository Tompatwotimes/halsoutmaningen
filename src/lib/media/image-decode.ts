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
 *    robust path and needs no orientation flag. **`img.decode()` is awaited
 *    after `load`** — on WebKit a detached `<img>` can fire `load` before its
 *    pixels are decoded, and `ctx.drawImage` of such an `<img>` composites
 *    nothing (a blank raster → a solid-white JPEG once the canvas is
 *    white-filled). `decode()` is the authoritative paint-readiness gate.
 * 2. **Fallback — `createImageBitmap`** (with `imageOrientation: 'from-image'`
 *    as the best available hint), used when the `<img>` path is unavailable,
 *    fails to load, or its `decode()` rejects (an `<img>` that will not decode
 *    is not a trustworthy `drawImage` source). Decodes real pixels from the
 *    file bytes; also keeps the module usable in contexts without a DOM.
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

  // 1. Load. `onload` / `onerror` are authoritative for whether the *bytes*
  //    loaded — but on WebKit a detached <img> can fire `load` before its
  //    pixel buffer is decoded, and `ctx.drawImage` of such an <img> can
  //    composite nothing (a blank raster — see the module note and the
  //    blank-upload regression test).
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        resolve();
      };
      img.onerror = () => {
        reject(new Error('image load failed'));
      };
      img.src = url;
    });
  } catch (err) {
    release();
    throw err;
  }

  // 2. Paint-readiness gate. `img.decode()` is the ONLY reliable "safe to
  //    drawImage" signal for an off-DOM <img>; it is awaited here (not raced
  //    against `onload`). A rejection now means this <img> is not a trustworthy
  //    draw source, so we abandon it and let `decodeImage` use the
  //    `createImageBitmap` path — which decodes real pixels from the bytes.
  //    (`decode()` on an <img> whose load already completed is reliable;
  //    the historical "spurious rejection" cases were pre-load.)
  if (typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      release();
      throw new Error('image not reliably decodable via <img>');
    }
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
