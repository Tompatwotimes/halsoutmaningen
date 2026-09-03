import { supabase } from '@/lib/supabase';
import { probeImage } from '@/features/challenge/heic';
import type { PenaltyType } from '@/domain/penalties';

/**
 * Efterregistrering — the "register a past training day" request + admin
 * approval path (CLAUDE.md §5.2 keeps normal same-day logging strict; historical
 * days go through this).
 *
 * A pending request changes nothing. On approval an admin RPC materialises real
 * `training_entries` + `training_proofs` with the original historical
 * `challenge_date`; the existing daily-requirement engine and reconcile triggers
 * then recompute day state / streak / debt / KASSAN / Straffbanken.
 *
 * Proof images: uploaded once, by the participant, into the same private
 * `proofs` bucket + canonical path as normal logging. A pending proof has no
 * `training_proofs` row, so the tightened bucket read policy keeps it visible
 * only to its owner + admins until approval (docs/DATABASE — storage §).
 */

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

export class RetroactiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetroactiveError';
  }
}

export interface RetroactiveProofMeta {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

/**
 * Upload one proof object for a retroactive request. Same validation and path
 * shape as `attachProof` in submit-training.ts; the object is left in place and
 * only referenced by a `training_proofs` row on approval (no byte copy).
 */
export async function uploadRetroactiveProof(
  challengeId: string,
  userId: string,
  challengeDate: string,
  file: File,
): Promise<RetroactiveProofMeta> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new RetroactiveError(
      'Bildformatet stöds inte. Använd en JPEG-, PNG- eller WEBP-bild.',
    );
  }
  const probe = await probeImage(file);
  if (!probe.decodable) {
    throw new RetroactiveError(
      'Bilden kunde inte läsas. Försök med en annan bild.',
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? 'jpg';
  const path = `${challengeId}/${userId}/${challengeDate}/${randomId()}.${ext}`;

  const { error } = await supabase.storage
    .from('proofs')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    throw new RetroactiveError(
      'Bilden kunde inte laddas upp. Kontrollera uppkopplingen och försök igen.',
    );
  }

  return {
    storagePath: path,
    mimeType: file.type,
    sizeBytes: file.size,
    width: probe.width,
    height: probe.height,
  };
}

/** Best-effort cleanup of proof objects after a failed submit. */
export async function removeRetroactiveProofs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage
    .from('proofs')
    .remove(paths)
    .catch(() => undefined);
}

export interface ProposedSessionInput {
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  proof: RetroactiveProofMeta | null;
}

export interface SubmitRetroactiveInput {
  challengeId: string;
  challengeDate: string;
  reason: string;
  sessions: ProposedSessionInput[];
}

function translate(message: string): string {
  // The RPCs already speak Swedish; pass their message through, with a safe
  // fallback for anything unexpected (network / PostgREST).
  if (!message || /fetch failed|Failed to fetch|NetworkError/i.test(message)) {
    return 'Något gick fel. Kontrollera uppkopplingen och försök igen.';
  }
  return message;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function jstr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function jnum(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export async function submitRetroactiveRegistration(
  input: SubmitRetroactiveInput,
): Promise<{ requestId: string }> {
  const { data, error } = await supabase.rpc(
    'submit_retroactive_registration',
    {
      p_challenge_id: input.challengeId,
      p_challenge_date: input.challengeDate,
      p_reason: input.reason,
      p_sessions: input.sessions.map((s, i) => ({
        duration_minutes: s.durationMinutes,
        activity: s.activity,
        note: s.note,
        sort_order: i + 1,
        proof_storage_path: s.proof?.storagePath ?? null,
        proof_mime_type: s.proof?.mimeType ?? null,
        proof_size_bytes: s.proof?.sizeBytes ?? null,
        proof_width: s.proof?.width ?? null,
        proof_height: s.proof?.height ?? null,
      })),
    },
  );
  if (error) throw new RetroactiveError(translate(error.message));
  return { requestId: jstr(asRecord(data).request_id) };
}

export async function cancelRetroactiveRegistration(
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_retroactive_registration', {
    p_request_id: requestId,
  });
  if (error) throw new RetroactiveError(translate(error.message));
}

export async function approveRetroactiveRegistration(
  requestId: string,
  adminNote: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('approve_retroactive_registration', {
    p_request_id: requestId,
    ...(adminNote ? { p_admin_note: adminNote } : {}),
  });
  if (error) throw new RetroactiveError(translate(error.message));
}

export async function rejectRetroactiveRegistration(
  requestId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reject_retroactive_registration', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw new RetroactiveError(translate(error.message));
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type RetroactiveStatus =
  'pending' | 'approved' | 'rejected' | 'cancelled';

export interface RetroactiveRequestRow {
  id: string;
  userId: string;
  challengeDate: string;
  participantReason: string;
  status: RetroactiveStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  sessionCount: number;
}

export async function fetchRetroactiveRequestsForChallenge(
  challengeId: string,
): Promise<RetroactiveRequestRow[]> {
  const { data, error } = await supabase.rpc(
    'retroactive_requests_for_challenge',
    { p_challenge_id: challengeId },
  );
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    id: r.id,
    userId: r.user_id,
    challengeDate: r.challenge_date,
    participantReason: r.participant_reason,
    status: r.status as RetroactiveStatus,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    reviewNote: r.review_note,
    sessionCount: r.session_count,
  }));
}

/** The signed-in participant's own requests for a challenge, newest first. */
export async function fetchMyRetroactiveRequests(
  challengeId: string,
  userId: string,
): Promise<RetroactiveRequestRow[]> {
  const { data, error } = await supabase
    .from('retroactive_training_requests')
    .select(
      'id, user_id, challenge_date, participant_reason, status, submitted_at, reviewed_at, reviewed_by, review_note',
    )
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);

  const ids = data.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: sess, error: sErr } = await supabase
      .from('retroactive_training_request_sessions')
      .select('request_id')
      .in('request_id', ids);
    if (sErr) throw new Error(sErr.message);
    for (const s of sess) {
      counts.set(s.request_id, (counts.get(s.request_id) ?? 0) + 1);
    }
  }

  return data.map((r) => ({
    id: r.id,
    userId: r.user_id,
    challengeDate: r.challenge_date,
    participantReason: r.participant_reason,
    status: r.status as RetroactiveStatus,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    reviewNote: r.review_note,
    sessionCount: counts.get(r.id) ?? 0,
  }));
}

export interface ProposedSessionDetail {
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  proofStoragePath: string | null;
}

export async function fetchRetroactiveRequestSessions(
  requestId: string,
): Promise<ProposedSessionDetail[]> {
  const { data, error } = await supabase
    .from('retroactive_training_request_sessions')
    .select('duration_minutes, activity, note, proof_storage_path, sort_order')
    .eq('request_id', requestId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map((s) => ({
    durationMinutes: s.duration_minutes,
    activity: s.activity,
    note: s.note,
    proofStoragePath: s.proof_storage_path,
  }));
}

export interface ApprovalPreview {
  status: RetroactiveStatus;
  challengeDate: string;
  submittedAt: string;
  participantReason: string;
  reviewNote: string | null;
  proofRequired: boolean;
  currentState: string;
  requiredMinutes: number;
  requiredSessions: number;
  minMinutesPerSession: number;
  penaltyType: PenaltyType | null;
  penaltyDisplayName: string | null;
  existingValidSessions: number;
  existingValidMinutes: number;
  proposedValidSessions: number;
  proposedValidMinutes: number;
  wouldComplete: boolean;
  resultingState: string;
  debtDeltaSek: number;
  missedDayCost: number;
}

export async function fetchApprovalPreview(
  requestId: string,
): Promise<ApprovalPreview> {
  const { data, error } = await supabase.rpc('preview_retroactive_approval', {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  const j = asRecord(data);
  const penalty = jstr(j.penalty_type);
  return {
    status: jstr(j.status) as RetroactiveStatus,
    challengeDate: jstr(j.challenge_date),
    submittedAt: jstr(j.submitted_at),
    participantReason: jstr(j.participant_reason),
    reviewNote: typeof j.review_note === 'string' ? j.review_note : null,
    proofRequired: j.proof_required === true,
    currentState: jstr(j.current_state),
    requiredMinutes: jnum(j.required_minutes, 0),
    requiredSessions: jnum(j.required_sessions, 1),
    minMinutesPerSession: jnum(j.min_minutes_per_session, 0),
    penaltyType: penalty === '' ? null : (penalty as PenaltyType),
    penaltyDisplayName:
      typeof j.penalty_display_name === 'string'
        ? j.penalty_display_name
        : null,
    existingValidSessions: jnum(j.existing_valid_sessions, 0),
    existingValidMinutes: jnum(j.existing_valid_minutes, 0),
    proposedValidSessions: jnum(j.proposed_valid_sessions, 0),
    proposedValidMinutes: jnum(j.proposed_valid_minutes, 0),
    wouldComplete: j.would_complete === true,
    resultingState: jstr(j.resulting_state),
    debtDeltaSek: jnum(j.debt_delta_sek, 0),
    missedDayCost: jnum(j.missed_day_cost, 0),
  };
}

/** A short-lived signed URL for a proof object (private bucket). */
export async function createRetroactiveProofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('proofs')
    .createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
