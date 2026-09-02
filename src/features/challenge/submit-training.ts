import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { probeImage } from './heic';

/**
 * The "Logga träning" write path (CLAUDE.md §5.2, real-data phase Part 5).
 * Two effects that can fail independently:
 *
 *   1. upsert `training_entries`   (duration/activity/note for the day)
 *   2. upload + link a proof image (only if a file was provided)
 *
 * The canonical completed/missed state is computed server-side from these two
 * tables (`challenge_day_states`) — this module never claims completion
 * itself. If the entry saves but the image upload/link fails, the day stays
 * pending/missed until proof exists, which is exactly correct when
 * `proof_required` is true: no optimistic UI here can make a day falsely
 * "completed".
 *
 * Retry is safe to call again with the same inputs: the entry upsert is
 * idempotent, and proof attachment always re-checks for a prior proof row
 * before inserting a new one (delete-then-insert, since `training_proofs`
 * has no UPDATE policy — docs/DATABASE.md §2).
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
  /** Omit (or null) to leave an existing entry's proof untouched. */
  proofFile?: File | null;
}

export interface SubmitTrainingResult {
  entryId: string;
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

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

/**
 * Uploads a new proof object and links it to `entryId`, replacing any prior
 * proof for the same entry. Ordering is chosen so a failure never leaves the
 * entry with *zero* proof when it had one a moment ago:
 *
 *   upload new object → delete old DB row → insert new DB row → delete old object
 *
 * If the insert fails after the old row is gone, the entry is briefly without
 * a linked proof (same-day, owner-recoverable by retrying — the accepted
 * residual gap documented in docs/DATABASE.md §6). The newly uploaded object
 * is removed on any failure so it never becomes a permanent orphan.
 */
export async function attachProof(
  challengeId: string,
  userId: string,
  date: string,
  entryId: string,
  file: File,
): Promise<void> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new SubmitTrainingError(
      'Bildformatet stöds inte. Använd en JPEG-, PNG- eller WEBP-bild.',
      true,
    );
  }

  const probe = await probeImage(file);
  if (!probe.decodable) {
    throw new SubmitTrainingError(
      'Bilden kunde inte läsas och sparades inte. Passet i sig är sparat — försök med en annan bild.',
      true,
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? 'jpg';
  // Path shape must match the storage RLS policies exactly (0002_storage.sql):
  // folder[1] = challenge_id (membership check), folder[2] = user_id (owner check).
  const path = `${challengeId}/${userId}/${date}/${randomId()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('proofs')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new SubmitTrainingError(
      'Bilden kunde inte laddas upp. Passet är sparat — försök igen med bilden.',
      true,
    );
  }

  const { data: existing } = await supabase
    .from('training_proofs')
    .select('storage_path')
    .eq('training_entry_id', entryId)
    .maybeSingle();

  if (existing) {
    const { error: deleteError } = await supabase
      .from('training_proofs')
      .delete()
      .eq('training_entry_id', entryId);
    if (deleteError) {
      await supabase.storage
        .from('proofs')
        .remove([path])
        .catch(() => undefined);
      throw new SubmitTrainingError(
        'Den tidigare bilden kunde inte bytas ut. Passet är sparat — försök igen.',
        true,
      );
    }
  }

  const { error: insertError } = await supabase.from('training_proofs').insert({
    training_entry_id: entryId,
    // challenge_id/user_id are denormalised and overwritten by
    // training_proofs_guard from the parent entry — passed here only to
    // satisfy the NOT NULL columns' generated Insert type.
    challenge_id: challengeId,
    user_id: userId,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
    width: probe.width,
    height: probe.height,
  });

  if (insertError) {
    await supabase.storage
      .from('proofs')
      .remove([path])
      .catch(() => undefined);
    throw new SubmitTrainingError(
      'Passet är sparat men bildbeviset kunde inte kopplas. Försök ladda upp bilden igen.',
      true,
    );
  }

  if (existing?.storage_path) {
    await supabase.storage
      .from('proofs')
      .remove([existing.storage_path])
      .catch(() => undefined);
  }
}

export async function submitTraining(
  input: SubmitTrainingInput,
): Promise<SubmitTrainingResult> {
  const entry = await upsertEntry(input);

  if (input.proofFile) {
    await attachProof(
      input.challengeId,
      input.userId,
      input.date,
      entry.id,
      input.proofFile,
    );
  }

  return { entryId: entry.id };
}
