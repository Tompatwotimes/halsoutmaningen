import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { weightKeys } from '@/features/weight/useWeight';

/**
 * Weight Tracking — admin surface: the official final weigh-in, the competition
 * finalize, and the narrow winner disclosure. Only an admin reaches this file.
 * The three writes are the §2.5–§2.7 SECURITY DEFINER RPCs — which enforce
 * admin-only, a mandatory reason (final weight), the "hidden participants are
 * eligible" rule, and the audit. There is NO way here to set is_weight_hidden
 * for a participant or to bypass finalize_weight_competition's own logic.
 */

// TODO(weight-types): drop the cast once the weight migrations are applied and
// `npm run db:types` has run.
const wdb = supabase as unknown as SupabaseClient;

interface Result {
  data: unknown;
  error: { message: string } | null;
}

export class WeightAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeightAdminError';
  }
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
  const res = (await wdb.rpc(fn, args)) as unknown as Result;
  return { data: res.data, error: res.error };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function jstrOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function jnumOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export interface AdminWeightProfileRow {
  userId: string;
  startWeightKg: number | null;
  officialFinalWeightKg: number | null;
  isWeightHidden: boolean;
}

/** Every participant's weight profile for the challenge (admin RLS sees all). */
export async function fetchAdminWeightProfiles(
  challengeId: string,
): Promise<AdminWeightProfileRow[]> {
  const { data, error }: Result = await wdb
    .from('weight_profiles')
    .select(
      'user_id, start_weight_kg, official_final_weight_kg, is_weight_hidden',
    )
    .eq('challenge_id', challengeId);
  if (error) {
    throw new WeightAdminError('Viktprofilerna kunde inte hämtas.');
  }
  return asArray(data).map((raw) => {
    const r = asRecord(raw);
    return {
      userId: jstrOrNull(r.user_id) ?? '',
      startWeightKg: jnumOrNull(r.start_weight_kg),
      officialFinalWeightKg: jnumOrNull(r.official_final_weight_kg),
      isWeightHidden: r.is_weight_hidden === true,
    };
  });
}

export async function setOfficialFinalWeight(
  challengeId: string,
  userId: string,
  weightKg: number,
  reason: string,
): Promise<void> {
  const { error } = await rpc('set_official_final_weight', {
    p_challenge_id: challengeId,
    p_user_id: userId,
    p_weight_kg: weightKg,
    p_reason: reason,
  });
  if (error) {
    throw new WeightAdminError(
      error.message || 'Slutvikten kunde inte sparas.',
    );
  }
}

export interface WeightWinner {
  winnerUserId: string | null;
  winnerPercentageChange: number | null;
}

export async function finalizeWeightCompetition(
  challengeId: string,
): Promise<WeightWinner> {
  const { data, error } = await rpc('finalize_weight_competition', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new WeightAdminError(
      error.message || 'Vinnaren kunde inte fastställas.',
    );
  }
  const r = asRecord(data);
  return {
    winnerUserId: jstrOrNull(r.winner_user_id),
    winnerPercentageChange: jnumOrNull(r.winner_percentage_change),
  };
}

export async function discloseWeightWinner(challengeId: string): Promise<void> {
  const { error } = await rpc('disclose_weight_winner', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new WeightAdminError(
      error.message || 'Vinnaren kunde inte publiceras.',
    );
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAdminWeightProfiles(challengeId: string | null) {
  return useQuery({
    queryKey: ['admin', 'weight-profiles', challengeId],
    enabled: challengeId !== null,
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchAdminWeightProfiles(challengeId);
    },
    staleTime: 15_000,
  });
}

function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
  challengeId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: ['admin', 'weight-profiles', challengeId],
  });
  void queryClient.invalidateQueries({
    queryKey: weightKeys.final(challengeId),
  });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
}

export function useSetOfficialFinalWeight(challengeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; weightKg: number; reason: string }) =>
      setOfficialFinalWeight(
        challengeId,
        vars.userId,
        vars.weightKg,
        vars.reason,
      ),
    onSuccess: () => invalidateAll(queryClient, challengeId),
  });
}

export function useFinalizeWeightCompetition(challengeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => finalizeWeightCompetition(challengeId),
    onSuccess: () => invalidateAll(queryClient, challengeId),
  });
}

export function useDiscloseWeightWinner(challengeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discloseWeightWinner(challengeId),
    onSuccess: () => invalidateAll(queryClient, challengeId),
  });
}
