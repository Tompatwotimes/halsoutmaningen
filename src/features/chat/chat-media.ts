import { supabase } from '@/lib/supabase';
import {
  ImageProcessingError,
  processImageForUpload,
  type ProcessImageOptions,
  type UploadPhaseCallback,
} from '@/lib/media/image-processing';
import {
  GENERIC_UNSUPPORTED_MESSAGE,
  HEIC_UNSUPPORTED_MESSAGE,
} from '@/features/challenge/heic';
import { ChatError } from './chat-error';

/**
 * Chat image upload / signed-URL boundary.
 *
 * The message and its attachment rows are written atomically by
 * `post_chat_message` (20260906120200). To let the client upload the image
 * bytes *before* that row exists, the client generates the message id itself
 * and uploads each file to
 *
 *   chat-media/{challengeId}/{userId}/{messageId}/{position}-{uuid}.{ext}
 *
 * which is the only shape the storage upload policy accepts, and the only
 * prefix `post_chat_message` will link. On any failure the just-uploaded
 * objects are removed best-effort — an object with no attachment row is
 * unreadable (the storage read policy needs the backing row) and a rare
 * residual orphan is acceptable, matching the proof-upload behaviour.
 *
 * Every file is resized + re-compressed client-side first (PR A) — the bytes
 * uploaded are always a browser-universal JPEG/WebP, never a multi-MB original
 * or an unviewable HEIC. The server MIME/size limits still apply and remain
 * authoritative; compression only reduces cost and speeds the upload.
 *
 * Reads: a signed URL, requested only when a bubble with images is actually
 * shown. The storage read policy (`_chat_attachment_readable`) is the real gate
 * — a hidden message's objects return no URL even with the path.
 */

export const CHAT_MEDIA_BUCKET = 'chat-media';
export const CHAT_IMAGE_MAX_COUNT = 4;
// One hour — see the matching note in challenge/entries-api.ts. The TTL must
// outlive the React Query cache entry holding the URL so an expired URL is
// never rendered; the object stays private (non-public bucket, member-only
// read policy, single already-visible image).
const SIGNED_URL_TTL_SECONDS = 3600;

/** Compression profile for chat images (spec §5: ~1600px, ~200–500 KB). */
export const CHAT_IMAGE_PROCESS_OPTIONS: ProcessImageOptions = {
  maxLongSidePx: 1600,
  format: 'auto',
  quality: 0.82,
  qualityFloor: 0.6,
  targetBytes: 500 * 1024,
  passthroughMaxBytes: 512 * 1024,
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

export interface PreparedChatAttachment {
  path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A new client-side message id, so uploads can target its folder. */
export function newChatMessageId(): string {
  return randomId();
}

/** Map a processing failure to the Swedish copy the composer shows. */
function processingErrorToChat(err: ImageProcessingError): ChatError {
  if (err.code === 'undecodable' || err.code === 'unsupported-type') {
    return new ChatError(
      err.likelyHeic ? HEIC_UNSUPPORTED_MESSAGE : GENERIC_UNSUPPORTED_MESSAGE,
    );
  }
  if (err.code === 'empty-file') {
    return new ChatError('En av bilderna är tom. Välj en annan bild.');
  }
  return new ChatError(
    'Bilden kunde inte förberedas. Försök med en annan bild.',
  );
}

/**
 * Compress and upload up to 4 image files for `messageId`. Returns the
 * attachment descriptors to hand to `post_chat_message`, in the given order.
 * Throws `ChatError` (and cleans up) on the first failure. `onPhase` reports
 * `'processing'` (compressing) then `'uploading'` for the composer label.
 */
export async function uploadChatImages(
  challengeId: string,
  userId: string,
  messageId: string,
  files: File[],
  onPhase?: UploadPhaseCallback,
): Promise<PreparedChatAttachment[]> {
  if (files.length > CHAT_IMAGE_MAX_COUNT) {
    throw new ChatError('Högst fyra bilder per meddelande.');
  }

  const uploaded: string[] = [];
  const prepared: PreparedChatAttachment[] = [];

  try {
    onPhase?.('processing');
    let uploadingAnnounced = false;
    for (const [i, file] of files.entries()) {
      let processed;
      try {
        processed = await processImageForUpload(
          file,
          CHAT_IMAGE_PROCESS_OPTIONS,
        );
      } catch (err) {
        if (err instanceof ImageProcessingError)
          throw processingErrorToChat(err);
        throw err;
      }

      if (!uploadingAnnounced) {
        onPhase?.('uploading');
        uploadingAnnounced = true;
      }

      const ext = EXT_BY_MIME[processed.mimeType] ?? 'jpg';
      const path = `${challengeId}/${userId}/${messageId}/${i + 1}-${randomId()}.${ext}`;
      const { error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(path, processed.file, {
          contentType: processed.mimeType,
          upsert: false,
        });
      if (error) {
        throw new ChatError('Bilden kunde inte laddas upp. Försök igen.');
      }
      uploaded.push(path);
      prepared.push({
        path,
        mime_type: processed.mimeType,
        size_bytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
      });
    }
    return prepared;
  } catch (err) {
    if (uploaded.length > 0) {
      await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .remove(uploaded)
        .catch(() => undefined);
    }
    throw err instanceof ChatError
      ? err
      : new ChatError('Bilderna kunde inte laddas upp.');
  }
}

/** Best-effort removal of already-uploaded objects after a failed send. */
export async function removeChatImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}

/** A signed URL for one attachment path, or null if denied. */
export async function chatImageSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
