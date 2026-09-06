import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  WeightEntry,
  WeightFinalResult,
  WeightProfile,
  WeightRankingRow,
} from './types';

/**
 * Weight Tracking — Supabase adapter boundary.
 *
 * Same deliberately-untyped boundary as game-master-api.ts / chat-api.ts: the
 * weight tables and RPCs are absent from the generated `Database` type until
 * this feature's migrations are applied and `npm run db:types` is re-run.
 *
 * Writes and the two read models go through RPCs. `log_weight_entry` has NO
 * date parameter — this adapter cannot even attempt a backdated entry
 * (spec §2.3). Reads of the caller's OWN weight_profiles / weight_entries are
 * plain RLS-scoped selects (the owner clause always matches); the public
 * ranking and the final result go through the SECURITY INVOKER read models so
 * hide-my-weight is enforced server-side, never in React.
 */

// TODO(weight-types): drop the cast once the weight migrations are applied and
// `npm run db:types` has run.
const wdb = supabase as unknown as SupabaseClient;

export class WeightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeightError';
  }
}

interface Result {
  data: unknown;
  error: { message: string } | null;
}

async function weightRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<Result> {
  const res = (await wdb.rpc(fn, args)) as unknown as Result;
  return { data: res.data, error: res.error };
}

// ---------------------------------------------------------------------------
// Narrowing
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function jstr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function jstrOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function jnum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : 0;
}
function jnumOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}
function jbool(v: unknown): boolean {
  return v === true;
}

function mapProfile(raw: Record<string, unknown>): WeightProfile {
  return {
    challengeId: jstr(raw.challenge_id),
    userId: jstr(raw.user_id),
    startWeightKg: jnumOrNull(raw.start_weight_kg),
    startWeightFirstSavedAt: jstrOrNull(raw.start_weight_first_saved_at),
    startWeightLockedAt: jstrOrNull(raw.start_weight_locked_at),
    isWeightHidden: jbool(raw.is_weight_hidden),
    officialFinalWeightKg: jnumOrNull(raw.official_final_weight_kg),
    officialFinalRecordedAt: jstrOrNull(raw.official_final_recorded_at),
  };
}

function mapEntry(raw: Record<string, unknown>): WeightEntry {
  return {
    id: jstr(raw.id),
    challengeId: jstr(raw.challenge_id),
    userId: jstr(raw.user_id),
    entryDate: jstr(raw.entry_date),
    weightKg: jnum(raw.weight_kg),
  };
}

function mapRankingRow(raw: Record<string, unknown>): WeightRankingRow {
  return {
    userId: jstr(raw.user_id),
    displayName: jstr(raw.display_name),
    startWeightKg: jnum(raw.start_weight_kg),
    latestWeightKg: jnum(raw.latest_weight_kg),
    latestEntryDate: jstr(raw.latest_entry_date),
    kgChange: jnum(raw.kg_change),
    percentageChange: jnum(raw.percentage_change),
  };
}

const PROFILE_COLUMNS =
  'challenge_id, user_id, start_weight_kg, start_weight_first_saved_at, ' +
  'start_weight_locked_at, is_weight_hidden, official_final_weight_kg, ' +
  'official_final_recorded_at';
const ENTRY_COLUMNS = 'id, challenge_id, user_id, entry_date, weight_kg';

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/**
 * Set/edit the caller's own start weight. First call locks the 24h window; the
 * server rejects a call after the lock with a distinct Swedish message, passed
 * straight through here.
 */
export async function setStartWeight(
  challengeId: string,
  weightKg: number,
): Promise<WeightProfile> {
  const { data, error } = await weightRpc('set_start_weight', {
    p_challenge_id: challengeId,
    p_weight_kg: weightKg,
  });
  if (error) {
    throw new WeightError(weightWriteError(error.message));
  }
  return mapProfile(asRecord(data));
}

/** Log today's regular weight. No date — the server always targets today. */
export async function logWeightEntry(
  challengeId: string,
  weightKg: number,
): Promise<WeightEntry> {
  const { data, error } = await weightRpc('log_weight_entry', {
    p_challenge_id: challengeId,
    p_weight_kg: weightKg,
  });
  if (error) {
    throw new WeightError(weightWriteError(error.message));
  }
  return mapEntry(asRecord(data));
}

/** Toggle "Dölj min vikt". Works before any start weight exists. */
export async function setWeightHidden(
  challengeId: string,
  hidden: boolean,
): Promise<void> {
  const { error } = await weightRpc('set_weight_hidden', {
    p_challenge_id: challengeId,
    p_hidden: hidden,
  });
  if (error) {
    throw new WeightError('Sekretessinställningen kunde inte sparas.');
  }
}

function weightWriteError(serverMessage: string): string {
  if (
    !serverMessage ||
    /fetch failed|Failed to fetch|NetworkError/i.test(serverMessage)
  ) {
    return 'Något gick fel. Kontrollera uppkopplingen och försök igen.';
  }
  // The RPC already speaks Swedish (locked / not a member / invalid weight) —
  // pass it through unchanged.
  return serverMessage;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The caller's own weight profile (RLS owner clause). Null if no row yet. */
export async function fetchMyWeightProfile(
  challengeId: string,
  userId: string,
): Promise<WeightProfile | null> {
  const { data, error }: Result = await wdb
    .from('weight_profiles')
    .select(PROFILE_COLUMNS)
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new WeightError('Vikten kunde inte hämtas.');
  }
  return data ? mapProfile(asRecord(data)) : null;
}

/** The caller's own weight entries, newest first. */
export async function fetchMyWeightEntries(
  challengeId: string,
  userId: string,
): Promise<WeightEntry[]> {
  const { data, error }: Result = await wdb
    .from('weight_entries')
    .select(ENTRY_COLUMNS)
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .order('entry_date', { ascending: false });
  if (error) {
    throw new WeightError('Viktloggen kunde inte hämtas.');
  }
  return asArray(data).map((r) => mapEntry(asRecord(r)));
}

/**
 * The public live Viktkampen ranking. SECURITY INVOKER RPC — a hidden
 * participant is simply not in the result (RLS), never fetched-then-hidden.
 */
export async function fetchWeightPublicRanking(
  challengeId: string,
): Promise<WeightRankingRow[]> {
  const { data, error } = await weightRpc('weight_public_ranking', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new WeightError('Viktkampen kunde inte hämtas.');
  }
  return asArray(data).map((r) => mapRankingRow(asRecord(r)));
}

/**
 * The official final result, field-gated server-side: winner fields are null
 * for an ordinary co-member of a hidden, undisclosed winner.
 */
export async function fetchWeightFinalResult(
  challengeId: string,
): Promise<WeightFinalResult> {
  const { data, error } = await weightRpc('weight_final_result', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new WeightError('Slutresultatet kunde inte hämtas.');
  }
  const row = asArray(data)[0];
  if (!row) {
    return {
      winnerUserId: null,
      winnerDisplayName: null,
      winnerPercentageChange: null,
      disclosed: false,
    };
  }
  const r = asRecord(row);
  return {
    winnerUserId: jstrOrNull(r.winner_user_id),
    winnerDisplayName: jstrOrNull(r.winner_display_name),
    winnerPercentageChange: jnumOrNull(r.winner_percentage_change),
    disclosed: jbool(r.disclosed),
  };
}
