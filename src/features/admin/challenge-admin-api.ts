import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import {
  fetchPenaltyDefinitions,
  type PenaltyDefinitionRow,
} from '@/features/straffbanken/straffbank-api';

function toStatus(value: string): ChallengeStatus {
  switch (value) {
    case 'active':
      return ChallengeStatus.Active;
    case 'completed':
      return ChallengeStatus.Completed;
    case 'archived':
      return ChallengeStatus.Archived;
    default:
      return ChallengeStatus.Draft;
  }
}

interface ChallengeRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  required_minutes: number;
  proof_required: boolean;
  missed_day_cost: number;
  status: string;
}

function toConfig(row: ChallengeRow): ChallengeConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.timezone,
    requiredMinutes: row.required_minutes,
    proofRequired: row.proof_required,
    missedDayCost: row.missed_day_cost,
    status: toStatus(row.status),
  };
}

export async function fetchChallenge(id: string): Promise<ChallengeConfig> {
  const { data, error } = await supabase
    .from('challenges')
    .select(
      'id, name, description, start_date, end_date, timezone, required_minutes, proof_required, missed_day_cost, status',
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return toConfig(data);
}

export function useChallenge(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'challenge', id],
    queryFn: () => {
      if (id === null) throw new Error('challengeId krävs.');
      return fetchChallenge(id);
    },
    enabled: id !== null,
    staleTime: 15_000,
  });
}

export function useChallengePenaltyDefinitions(challengeId: string | null) {
  return useQuery({
    queryKey: ['straffbank', 'definitions', challengeId ?? ''],
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchPenaltyDefinitions(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 30_000,
  });
}

export type { PenaltyDefinitionRow };

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

export interface CreateChallengeInput {
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  requiredMinutes: number;
  proofRequired: boolean;
  missedDayCost: number;
  /** Also seed the default 20/40/60 penalty milestones. */
  seedDefaultPenalties: boolean;
}

export async function createChallenge(
  input: CreateChallengeInput,
): Promise<ChallengeConfig> {
  const { data, error } = await supabase.rpc('create_challenge', {
    p_name: input.name,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_required_minutes: input.requiredMinutes,
    p_missed_day_cost: input.missedDayCost,
    p_timezone: input.timezone,
    p_proof_required: input.proofRequired,
    ...(input.description ? { p_description: input.description } : {}),
  });
  if (error) throw new Error(translateChallengeError(error.message));
  const row = toConfig(data);

  if (input.seedDefaultPenalties) {
    const { error: seedError } = await supabase.rpc(
      'seed_default_penalty_definitions',
      { p_challenge_id: row.id },
    );
    if (seedError) throw new Error(seedError.message);
  }
  return row;
}

export async function duplicateChallenge(input: {
  sourceId: string;
  name: string;
  startDate: string;
  endDate: string;
  copyRoster: boolean;
}): Promise<ChallengeConfig> {
  const { data, error } = await supabase.rpc('duplicate_challenge', {
    p_source_id: input.sourceId,
    p_name: input.name,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_copy_roster: input.copyRoster,
  });
  if (error) throw new Error(translateChallengeError(error.message));
  return toConfig(data);
}

async function lifecycleRpc(
  fn: 'complete_challenge' | 'archive_challenge' | 'reopen_challenge',
  challengeId: string,
): Promise<ChallengeConfig> {
  const { data, error } = await supabase.rpc(fn, {
    p_challenge_id: challengeId,
  });
  if (error) throw new Error(translateChallengeError(error.message));
  return toConfig(data);
}

export const completeChallenge = (id: string) =>
  lifecycleRpc('complete_challenge', id);
export const archiveChallenge = (id: string) =>
  lifecycleRpc('archive_challenge', id);
export const reopenChallenge = (id: string) =>
  lifecycleRpc('reopen_challenge', id);

export interface UpdateDraftInput {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  requiredMinutes: number;
  proofRequired: boolean;
  missedDayCost: number;
}

/** Direct update — RLS + `challenges_guard` reject anything not allowed. */
export async function updateChallenge(input: UpdateDraftInput): Promise<void> {
  const { error } = await supabase
    .from('challenges')
    .update({
      name: input.name,
      description: input.description,
      start_date: input.startDate,
      end_date: input.endDate,
      required_minutes: input.requiredMinutes,
      proof_required: input.proofRequired,
      missed_day_cost: input.missedDayCost,
    })
    .eq('id', input.id);
  if (error) throw new Error(translateChallengeError(error.message));
}

export async function setChallengeStatus(
  id: string,
  status: 'active' | 'archived',
): Promise<void> {
  const { error } = await supabase
    .from('challenges')
    .update({ status })
    .eq('id', id);
  if (error) throw new Error(translateChallengeError(error.message));
}

function translateChallengeError(message: string): string {
  if (message.includes('rule fields are locked'))
    return 'Reglerna är låsta när utmaningen är aktiv eller har startat. Skapa en ny från denna för att ändra dem.';
  if (message.includes('end_date may only be extended'))
    return 'Slutdatumet kan bara flyttas framåt på en pågående utmaning.';
  if (message.includes('Ogiltig statusövergång'))
    return 'Den statusövergången är inte tillåten.';
  if (message.includes('hamnar utanför de nya datumen'))
    return 'Några deltagares perioder hamnar utanför de nya datumen — justera dem först.';
  if (message.includes('Endast administrat'))
    return 'Endast administratörer får göra detta.';
  return message;
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

function invalidateAdmin(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['admin'] });
  void queryClient.invalidateQueries({ queryKey: ['challenge'] });
  void queryClient.invalidateQueries({ queryKey: ['challenge-data'] });
  void queryClient.invalidateQueries({ queryKey: ['straffbank'] });
}

export function useChallengeAdminMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TArgs>({
    mutationFn,
    onSuccess: () => invalidateAdmin(queryClient),
  });
}
