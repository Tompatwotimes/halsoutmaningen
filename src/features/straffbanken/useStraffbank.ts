import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { invalidateChallengeData } from '@/features/challenge/useChallengeData';
import {
  assignPenalty,
  cancelPenaltyAssignment,
  fetchEarnedPenalties,
  fetchPenaltyAssignments,
  fetchPenaltyDefinitions,
  type PenaltyAssignmentRow,
} from './straffbank-api';
import {
  nextMilestone,
  summarizeInventory,
  totalAvailable,
  type InventoryItem,
  type NextMilestone,
} from './straffbanken';

export const straffbankKeys = {
  earned: (challengeId: string, userId: string) =>
    ['straffbank', 'earned', challengeId, userId] as const,
  definitions: (challengeId: string) =>
    ['straffbank', 'definitions', challengeId] as const,
  assignments: (challengeId: string) =>
    ['straffbank', 'assignments', challengeId] as const,
};

export interface StraffbankView {
  inventory: InventoryItem[];
  totalAvailable: number;
  nextMilestone: NextMilestone | null;
  /** Active penalties this user has sent that have not yet elapsed. */
  sent: PenaltyAssignmentRow[];
  /** Active penalties targeting this user. */
  received: PenaltyAssignmentRow[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useStraffbank(
  challengeId: string | null,
  userId: string | null,
  currentStreak: number,
): StraffbankView {
  const earnedQ = useQuery({
    queryKey: straffbankKeys.earned(challengeId ?? '', userId ?? ''),
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challenge/user krävs.');
      }
      return fetchEarnedPenalties(challengeId, userId);
    },
    enabled: challengeId !== null && userId !== null,
    staleTime: 20_000,
  });
  const defsQ = useQuery({
    queryKey: straffbankKeys.definitions(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchPenaltyDefinitions(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 60_000,
  });
  const assignmentsQ = useQuery({
    queryKey: straffbankKeys.assignments(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchPenaltyAssignments(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 20_000,
  });

  const earned = earnedQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];

  return {
    inventory: summarizeInventory(earned),
    totalAvailable: totalAvailable(earned),
    nextMilestone: nextMilestone(defsQ.data ?? [], currentStreak),
    sent: assignments.filter(
      (a) => a.status === 'active' && a.fromUserId === userId,
    ),
    received: assignments.filter(
      (a) => a.status === 'active' && a.toUserId === userId,
    ),
    isLoading: earnedQ.isLoading || defsQ.isLoading || assignmentsQ.isLoading,
    isError: earnedQ.isError || defsQ.isError || assignmentsQ.isError,
    refetch: () => {
      void earnedQ.refetch();
      void defsQ.refetch();
      void assignmentsQ.refetch();
    },
  };
}

/** Invalidate every Straffbank + challenge query after an assignment change. */
function invalidateStraffbank(
  queryClient: ReturnType<typeof useQueryClient>,
  challengeId: string,
  userId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ['straffbank'] });
  invalidateChallengeData(queryClient, challengeId, userId);
}

export function useAssignPenalty(challengeId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      earnedPenaltyId,
      toUserId,
    }: {
      earnedPenaltyId: string;
      toUserId: string;
    }) => assignPenalty(earnedPenaltyId, toUserId),
    onSuccess: () => invalidateStraffbank(queryClient, challengeId, userId),
  });
}

export function useCancelPenaltyAssignment(
  challengeId: string,
  userId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      reason,
    }: {
      assignmentId: string;
      reason: string;
    }) => cancelPenaltyAssignment(assignmentId, reason),
    onSuccess: () => invalidateStraffbank(queryClient, challengeId, userId),
  });
}
