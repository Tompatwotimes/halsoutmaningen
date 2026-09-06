import { supabase } from '@/lib/supabase';
import { probeImage } from '@/features/challenge/heic';
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
 * Reads: a short-lived signed URL, requested only when a bubble with images is
 * actually shown. The storage read policy (`_chat_attachment_readable`) is the
 * real gate — a hidden message's objects return no URL even with the path.
 */

export const CHAT_MEDIA_BUCKET = 'chat-media';
export const CHAT_IMAGE_MAX_COUNT = 4;
const SIGNED_URL_TTL_SECONDS = 120;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
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

/**
 * Upload up to 4 already-validated image files for `messageId`. Returns the
 * attachment descriptors to hand to `post_chat_message`, in the given order.
 * Throws `ChatError` (and cleans up) on the first failure.
 */
export async function uploadChatImages(
  challengeId: string,
  userId: string,
  messageId: string,
  files: File[],
): Promise<PreparedChatAttachment[]> {
  if (files.length > CHAT_IMAGE_MAX_COUNT) {
    throw new ChatError('Högst fyra bilder per meddelande.');
  }

  const uploaded: string[] = [];
  const prepared: PreparedChatAttachment[] = [];

  try {
    for (const [i, file] of files.entries()) {
      const ext = EXT_BY_MIME[file.type];
      if (!ext) {
        throw new ChatError(
          'Bildformatet stöds inte. Använd en JPEG-, PNG- eller WEBP-bild.',
        );
      }
      const probe = await probeImage(file);
      if (!probe.decodable) {
        throw new ChatError(
          'Bilden kunde inte läsas. Försök med en annan bild.',
        );
      }

      const path = `${challengeId}/${userId}/${messageId}/${i + 1}-${randomId()}.${ext}`;
      const { error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        throw new ChatError('Bilden kunde inte laddas upp. Försök igen.');
      }
      uploaded.push(path);
      prepared.push({
        path,
        mime_type: file.type,
        size_bytes: file.size,
        width: probe.width,
        height: probe.height,
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

/** A short-lived signed URL for one attachment path, or null if denied. */
export async function chatImageSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
