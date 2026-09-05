import { useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { sortBySeq } from './chat';
import {
  fetchOlderChatMessages,
  fetchRecentChatMessages,
  fetchUnreadCount,
  markChatRead,
  postChatMessage,
} from './chat-api';
import type { ChatMessage } from './types';

/**
 * TanStack Query bindings for shared chat.
 *
 * TanStack Query is the canonical client cache. `seq` is the only display
 * order — `useChatMessages` flattens every loaded page and re-sorts by `seq`,
 * so neither API order nor (later) Realtime arrival order is ever trusted.
 * Realtime is added in a later task as a subscription that only ever
 * invalidates/updates these same query keys; it does not change this hook's
 * public shape.
 */

const MESSAGES_ROOT = ['chat', 'messages'] as const;
const UNREAD_ROOT = ['chat', 'unread'] as const;

export const chatKeys = {
  messages: (challengeId: string) => [...MESSAGES_ROOT, challengeId] as const,
  unread: (challengeId: string, userId: string) =>
    [...UNREAD_ROOT, challengeId, userId] as const,
  unreadRoot: (challengeId: string) => [...UNREAD_ROOT, challengeId] as const,
};

const PAGE_SIZE = 50;

export function useChatMessages(challengeId: string | null) {
  const query = useInfiniteQuery({
    queryKey: chatKeys.messages(challengeId ?? ''),
    enabled: challengeId !== null,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }): Promise<ChatMessage[]> => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return pageParam == null
        ? fetchRecentChatMessages(challengeId, PAGE_SIZE)
        : fetchOlderChatMessages(challengeId, pageParam, PAGE_SIZE);
    },
    getNextPageParam: (lastPage): number | undefined =>
      lastPage.length === 0
        ? undefined
        : Math.min(...lastPage.map((m) => m.seq)),
    staleTime: 15_000,
    retry: false,
  });

  const messages = useMemo(
    () => sortBySeq(query.data?.pages.flat() ?? []),
    [query.data],
  );

  return { ...query, messages };
}

export function useUnreadChatCount(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: chatKeys.unread(challengeId ?? '', userId ?? ''),
    enabled: challengeId !== null && userId !== null,
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challengeId och userId krävs.');
      }
      return fetchUnreadCount(challengeId, userId);
    },
    staleTime: 15_000,
    retry: false,
  });
}

interface PostVars {
  challengeId: string;
  body: string;
}

/**
 * Use `.mutate()` (never `.mutateAsync()`) from a fire-and-forget caller —
 * `.mutate` never throws; a rejection lands in `isError`, not the call site.
 */
export function usePostChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: PostVars) =>
      postChatMessage(vars.challengeId, vars.body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(vars.challengeId),
      });
    },
  });
}

interface MarkReadVars {
  challengeId: string;
  seq: number;
}

export function useMarkChatRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: MarkReadVars) =>
      markChatRead(vars.challengeId, vars.seq),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.unreadRoot(vars.challengeId),
      });
    },
  });
}
