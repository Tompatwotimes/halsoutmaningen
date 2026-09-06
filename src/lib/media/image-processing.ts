import {
  decodeImage,
  ImageDecodeError,
  type DecodedImage,
} from './image-decode';

/**
 * The one client-side image processor shared by every upload path (chat images,
 * training-proof images; PR B will reuse it for avatars via `maxLongSidePx`).
 *
 * Pipeline, per file: validate → decode (correctly oriented — see
 * `image-decode.ts`) → optional passthrough → resize (never upscale) → re-encode
 * to a browser-universal type (WebP where the browser can encode it, else JPEG).
 * Compression is a Storage-cost / UX optimisation, **never** a security
 * boundary — the server MIME/size limits still apply to whatever this emits.
 *
 * Memory: `processImagesForUpload` runs strictly one file at a time and releases
 * each decoded image and canvas before starting the next, so selecting four
 * 48-MP photos never decodes four rasters at once (Mobile Safari).
 */

/** Input MIME types the processor will attempt to decode. */
export const PROCESSABLE_INPUT_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** Types that may pass through unprocessed (browser-universal, non-HEIC). */
const PASSTHROUGH_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export type UploadPhase = 'processing' | 'uploading';
export type UploadPhaseCallback = (phase: UploadPhase) => void;

export interface ProcessImageOptions {
  /** Longest output edge, in px. The image is never scaled up. */
  maxLongSidePx: number;
  /** 'auto' = WebP when the browser can encode it, else JPEG. Default 'auto'. */
  format?: 'auto' | 'jpeg' | 'webp';
  /** Initial encode quality (0–1). Default 0.82. */
  quality?: number;
  /** Encode quality floor while chasing `targetBytes`. Default 0.6. */
  qualityFloor?: number;
  /**
   * Soft byte target. If the first encode is larger, ONE lower-quality
   * re-encode is attempted (never below `qualityFloor`). Omitted = no size
   * chase — dimension reduction + a single quality pass only.
   */
  targetBytes?: number;
  /**
   * When set, a file that is already within `maxLongSidePx` on both axes AND
   * `<= passthroughMaxBytes` AND already a browser-universal type is returned
   * unchanged (`wasProcessed: false`). HEIC never passes through.
   */
  passthroughMaxBytes?: number;
}

export interface ProcessedImage {
  /** The file to upload — a re-encoded file, or the original on passthrough. */
  file: File;
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
  sizeBytes: number;
  width: number;
  height: number;
  /** False when the original file was returned untouched (passthrough). */
  wasProcessed: boolean;
}

export type ImageProcessingErrorCode =
  'unsupported-type' | 'undecodable' | 'empty-file' | 'encode-failed';

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;
  /** Heuristic — the input looked like an iPhone HEIC/HEIF. Tailors UI copy. */
  readonly likelyHeic: boolean;

  constructor(
    code: ImageProcessingErrorCode,
    message: string,
    likelyHeic = false,
  ) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
    this.likelyHeic = likelyHeic;
  }
}

const DEFAULT_QUALITY = 0.82;
const DEFAULT_QUALITY_FLOOR = 0.6;
const SECOND_PASS_QUALITY_STEP = 0.15;

function looksLikeHeicName(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

/** Fitted output size — aspect preserved, never larger than the source. */
function computeTargetSize(
  width: number,
  height: number,
  maxLongSidePx: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxLongSidePx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * A drawable canvas + its 2D context. `OffscreenCanvas` is used opportunistically
 * (only when it actually yields a 2D context), never mandatorily — a detached
 * `<canvas>` is the always-available fallback. Both are off-DOM.
 */
function createDrawSurface(
  width: number,
  height: number,
): { canvas: AnyCanvas; ctx: Ctx2d } | null {
  if (typeof OffscreenCanvas === 'function') {
    try {
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d');
      if (ctx) return { canvas: offscreen, ctx };
    } catch {
      // fall through to a DOM canvas
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function releaseCanvas(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

let webpEncodeSupport: boolean | null = null;

/** Cached synchronous probe: can this browser's canvas encode WebP at all? */
function canEncodeWebp(): boolean {
  if (webpEncodeSupport !== null) return webpEncodeSupport;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    webpEncodeSupport = probe
      .toDataURL('image/webp')
      .startsWith('data:image/webp');
  } catch {
    webpEncodeSupport = false;
  }
  return webpEncodeSupport;
}

/** Test seam — reset the memoised WebP probe. */
export function __resetWebpProbeForTests(): void {
  webpEncodeSupport = null;
}

function encodeCanvas(
  canvas: AnyCanvas,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas
      .convertToBlob({ type: mime, quality })
      .then((blob) => blob)
      .catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

function deriveProcessedFilename(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, '').trim();
  return `${base.length > 0 ? base : 'bild'}.${ext}`;
}

function toProcessingError(err: unknown, file: File): ImageProcessingError {
  if (err instanceof ImageProcessingError) return err;
  if (err instanceof ImageDecodeError) {
    return new ImageProcessingError('undecodable', err.message, err.likelyHeic);
  }
  return new ImageProcessingError(
    'undecodable',
    'Bilden kunde inte bearbetas.',
    looksLikeHeicName(file),
  );
}

/**
 * Resize + re-compress one image for upload. Rejects with `ImageProcessingError`
 * for an empty / unsupported / undecodable / un-encodable file — the caller
 * maps `code` / `likelyHeic` to Swedish UI copy and never uploads the original.
 */
export async function processImageForUpload(
  file: File,
  options: ProcessImageOptions,
): Promise<ProcessedImage> {
  // 1. Validate.
  if (file.size === 0) {
    throw new ImageProcessingError('empty-file', 'Bilden är tom.');
  }
  if (file.type !== '' && !PROCESSABLE_INPUT_MIME.includes(file.type)) {
    throw new ImageProcessingError(
      'unsupported-type',
      'Bildformatet stöds inte. Använd en JPEG-, PNG- eller WEBP-bild.',
      looksLikeHeicName(file),
    );
  }

  // 2. Decode (correctly oriented).
  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch (err) {
    throw toProcessingError(err, file);
  }

  try {
    const srcW = decoded.width;
    const srcH = decoded.height;

    // 3. Passthrough — small enough already, and a directly-uploadable type.
    if (
      options.passthroughMaxBytes != null &&
      file.size <= options.passthroughMaxBytes &&
      srcW <= options.maxLongSidePx &&
      srcH <= options.maxLongSidePx &&
      PASSTHROUGH_MIME.includes(file.type)
    ) {
      return {
        file,
        mimeType: file.type as ProcessedImage['mimeType'],
        sizeBytes: file.size,
        width: srcW,
        height: srcH,
        wasProcessed: false,
      };
    }

    // 4. Target size (never upscale).
    const target = computeTargetSize(srcW, srcH, options.maxLongSidePx);

    // 5. Format decision (before draw — governs the JPEG white background).
    const requested = options.format ?? 'auto';
    const mime: 'image/jpeg' | 'image/webp' =
      requested === 'jpeg'
        ? 'image/jpeg'
        : requested === 'webp'
          ? 'image/webp'
          : canEncodeWebp()
            ? 'image/webp'
            : 'image/jpeg';

    // 6. Draw.
    const surface = createDrawSurface(target.width, target.height);
    if (!surface) {
      throw new ImageProcessingError(
        'encode-failed',
        'Bilden kunde inte bearbetas i den här webbläsaren.',
      );
    }
    const { canvas, ctx } = surface;
    try {
      if (mime === 'image/jpeg') {
        // JPEG has no alpha — flatten transparency onto white, not black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, target.width, target.height);
      }
      decoded.draw(ctx, target.width, target.height);
      decoded.close();

      // 7. Encode.
      const quality = options.quality ?? DEFAULT_QUALITY;
      const floor = options.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
      let blob = await encodeCanvas(canvas, mime, quality);
      if (blob?.type !== mime) {
        throw new ImageProcessingError(
          'encode-failed',
          'Bilden kunde inte komprimeras. Försök med en annan bild.',
        );
      }

      // 8. Bounded second pass — at most one lower-quality retry.
      if (
        options.targetBytes != null &&
        blob.size > options.targetBytes &&
        quality > floor
      ) {
        const q2 = Math.max(floor, quality - SECOND_PASS_QUALITY_STEP);
        const blob2 = await encodeCanvas(canvas, mime, q2);
        if (blob2?.type === mime && blob2.size < blob.size) {
          blob = blob2;
        }
      }

      // 9–11. Build the output file.
      const ext = mime === 'image/webp' ? 'webp' : 'jpg';
      const out = new File([blob], deriveProcessedFilename(file.name, ext), {
        type: mime,
        lastModified: Date.now(),
      });
      return {
        file: out,
        mimeType: mime,
        sizeBytes: blob.size,
        width: target.width,
        height: target.height,
        wasProcessed: true,
      };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    decoded.close();
  }
}

/**
 * Process several files **strictly sequentially** (bounded memory). Rejects with
 * the first `ImageProcessingError`, its message prefixed `Bild N: …` so the UI
 * can point at the offending image.
 */
export async function processImagesForUpload(
  files: File[],
  options: ProcessImageOptions,
): Promise<ProcessedImage[]> {
  const out: ProcessedImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    try {
      out.push(await processImageForUpload(file, options));
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        throw new ImageProcessingError(
          err.code,
          `Bild ${String(i + 1)}: ${err.message}`,
          err.likelyHeic,
        );
      }
      throw err;
    }
  }
  return out;
}
