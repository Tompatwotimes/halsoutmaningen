import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  GameMasterEvent,
  GameMasterEventStatus,
  GameMasterSeverity,
  GameMasterVisibility,
} from './types';

/**
 * Game Master GM1 — Supabase adapter boundary.
 *
 * Game Master is an isolated, optional subsystem (spec §2). Everything in this
 * file is best-effort from the core app's point of view: a transport failure
 * here throws a `GameMasterError` that callers on the training/admin paths
 * swallow, and it can never change training validity, day states, streaks,
 * liability/KASSAN, ranking, Straffbanken or retroactive registration.
 *
 * The server owns candidate generation, scoring, cooldowns, randomness and
 * persistence. The browser only:
 *   - requests best-effort pulses  (`request_game_master_pulse`)
 *   - reads events it is allowed to see  (RLS-scoped `game_master_events`)
 *   - marks its own views            (`mark_game_master_event_seen`)
 */

// TODO(gm1-types): the GM tables/RPCs are absent from the generated `Database`
// type until the GM1 migration is applied to the hosted project and
// `npm run db:types` is re-run (docs/GAME_MASTER.md rollout). Until then this
// boundary is deliberately untyped and every result is narrowed to an explicit
// interface below; the `as unknown as SupabaseClient` cast can then be removed.
const gmdb = supabase as unknown as SupabaseClient;

export class GameMasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameMasterError';
  }
}

interface GmResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * `gmdb.rpc(...)` resolves to `any` (untyped boundary — see TODO above), which
 * would trip `no-unsafe-assignment` on destructure. Funnel every RPC through
 * here so the `unknown` narrowing happens exactly once.
 */
async function gmRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<GmResult> {
  const res = (await gmdb.rpc(fn, args)) as unknown as GmResult;
  return { data: res.data, error: res.error };
}

const EVENT_COLUMNS =
  'id, challenge_id, family, visibility, subject_user_id, template_id, severity, title_text, body_text, payload, archive, status, starts_at, expires_at, created_at';

// ---------------------------------------------------------------------------
// Narrowing helpers (pattern mirrors retroactive-api.ts)
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

function narrowVisibility(v: unknown): GameMasterVisibility {
  return v === 'public' ? 'public' : 'private';
}

function narrowStatus(v: unknown): GameMasterEventStatus {
  return v === 'expired' || v === 'cancelled' ? v : 'active';
}

function narrowSeverity(v: unknown): GameMasterSeverity {
  const n = typeof v === 'number' ? Math.round(v) : 3;
  const clamped = Math.min(5, Math.max(1, n));
  return clamped as GameMasterSeverity;
}

interface EventView {
  firstSeenAt: string | null;
  dismissedAt: string | null;
}

/** snake_case DB row → frozen `GameMasterEvent`. */
export function mapEventRow(
  row: Record<string, unknown>,
  view: EventView | null = null,
): GameMasterEvent {
  return {
    id: jstr(row.id),
    challengeId: jstr(row.challenge_id),
    family: jstr(row.family),
    visibility: narrowVisibility(row.visibility),
    subjectUserId: jstrOrNull(row.subject_user_id),
    title: jstr(row.title_text),
    body: jstr(row.body_text),
    severity: narrowSeverity(row.severity),
    archive: row.archive === true,
    startsAt: jstr(row.starts_at),
    expiresAt: jstrOrNull(row.expires_at),
    status: narrowStatus(row.status),
    firstSeenAt: view?.firstSeenAt ?? null,
    dismissedAt: view?.dismissedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pulse — best-effort, challenge id only
// ---------------------------------------------------------------------------

/**
 * Ask the server to consider emitting a Game Master event for this challenge.
 *
 * The server is authoritative for throttling, cooldowns, silence and whether
 * Game Master is enabled at all — the wrapper accepts ONLY the challenge id,
 * never a target user, template, body or score (spec §2, global constraints).
 *
 * Resolves to an emitted event id, or `null` when the server stayed silent
 * (throttled / low score / disabled) — silence is normal, not an error. Only a
 * real transport/PostgREST failure rejects (with `GameMasterError`), so a
 * best-effort caller can `.catch(() => undefined)` and swallow just the errors.
 */
export async function requestGameMasterPulse(
  challengeId: string,
): Promise<string | null> {
  const { data, error } = await gmRpc('request_game_master_pulse', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new GameMasterError('Game Master kunde inte kontaktas.');
  }
  return jstrOrNull(data);
}

/**
 * Mark a Game Master event as seen by the current user, optionally dismissing
 * it. Writes go only through this protected RPC — `game_master_event_views` has
 * no direct write policy.
 */
export async function markGameMasterEventSeen(
  eventId: string,
  dismiss: boolean,
): Promise<void> {
  const { error } = await gmRpc('mark_game_master_event_seen', {
    p_event_id: eventId,
    p_dismiss: dismiss,
  });
  if (error) {
    throw new GameMasterError('Kunde inte markera händelsen som sedd.');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The single most relevant active event the current user has not dismissed.
 *
 * Visibility is enforced entirely by RLS (admin, OR public events of a
 * challenge you're in, OR your own private events) — this function never
 * filters by `subject_user_id` client-side as a security measure. It fetches
 * the user's own view rows separately and drops any event already dismissed,
 * then returns the highest-severity / newest remaining event.
 */
export async function fetchNextGameMasterEvent(
  challengeId: string,
  userId: string,
): Promise<GameMasterEvent | null> {
  const nowIso = new Date().toISOString();

  const { data, error }: GmResult = await gmdb
    .from('game_master_events')
    .select(EVENT_COLUMNS)
    .eq('challenge_id', challengeId)
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    throw new GameMasterError('Game Master-händelser kunde inte hämtas.');
  }

  const eventRows = asArray(data);
  if (eventRows.length === 0) return null;

  const { data: viewData, error: viewError }: GmResult = await gmdb
    .from('game_master_event_views')
    .select('event_id, first_seen_at, dismissed_at')
    .eq('user_id', userId);
  if (viewError) {
    throw new GameMasterError('Game Master-händelser kunde inte hämtas.');
  }

  const viewByEvent = new Map<string, EventView>();
  for (const raw of asArray(viewData)) {
    const r = asRecord(raw);
    const id = jstr(r.event_id);
    if (!id) continue;
    viewByEvent.set(id, {
      firstSeenAt: jstrOrNull(r.first_seen_at),
      dismissedAt: jstrOrNull(r.dismissed_at),
    });
  }

  for (const raw of eventRows) {
    const row = asRecord(raw);
    const view = viewByEvent.get(jstr(row.id)) ?? null;
    if (view?.dismissedAt) continue;
    return mapEventRow(row, view);
  }
  return null;
}

/**
 * The public chronicle (Arkivet): public, archival, non-cancelled events for a
 * challenge, newest first. Private and cancelled events never appear here.
 */
export async function fetchGameMasterArchive(
  challengeId: string,
): Promise<GameMasterEvent[]> {
  const { data, error }: GmResult = await gmdb
    .from('game_master_events')
    .select(EVENT_COLUMNS)
    .eq('challenge_id', challengeId)
    .eq('visibility', 'public')
    .eq('archive', true)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) {
    throw new GameMasterError('Arkivet kunde inte hämtas.');
  }
  return asArray(data).map((raw) => mapEventRow(asRecord(raw)));
}
