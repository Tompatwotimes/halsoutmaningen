import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { requestGameMasterPulse } from '@/features/game-master/game-master-api';
import {
  ImageProcessingError,
  processImagesForUpload,
  type ProcessImageOptions,
  type UploadPhaseCallback,
} from '@/lib/media/image-processing';
import { GENERIC_UNSUPPORTED_MESSAGE, HEIC_UNSUPPORTED_MESSAGE } from './heic';

/**
 * The "Logga träning" write path (CLAUDE.md §5.2, real-data phase Part 5).
 * Two effects that can fail independently:
 *
 *   1. upsert `training_entries`   (duration/activity/note for the day)
 *   2. upload + link 1–2 proof images (only if files were provided)
 *
 * A session may carry up to TWO proof images — slot 1 (`position = 1`) is the
 * primary proof (required when the challenge requires proof), slot 2 optional
 * (e.g. a selfie + a Strava screenshot). Historical single-image entries are
 * unchanged — one file → one `training_proofs` row at position 1.
 *
 * The canonical completed/missed state is computed server-side from these two
 * tables (`challenge_day_states`) — this module never claims completion
 * itself. If the entry saves but the image upload/link fails, the day stays
 * pending/missed until proof exists, which is exactly correct when
 * `proof_required` is true: no optimistic UI here can make a day falsely
 * "completed".
 *
 * Retry is safe to call again with the same inputs: the entry upsert is
 * idempotent, and proof attachment always re-reads the prior proof rows and
 * rewrites the whole set (delete-then-insert, since `training_proofs` has no
 * UPDATE policy and `unique (training_entry_id, position)` forbids two rows in
 * a slot — docs/DATABASE.md §2). Every new object is uploaded before any DB
 * row is touched, so the brief window with no linked proof matches the
 * single-image behaviour it replaces (same-day, owner-recoverable by retry).
 */

export class SubmitTrainingError extends Error {
  /** True when the entry itself was saved and only the proof step failed. */
  readonly entrySaved: boolean;

  constructor(message: string, entrySaved: boolean) {
    super(message);
    this.name = 'SubmitTrainingError';
    this.entrySaved = entrySaved;
  }
}

export interface SubmitTrainingInput {
  challengeId: string;
  userId: string;
  /** Must equal the current challenge-local day — the DB re-verifies this. */
  date: string;
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  /**
   * 0, 1 or 2 files. Omit / empty array to leave an existing entry's proof(s)
   * untouched. `[0]` is slot 1 (primary), `[1]` is slot 2 (optional). When a
   * non-empty array is given it REPLACES the whole proof set for the entry.
   */
  proofFiles?: File[];
  /** Proof upload progress: `'processing'` (compressing) then `'uploading'`. */
  onProofPhase?: UploadPhaseCallback;
}

export interface SubmitTrainingResult {
  entryId: string;
}

/**
 * Compression profile for training-proof images (spec §5). A slightly higher
 * quality floor than chat — a Strava screenshot's small text must stay legible.
 */
export const PROOF_IMAGE_PROCESS_OPTIONS: ProcessImageOptions = {
  maxLongSidePx: 1600,
  format: 'auto',
  quality: 0.85,
  qualityFloor: 0.65,
  targetBytes: 500 * 1024,
  passthroughMaxBytes: 512 * 1024,
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

/** Translate a client compression failure into Swedish proof-flow copy. */
function proofProcessingError(err: ImageProcessingError): SubmitTrainingError {
  if (err.code === 'undecodable' || err.code === 'unsupported-type') {
    return new SubmitTrainingError(
      err.likelyHeic ? HEIC_UNSUPPORTED_MESSAGE : GENERIC_UNSUPPORTED_MESSAGE,
      true,
    );
  }
  return new SubmitTrainingError(
    'Bilden kunde inte förberedas och sparades inte. Passet i sig är sparat — försök med en annan bild.',
    true,
  );
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Translate the guard-trigger / RLS rejection text into Swedish for the UI. */
function translateEntryError(error: PostgrestError): string {
  const msg = error.message;
  if (msg.includes('Challenge is not active')) {
    return 'Utmaningen är inte aktiv ännu. Be en administratör aktivera den.';
  }
  if (msg.includes('membership is not active')) {
    return 'Ditt medlemskap i utmaningen är pausat just nu.';
  }
  if (msg.includes('only log training for the current challenge day')) {
    return 'Du kan bara logga träning för dagens datum.';
  }
  if (msg.includes('outside the participation window')) {
    return 'Det här datumet ligger utanför din deltagandeperiod i utmaningen.';
  }
  if (msg.includes('No challenge membership')) {
    return 'Du är inte med i den här utmaningen än.';
  }
  if (msg.includes('own training entry') || msg.includes('own your')) {
    return 'Du kan bara logga din egen träning.';
  }
  return 'Passet kunde inte sparas. Kontrollera din uppkoppling och försök igen.';
}

async function upsertEntry(
  input: SubmitTrainingInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('training_entries')
    .upsert(
      {
        challenge_id: input.challengeId,
        user_id: input.userId,
        challenge_date: input.date,
        // The primary session for the day; extra sessions (Dubbelpass) use
        // add_training_session() which assigns the next seq server-side.
        session_seq: 1,
        duration_minutes: input.durationMinutes,
        activity: normalizeText(input.activity),
        note: normalizeText(input.note),
      },
      { onConflict: 'challenge_id,user_id,challenge_date,session_seq' },
    )
    .select('id')
    .single();

  if (error) {
    throw new SubmitTrainingError(translateEntryError(error), false);
  }
  return data;
}

/** Trims and collapses an empty string to null (distinct from `??`). */
function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

const MAX_PROOF_IMAGES = 2;

async function removeObjectsQuiet(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage
    .from('proofs')
    .remove(paths)
    .catch(() => undefined);
}

/**
 * Uploads 1–2 proof objects and links them to `entryId`, REPLACING the entry's
 * whole proof set. Ordering keeps a failure from stranding a permanent orphan
 * object and matches the single-image behaviour it generalises:
 *
 *   compress+decode all → upload every new object → delete old DB rows →
 *   insert new DB rows (positions 1..n) → delete old objects
 *
 * `unique (training_entry_id, position)` forbids two rows in a slot, so the old
 * rows must go before the new ones — the brief window with no linked proof is
 * the same accepted residual gap as before (same-day, owner-recoverable by
 * retry — docs/DATABASE.md §6). Every newly uploaded object is removed on any
 * failure. Each image is resized + re-compressed client-side first (PR A); the
 * bytes stored are always a browser-universal JPEG/WebP within the server MIME
 * allow-list, which still applies.
 */
export async function attachProofs(
  challengeId: string,
  userId: string,
  date: string,
  entryId: string,
  files: File[],
  onProofPhase?: UploadPhaseCallback,
): Promise<void> {
  if (files.length === 0) return;
  if (files.length > MAX_PROOF_IMAGES) {
    throw new SubmitTrainingError('Högst två bildbevis per pass.', true);
  }

  onProofPhase?.('processing');
  let processed;
  try {
    processed = await processImagesForUpload(
      files,
      PROOF_IMAGE_PROCESS_OPTIONS,
    );
  } catch (err) {
    if (err instanceof ImageProcessingError) throw proofProcessingError(err);
    throw err;
  }

  // Existing proof objects for the entry (may be 0, 1 or 2 rows).
  const { data: existingRows } = await supabase
    .from('training_proofs')
    .select('storage_path')
    .eq('training_entry_id', entryId);
  const oldPaths = ((existingRows ?? []) as { storage_path: string }[]).map(
    (r) => r.storage_path,
  );

  // Upload every new (compressed) object BEFORE touching any DB row.
  onProofPhase?.('uploading');
  const uploaded: {
    path: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }[] = [];
  for (const image of processed) {
    const ext = EXT_BY_MIME[image.mimeType] ?? 'jpg';
    // Path shape must match the storage RLS policies exactly (0002_storage.sql):
    // folder[1] = challenge_id (membership check), folder[2] = user_id (owner check).
    const path = `${challengeId}/${userId}/${date}/${randomId()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('proofs')
      .upload(path, image.file, {
        contentType: image.mimeType,
        upsert: false,
      });
    if (uploadError) {
      await removeObjectsQuiet(uploaded.map((u) => u.path));
      throw new SubmitTrainingError(
        'Bilden kunde inte laddas upp. Passet är sparat — försök igen med bilden.',
        true,
      );
    }
    uploaded.push({
      path,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
    });
  }

  if (oldPaths.length > 0) {
    const { error: deleteError } = await supabase
      .from('training_proofs')
      .delete()
      .eq('training_entry_id', entryId);
    if (deleteError) {
      await removeObjectsQuiet(uploaded.map((u) => u.path));
      throw new SubmitTrainingError(
        'Den tidigare bilden kunde inte bytas ut. Passet är sparat — försök igen.',
        true,
      );
    }
  }

  const rows = uploaded.map((u, i) => ({
    training_entry_id: entryId,
    // challenge_id/user_id are denormalised and overwritten by
    // training_proofs_guard from the parent entry — passed here only to
    // satisfy the NOT NULL columns' generated Insert type.
    challenge_id: challengeId,
    user_id: userId,
    storage_path: u.path,
    mime_type: u.mimeType,
    size_bytes: u.sizeBytes,
    width: u.width,
    height: u.height,
    position: i + 1,
  }));
  // `position` is added by 20260906120000_training_proof_two_images.sql;
  // src/types/database.ts is regenerated on rollout (plan Task 11). Until then
  // this one insert goes through an untyped boundary (same pattern as
  // chat-api.ts / game-master-api.ts).
  const proofsInsert = supabase.from('training_proofs') as unknown as {
    insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
  };
  const { error: insertError } = await proofsInsert.insert(rows);

  if (insertError) {
    await removeObjectsQuiet(uploaded.map((u) => u.path));
    throw new SubmitTrainingError(
      'Passet är sparat men bildbeviset kunde inte kopplas. Försök ladda upp bilden igen.',
      true,
    );
  }

  await removeObjectsQuiet(oldPaths);
}

export async function submitTraining(
  input: SubmitTrainingInput,
): Promise<SubmitTrainingResult> {
  const entry = await upsertEntry(input);

  const files = input.proofFiles ?? [];
  if (files.length > 0) {
    await attachProofs(
      input.challengeId,
      input.userId,
      input.date,
      entry.id,
      files,
      input.onProofPhase,
    );
  }

  // Game Master is an isolated optional subsystem (spec §2). Only now that the
  // entry (and its proof, if any) has fully succeeded do we fire one
  // best-effort pulse. It is deliberately NOT awaited, does not touch the
  // returned SubmitTrainingResult, and its rejection is swallowed here — the
  // worst a Game Master failure can ever do is make the Game Master quiet; it
  // can never turn a successful submit into a SubmitTrainingError.
  void requestGameMasterPulse(input.challengeId).catch(() => undefined);

  return { entryId: entry.id };
}
