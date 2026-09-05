import { useEffect, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
 * so neither API order nor Realtime arrival order is ever trusted.
 *
 * Realtime (spec §7): `useChatMessages` opens ONE Supabase channel per open
 * challenge id, subscribed to `public.chat_activity` — a no-secrets signal
 * table (`challenge_id`, `seq`, `at`) maintained by a trigger on
 * `chat_messages`. Realtime does NOT run on `chat_messages` itself, so a
 * moderated message's original body can never reach a client over the socket
 * (PR #3 finding I-1). The handler never becomes a second source of truth — it
 * only invalidates the message-list and unread query keys, so the displayed
 * list is always what TanStack Query holds, re-sorted by `seq`. An out-of-order
 * or dropped socket delivery is repaired by the next refetch, not trusted as
 * ordering. The channel is torn down on unmount / challenge change.
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
  const queryClient = useQueryClient();

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
    throwOnError: false,
  });

  useEffect(() => {
    if (challengeId === null) return;
    const channel = supabase
      .channel(`chat:${challengeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_activity',
          filter: `challenge_id=eq.${challengeId}`,
        },
        () => {
          // Signal only — refetch and re-sort by seq rather than trusting the
          // payload or its arrival order (spec §2.2 / §7). `chat_activity`
          // carries no message text, so nothing sensitive rides the socket.
          void queryClient.invalidateQueries({
            queryKey: chatKeys.messages(challengeId),
          });
          void queryClient.invalidateQueries({
            queryKey: chatKeys.unreadRoot(challengeId),
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [challengeId, queryClient]);

  const messages = useMemo(
    () => sortBySeq(query.data?.pages.flat() ?? []),
    [query.data],
  );

  return { ...query, messages };
}

/**
 * `userId` is kept in the signature and query key so the cached count is
 * per-signed-in-user (and to gate `enabled` until auth resolves); the count
 * itself is computed server-side from `auth.uid()`, so it is not passed to the
 * RPC.
 */
export function useUnreadChatCount(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: chatKeys.unread(challengeId ?? '', userId ?? ''),
    enabled: challengeId !== null && userId !== null,
    queryFn: () => {
      if (challengeId === null) {
        throw new Error('challengeId krävs.');
      }
      return fetchUnreadCount(challengeId);
    },
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
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
