/**
 * Best-effort detection of images the browser itself cannot decode — most
 * commonly HEIC/HEIF straight off an iPhone camera roll (CLAUDE.md "Image
 * format / mobile requirements").
 *
 * Rather than sniffing file extensions alone (unreliable — some browsers
 * report a `.heic` file as `image/jpeg`, and some already transcode on
 * capture), this actually tries to decode the file. If decoding fails, other
 * participants' browsers are very likely to fail the same way, so we refuse
 * the file up front with a clear Swedish message instead of silently
 * accepting proof that half the group can't view.
 *
 * A full HEIC→JPEG conversion pipeline (e.g. via a WASM decoder) is a
 * reasonable follow-up but is a real dependency with real weight — out of
 * scope for this phase (documented as a known limitation in the phase report).
 */

export interface ImageProbeResult {
  /** False when the browser could not decode the file at all. */
  decodable: boolean;
  width: number | null;
  height: number | null;
  /** Heuristic only — used to tailor the error message, not the decision. */
  likelyHeic: boolean;
}

export function looksLikeHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

export async function probeImage(file: File): Promise<ImageProbeResult> {
  const likelyHeic = looksLikeHeic(file);

  if (typeof createImageBitmap !== 'function') {
    // Can't verify in this environment — don't block on a guess.
    return { decodable: true, width: null, height: null, likelyHeic };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { decodable: true, width, height, likelyHeic };
  } catch {
    return { decodable: false, width: null, height: null, likelyHeic };
  }
}

export const HEIC_UNSUPPORTED_MESSAGE =
  'Den bildtypen kan inte visas i appen (vanligt för HEIC-bilder från iPhone). ' +
  'Byt kamerans bildformat till "Mest kompatibel" under Inställningar → Kamera → Format, ' +
  'eller välj en JPEG- eller PNG-bild i stället.';

export const GENERIC_UNSUPPORTED_MESSAGE =
  'Den filen kunde inte läsas som en bild. Välj en JPEG-, PNG- eller WEBP-bild.';
