import { supabase } from '@/lib/supabase';
import type { SelfEntry } from './types';

type EntryStatus = 'active' | 'invalidated';

/**
 * The signed-in user's own training entries for a challenge, most recent
 * first. Bounded by the challenge length (at most a few hundred rows), so a
 * single query covers "today's entry" (Hem/Logga) and the recent-history list
 * (Profil) without a second round trip.
 */
export async function fetchSelfEntries(
  challengeId: string,
  userId: string,
): Promise<SelfEntry[]> {
  const { data: entries, error } = await supabase
    .from('training_entries')
    .select(
      'id, challenge_date, session_seq, duration_minutes, activity, note, status, created_at',
    )
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .order('challenge_date', { ascending: false })
    .order('session_seq', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  if (entries.length === 0) {
    return [];
  }

  const { data: proofs, error: proofError } = await supabase
    .from('training_proofs')
    .select('training_entry_id')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId);

  if (proofError) {
    throw new Error(proofError.message);
  }
  const withProof = new Set(proofs.map((p) => p.training_entry_id));

  return entries.map((e) => ({
    entryId: e.id,
    date: e.challenge_date,
    sessionSeq: e.session_seq,
    durationMinutes: e.duration_minutes,
    activity: e.activity,
    note: e.note,
    hasProof: withProof.has(e.id),
    submittedAt: e.created_at,
    status: e.status as EntryStatus,
  }));
}

export interface EntryDetail {
  entryId: string;
  date: string;
  sessionSeq: number;
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  submittedAt: string;
  status: EntryStatus;
  invalidatedReason: string | null;
  proofPath: string | null;
}

/**
 * One participant's session(s) for one day, on demand — used only when a
 * dashboard/matrix cell is opened (CLAUDE.md §11, §12; never prefetched for a
 * whole grid). A penalised day (Dubbelpass) can hold several sessions. RLS
 * (`training_entries_select`) allows this for any shared-challenge member —
 * that shared visibility is the point of the social-transparency feature.
 */
export async function fetchDaySessions(
  challengeId: string,
  userId: string,
  date: string,
): Promise<EntryDetail[]> {
  const { data: entries, error } = await supabase
    .from('training_entries')
    .select(
      'id, challenge_date, session_seq, duration_minutes, activity, note, status, invalidated_reason, created_at',
    )
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('challenge_date', date)
    .order('session_seq', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  if (entries.length === 0) {
    return [];
  }

  const { data: proofs, error: proofError } = await supabase
    .from('training_proofs')
    .select('training_entry_id, storage_path')
    .in(
      'training_entry_id',
      entries.map((e) => e.id),
    );

  if (proofError) {
    throw new Error(proofError.message);
  }
  const pathByEntry = new Map(
    proofs.map((p) => [p.training_entry_id, p.storage_path]),
  );

  return entries.map((e) => ({
    entryId: e.id,
    date: e.challenge_date,
    sessionSeq: e.session_seq,
    durationMinutes: e.duration_minutes,
    activity: e.activity,
    note: e.note,
    submittedAt: e.created_at,
    status: e.status as EntryStatus,
    invalidatedReason: e.invalidated_reason,
    proofPath: pathByEntry.get(e.id) ?? null,
  }));
}

const PROOF_SIGNED_URL_TTL_SECONDS = 120;

/**
 * A short-lived signed URL for a private proof object (docs/DATABASE.md §6).
 * Requested only when a viewer actually opens an entry's detail — never in
 * bulk for a grid.
 */
export async function createProofSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('proofs')
    .createSignedUrl(path, PROOF_SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw new Error(error.message);
  }
  return data.signedUrl;
}
