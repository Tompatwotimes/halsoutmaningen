import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  GameMasterEventStatus,
  GameMasterIntensity,
  GameMasterSettings,
  GameMasterSeverity,
  GameMasterVisibility,
} from '@/features/game-master/types';

/**
 * Game Master GM1 — admin emergency brake + observability adapter (spec §16).
 *
 * This is the ONLY admin surface for Game Master. An admin may enable/disable
 * the subsystem, toggle private/public/archive content, set intensity, inspect
 * recent pulse decisions + events, and cancel/hide a single event with a
 * mandatory reason. An admin may NOT choose a victim, choose a winner, "roast X
 * now" or mint tokens — none of those affordances exist here or anywhere.
 *
 * Both mutating RPCs (`update_game_master_settings`, `cancel_game_master_event`)
 * enforce admin-only in the function body and write an `audit_log` row.
 *
 * Game Master remains isolated: nothing here can change training validity, day
 * states, streaks, liability/KASSAN, ranking, Straffbanken or retroactive
 * registration.
 */

// TODO(gm1-types): the GM tables/RPCs are absent from the generated `Database`
// type until the GM1 migration is applied to the hosted project and
// `npm run db:types` is re-run (docs/GAME_MASTER.md rollout). Until then this
// boundary is deliberately untyped and every result is narrowed to an explicit
// interface below; the `as unknown as SupabaseClient` cast can then be removed.
const gmdb = supabase as unknown as SupabaseClient;

export class GameMasterAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameMasterAdminError';
  }
}

interface GmResult {
  data: unknown;
  error: { message: string } | null;
}

async function gmRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<GmResult> {
  const res = (await gmdb.rpc(fn, args)) as unknown as GmResult;
  return { data: res.data, error: res.error };
}

// ---------------------------------------------------------------------------
// Narrowing helpers (pattern mirrors game-master-api.ts / retroactive-api.ts)
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
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function jbool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function narrowIntensity(v: unknown): GameMasterIntensity {
  return v === 'low' || v === 'high' ? v : 'normal';
}

function narrowVisibility(v: unknown): GameMasterVisibility {
  return v === 'public' ? 'public' : 'private';
}

function narrowStatus(v: unknown): GameMasterEventStatus {
  return v === 'expired' || v === 'cancelled' ? v : 'active';
}

function narrowSeverity(v: unknown): GameMasterSeverity {
  const n = typeof v === 'number' ? Math.round(v) : 3;
  return Math.min(5, Math.max(1, n)) as GameMasterSeverity;
}

function narrowSource(v: unknown): GameMasterRun['source'] {
  return v === 'scheduled' ? 'scheduled' : 'event';
}

function narrowOutcome(v: unknown): GameMasterRun['outcome'] {
  return v === 'silence' ||
    v === 'disabled' ||
    v === 'cooldown' ||
    v === 'error'
    ? v
    : 'event';
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The `game_master_settings` row for a challenge, or `null` when no row exists
 * yet — a missing row means "disabled / defaults" server-side, and the panel
 * seeds its form with the approved defaults in that case.
 */
export async function fetchGameMasterSettings(
  challengeId: string,
): Promise<GameMasterSettings | null> {
  const { data, error }: GmResult = await gmdb
    .from('game_master_settings')
    .select(
      'challenge_id, enabled, private_roasts_enabled, public_roasts_enabled, archive_enabled, intensity',
    )
    .eq('challenge_id', challengeId)
    .maybeSingle();
  if (error) {
    throw new GameMasterAdminError(
      'Game Master-inställningarna kunde inte hämtas.',
    );
  }
  if (!data) return null;
  const row = asRecord(data);
  return {
    challengeId: jstr(row.challenge_id) || challengeId,
    enabled: jbool(row.enabled, true),
    privateRoastsEnabled: jbool(row.private_roasts_enabled, true),
    publicRoastsEnabled: jbool(row.public_roasts_enabled, true),
    archiveEnabled: jbool(row.archive_enabled, true),
    intensity: narrowIntensity(row.intensity),
  };
}

/** Persist the whole settings form in one audited admin RPC call. */
export async function updateGameMasterSettings(
  input: GameMasterSettings,
): Promise<void> {
  const { error } = await gmRpc('update_game_master_settings', {
    p_challenge_id: input.challengeId,
    p_enabled: input.enabled,
    p_private_roasts_enabled: input.privateRoastsEnabled,
    p_public_roasts_enabled: input.publicRoastsEnabled,
    p_archive_enabled: input.archiveEnabled,
    p_intensity: input.intensity,
  });
  if (error) {
    throw new GameMasterAdminError(
      'Inställningarna kunde inte sparas. Försök igen.',
    );
  }
}

// ---------------------------------------------------------------------------
// Observability — pulse decisions
// ---------------------------------------------------------------------------

export interface GameMasterRun {
  id: string;
  source: 'event' | 'scheduled';
  outcome: 'event' | 'silence' | 'disabled' | 'cooldown' | 'error';
  candidateCount: number;
  eligibleCount: number;
  selectedEventId: string | null;
  diagnostics: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

/** Recent pulse decisions for a challenge, newest first. Read-only. */
export async function fetchGameMasterRuns(
  challengeId: string,
  limit = 50,
): Promise<GameMasterRun[]> {
  const { data, error }: GmResult = await gmdb
    .from('game_master_runs')
    .select(
      'id, source, outcome, candidate_count, eligible_count, selected_event_id, diagnostics, started_at, completed_at',
    )
    .eq('challenge_id', challengeId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new GameMasterAdminError('Game Master-besluten kunde inte hämtas.');
  }
  return asArray(data).map((raw) => {
    const row = asRecord(raw);
    return {
      id: jstr(row.id),
      source: narrowSource(row.source),
      outcome: narrowOutcome(row.outcome),
      candidateCount: jnum(row.candidate_count),
      eligibleCount: jnum(row.eligible_count),
      selectedEventId: jstrOrNull(row.selected_event_id),
      diagnostics: asRecord(row.diagnostics),
      startedAt: jstr(row.started_at),
      completedAt: jstrOrNull(row.completed_at),
    };
  });
}

// ---------------------------------------------------------------------------
// Observability — recent events (admin sees ALL incl. private + cancelled)
// ---------------------------------------------------------------------------

export interface AdminGameMasterEvent {
  id: string;
  family: string;
  visibility: GameMasterVisibility;
  subjectUserId: string | null;
  severity: GameMasterSeverity;
  title: string;
  body: string;
  status: GameMasterEventStatus;
  startsAt: string;
  createdAt: string;
  cancelledReason: string | null;
}

/** Recent Game Master events for a challenge, newest first. Read-only. */
export async function fetchRecentGameMasterEvents(
  challengeId: string,
  limit = 50,
): Promise<AdminGameMasterEvent[]> {
  const { data, error }: GmResult = await gmdb
    .from('game_master_events')
    .select(
      'id, family, visibility, subject_user_id, severity, title_text, body_text, status, starts_at, created_at, cancelled_reason',
    )
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new GameMasterAdminError(
      'Game Master-händelserna kunde inte hämtas.',
    );
  }
  return asArray(data).map((raw) => {
    const row = asRecord(raw);
    return {
      id: jstr(row.id),
      family: jstr(row.family),
      visibility: narrowVisibility(row.visibility),
      subjectUserId: jstrOrNull(row.subject_user_id),
      severity: narrowSeverity(row.severity),
      title: jstr(row.title_text),
      body: jstr(row.body_text),
      status: narrowStatus(row.status),
      startsAt: jstr(row.starts_at),
      createdAt: jstr(row.created_at),
      cancelledReason: jstrOrNull(row.cancelled_reason),
    };
  });
}

/**
 * Cancel/hide one event. The server requires a non-empty reason and writes an
 * audit row; the UI additionally disables its confirm until a reason is typed.
 */
export async function cancelGameMasterEvent(
  eventId: string,
  reason: string,
): Promise<void> {
  const { error } = await gmRpc('cancel_game_master_event', {
    p_event_id: eventId,
    p_reason: reason,
  });
  if (error) {
    throw new GameMasterAdminError('Händelsen kunde inte döljas. Försök igen.');
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const gameMasterAdminKeys = {
  settings: (challengeId: string) =>
    ['game-master', 'admin', 'settings', challengeId] as const,
  runs: (challengeId: string) =>
    ['game-master', 'admin', 'runs', challengeId] as const,
  events: (challengeId: string) =>
    ['game-master', 'admin', 'events', challengeId] as const,
};

export function useGameMasterSettings(challengeId: string | null) {
  return useQuery({
    queryKey: gameMasterAdminKeys.settings(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchGameMasterSettings(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 15_000,
  });
}

export function useGameMasterRuns(challengeId: string | null) {
  return useQuery({
    queryKey: gameMasterAdminKeys.runs(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchGameMasterRuns(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 15_000,
  });
}

export function useRecentGameMasterEvents(challengeId: string | null) {
  return useQuery({
    queryKey: gameMasterAdminKeys.events(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchRecentGameMasterEvents(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 15_000,
  });
}

function invalidateGameMasterAdmin(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: ['game-master'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
}

export function useUpdateGameMasterSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GameMasterSettings) => updateGameMasterSettings(input),
    onSuccess: () => invalidateGameMasterAdmin(queryClient),
  });
}

export function useCancelGameMasterEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventId: string; reason: string }) =>
      cancelGameMasterEvent(vars.eventId, vars.reason),
    onSuccess: () => invalidateGameMasterAdmin(queryClient),
  });
}
