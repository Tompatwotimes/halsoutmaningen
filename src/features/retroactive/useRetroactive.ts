import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { invalidateChallengeData } from '@/features/challenge/useChallengeData';
import {
  approveRetroactiveRegistration,
  cancelRetroactiveRegistration,
  fetchApprovalPreview,
  fetchMyRetroactiveRequests,
  fetchRetroactiveRequestSessions,
  fetchRetroactiveRequestsForChallenge,
  rejectRetroactiveRegistration,
  submitRetroactiveRegistration,
  type SubmitRetroactiveInput,
} from './retroactive-api';

export const retroactiveKeys = {
  mine: (challengeId: string, userId: string) =>
    ['retroactive', 'mine', challengeId, userId] as const,
  queue: (challengeId: string) =>
    ['retroactive', 'queue', challengeId] as const,
  sessions: (requestId: string) =>
    ['retroactive', 'sessions', requestId] as const,
  preview: (requestId: string) =>
    ['retroactive', 'preview', requestId] as const,
};

function invalidateAll(
  queryClient: QueryClient,
  challengeId: string,
  userId: string,
) {
  invalidateChallengeData(queryClient, challengeId, userId);
  void queryClient.invalidateQueries({ queryKey: ['retroactive'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  void queryClient.invalidateQueries({ queryKey: ['straffbank'] });
}

/** The signed-in participant's own retroactive requests for a challenge. */
export function useMyRetroactiveRequests(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: retroactiveKeys.mine(challengeId ?? '', userId ?? ''),
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challengeId och userId krävs.');
      }
      return fetchMyRetroactiveRequests(challengeId, userId);
    },
    enabled: challengeId !== null && userId !== null,
    staleTime: 15_000,
  });
}

/** Admin: every request for a challenge, pending first / oldest first. */
export function useRetroactiveQueue(challengeId: string | null) {
  return useQuery({
    queryKey: retroactiveKeys.queue(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchRetroactiveRequestsForChallenge(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 15_000,
  });
}

export function useRetroactiveSessions(
  requestId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: retroactiveKeys.sessions(requestId ?? ''),
    queryFn: () => {
      if (requestId === null) throw new Error('requestId krävs.');
      return fetchRetroactiveRequestSessions(requestId);
    },
    enabled: enabled && requestId !== null,
    staleTime: 15_000,
  });
}

export function useApprovalPreview(requestId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: retroactiveKeys.preview(requestId ?? ''),
    queryFn: () => {
      if (requestId === null) throw new Error('requestId krävs.');
      return fetchApprovalPreview(requestId);
    },
    enabled: enabled && requestId !== null,
    staleTime: 0,
  });
}

export function useSubmitRetroactive(challengeId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitRetroactiveInput) =>
      submitRetroactiveRegistration(input),
    onSuccess: () => invalidateAll(queryClient, challengeId, userId),
  });
}

export function useCancelRetroactive(challengeId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelRetroactiveRegistration(requestId),
    onSuccess: () => invalidateAll(queryClient, challengeId, userId),
  });
}

export function useReviewRetroactive(challengeId: string) {
  const queryClient = useQueryClient();
  const invalidate = (targetUserId: string) =>
    invalidateAll(queryClient, challengeId, targetUserId);

  return {
    approve: useMutation({
      mutationFn: (args: {
        requestId: string;
        targetUserId: string;
        note: string | null;
      }) => approveRetroactiveRegistration(args.requestId, args.note),
      onSuccess: (_data, args) => invalidate(args.targetUserId),
    }),
    reject: useMutation({
      mutationFn: (args: {
        requestId: string;
        targetUserId: string;
        reason: string;
      }) => rejectRetroactiveRegistration(args.requestId, args.reason),
      onSuccess: (_data, args) => invalidate(args.targetUserId),
    }),
  };
}
