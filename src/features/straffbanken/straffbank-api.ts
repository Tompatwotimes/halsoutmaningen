import { supabase } from '@/lib/supabase';
import { PenaltyType } from '@/domain/penalties';

export type EarnedPenaltyStatus = 'available' | 'spent' | 'expired' | 'revoked';
export type AssignmentStatus = 'active' | 'cancelled';

function toPenaltyType(value: string): PenaltyType {
  return value === PenaltyType.DoubleSession
    ? PenaltyType.DoubleSession
    : PenaltyType.MinimumMinutes;
}

export interface EarnedPenaltyRow {
  id: string;
  challengeId: string;
  penaltyDefinitionId: string;
  streakRunStart: string;
  penaltyType: PenaltyType;
  value: number;
  displayName: string;
  earnedOnDate: string;
  status: EarnedPenaltyStatus;
  spentAssignmentId: string | null;
}

export interface PenaltyAssignmentRow {
  id: string;
  challengeId: string;
  earnedPenaltyId: string;
  fromUserId: string;
  toUserId: string;
  targetDate: string;
  penaltyType: PenaltyType;
  value: number;
  displayName: string;
  status: AssignmentStatus;
  cancelledReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface PenaltyDefinitionRow {
  id: string;
  challengeId: string;
  unlockStreak: number;
  penaltyType: PenaltyType;
  value: number;
  displayName: string;
  active: boolean;
  sortOrder: number;
}

export async function fetchEarnedPenalties(
  challengeId: string,
  userId: string,
): Promise<EarnedPenaltyRow[]> {
  const { data, error } = await supabase
    .from('earned_penalties')
    .select(
      'id, challenge_id, penalty_definition_id, streak_run_start, penalty_type, value, display_name, earned_on_date, status, spent_assignment_id',
    )
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .order('earned_on_date', { ascending: true });

  if (error) throw new Error(error.message);

  return data.map((r) => ({
    id: r.id,
    challengeId: r.challenge_id,
    penaltyDefinitionId: r.penalty_definition_id,
    streakRunStart: r.streak_run_start,
    penaltyType: toPenaltyType(r.penalty_type),
    value: r.value,
    displayName: r.display_name,
    earnedOnDate: r.earned_on_date,
    status: r.status as EarnedPenaltyStatus,
    spentAssignmentId: r.spent_assignment_id,
  }));
}

export async function fetchPenaltyDefinitions(
  challengeId: string,
): Promise<PenaltyDefinitionRow[]> {
  const { data, error } = await supabase
    .from('challenge_penalty_definitions')
    .select(
      'id, challenge_id, unlock_streak, penalty_type, value, display_name, active, sort_order',
    )
    .eq('challenge_id', challengeId)
    .order('unlock_streak', { ascending: true });

  if (error) throw new Error(error.message);

  return data.map((r) => ({
    id: r.id,
    challengeId: r.challenge_id,
    unlockStreak: r.unlock_streak,
    penaltyType: toPenaltyType(r.penalty_type),
    value: r.value,
    displayName: r.display_name,
    active: r.active,
    sortOrder: r.sort_order,
  }));
}

/** Every penalty assignment for a challenge — RLS exposes all rows to members. */
export async function fetchPenaltyAssignments(
  challengeId: string,
): Promise<PenaltyAssignmentRow[]> {
  const { data, error } = await supabase
    .from('penalty_assignments')
    .select(
      'id, challenge_id, earned_penalty_id, from_user_id, to_user_id, target_date, penalty_type, value, display_name, status, cancelled_reason, cancelled_at, created_at',
    )
    .eq('challenge_id', challengeId)
    .order('target_date', { ascending: true });

  if (error) throw new Error(error.message);

  return data.map((r) => ({
    id: r.id,
    challengeId: r.challenge_id,
    earnedPenaltyId: r.earned_penalty_id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    targetDate: r.target_date,
    penaltyType: toPenaltyType(r.penalty_type),
    value: r.value,
    displayName: r.display_name,
    status: r.status as AssignmentStatus,
    cancelledReason: r.cancelled_reason,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
  }));
}

export interface PreviewResult {
  ok: boolean;
  targetDate: string | null;
  displayName: string | null;
  reason: string | null;
}

export async function previewPenaltyTarget(
  earnedPenaltyId: string,
  toUserId: string,
): Promise<PreviewResult> {
  const { data, error } = await supabase.rpc('preview_penalty_target', {
    p_earned_penalty_id: earnedPenaltyId,
    p_to_user_id: toUserId,
  });
  if (error) throw new Error(error.message);
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    ok: j.ok === true,
    targetDate: typeof j.target_date === 'string' ? j.target_date : null,
    displayName: typeof j.display_name === 'string' ? j.display_name : null,
    reason: typeof j.reason === 'string' ? j.reason : null,
  };
}

export interface AssignResult {
  assignmentId: string;
  toUserId: string;
  targetDate: string;
  displayName: string;
}

export async function assignPenalty(
  earnedPenaltyId: string,
  toUserId: string,
): Promise<AssignResult> {
  const { data, error } = await supabase.rpc('assign_penalty', {
    p_earned_penalty_id: earnedPenaltyId,
    p_to_user_id: toUserId,
  });
  if (error) throw new Error(translateAssignError(error.message));
  const j = (data ?? {}) as Record<string, unknown>;
  const s = (v: unknown, fallback = '') =>
    typeof v === 'string' ? v : fallback;
  return {
    assignmentId: s(j.assignment_id),
    toUserId: s(j.to_user_id, toUserId),
    targetDate: s(j.target_date),
    displayName: s(j.display_name),
  };
}

export async function cancelPenaltyAssignment(
  assignmentId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_penalty_assignment', {
    p_assignment_id: assignmentId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

function translateAssignError(message: string): string {
  if (message.includes('straffa dig själv'))
    return 'Du kan inte straffa dig själv.';
  if (message.includes('ledig dag kvar'))
    return 'Det finns ingen ledig dag kvar att straffa personen på.';
  if (message.includes('inte aktiv')) return 'Utmaningen är inte aktiv.';
  if (message.includes('redan använt') || message.includes('gått ut'))
    return 'Straffet är redan använt eller har gått ut.';
  if (
    message.includes('inte med i utmaningen') ||
    message.includes('aktiv deltagare')
  )
    return 'Personen är inte en aktiv deltagare.';
  return message;
}
