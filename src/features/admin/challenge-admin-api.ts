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

// ---------------------------------------------------------------------------
// Start-date correction — a narrow, audited escape hatch for an ACTIVE
// challenge whose start_date was configured wrong (CLAUDE.md-adjacent
// production correction, forward-only). See docs on the RPC in the
// migration; preview and apply share the exact same server-side check.
// ---------------------------------------------------------------------------

export type StartDateBlockingCode =
  | 'not_found'
  | 'not_active'
  | 'not_forward'
  | 'past_end'
  | 'training_exists'
  | 'penalty_target_exists'
  | 'penalty_earned_exists';

export interface StartDateCorrectionPreview {
  ok: boolean;
  blockingCode: StartDateBlockingCode | null;
  blockingDate: string | null;
  oldStartDate: string | null;
  newStartDate: string | null;
  removedRangeStart: string | null;
  removedRangeEnd: string | null;
}

interface StartDateCorrectionCheckJson {
  ok: boolean;
  blocking_code?: string;
  blocking_date?: string;
  old_start_date?: string;
  new_start_date?: string;
  removed_range_start?: string;
  removed_range_end?: string;
}

function toPreview(json: unknown): StartDateCorrectionPreview {
  const j = (json ?? {}) as StartDateCorrectionCheckJson;
  return {
    ok: j.ok,
    blockingCode:
      (j.blocking_code as StartDateBlockingCode | undefined) ?? null,
    blockingDate: j.blocking_date ?? null,
    oldStartDate: j.old_start_date ?? null,
    newStartDate: j.new_start_date ?? null,
    removedRangeStart: j.removed_range_start ?? null,
    removedRangeEnd: j.removed_range_end ?? null,
  };
}

/** Human, Swedish description of why a start-date correction is blocked. */
export function describeStartDateBlock(
  preview: Pick<
    StartDateCorrectionPreview,
    'blockingCode' | 'blockingDate' | 'newStartDate'
  >,
  formatDate: (plainDate: string) => string,
): string {
  const { blockingCode: code, blockingDate, newStartDate } = preview;
  const to = newStartDate ? formatDate(newStartDate) : 'det nya datumet';
  const d = blockingDate ? formatDate(blockingDate) : null;
  switch (code) {
    case 'not_active':
      return 'Bara en aktiv utmaning kan rättas på det här sättet.';
    case 'not_forward':
      return 'Det nya startdatumet måste vara efter det nuvarande.';
    case 'past_end':
      return 'Startdatumet kan inte vara efter utmaningens slutdatum.';
    case 'training_exists':
      return `Startdatumet kan inte flyttas till ${to} eftersom det finns registrerade träningspass${d ? ` den ${d}` : ''}.`;
    case 'penalty_target_exists':
      return `Startdatumet kan inte flyttas till ${to} eftersom ett straff är tilldelat med måldatum${d ? ` ${d}` : ''}.`;
    case 'penalty_earned_exists':
      return `Startdatumet kan inte flyttas till ${to} eftersom ett straff intjänades${d ? ` den ${d}` : ''}.`;
    case 'not_found':
      return 'Utmaningen hittades inte.';
    default:
      return 'Rättningen kan inte genomföras just nu. Förhandsgranska igen.';
  }
}

export async function previewStartDateCorrection(
  challengeId: string,
  newStartDate: string,
): Promise<StartDateCorrectionPreview> {
  const { data, error } = await supabase.rpc(
    'preview_challenge_start_date_correction',
    { p_challenge_id: challengeId, p_new_start_date: newStartDate },
  );
  if (error) throw new Error(translateChallengeError(error.message));
  return toPreview(data);
}

export interface CorrectStartDateInput {
  challengeId: string;
  newStartDate: string;
  reason: string | null;
}

export async function correctChallengeStartDate(
  input: CorrectStartDateInput,
): Promise<ChallengeConfig> {
  const { data, error } = await supabase.rpc('correct_challenge_start_date', {
    p_challenge_id: input.challengeId,
    p_new_start_date: input.newStartDate,
    ...(input.reason ? { p_reason: input.reason } : {}),
  });
  if (error) throw new Error(translateChallengeError(error.message));
  return toConfig(data);
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
