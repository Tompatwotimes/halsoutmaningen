import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InfiniteData } from '@tanstack/react-query';
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
  sendChatMessage,
  setChatMessageLike,
} from './chat-api';
import { chatImageSignedUrl } from './chat-media';
import { createProofSignedUrl } from '@/features/challenge/entries-api';
import type { UploadPhaseCallback } from '@/lib/media/image-processing';
import type { ChatMessage, TrainingCardProof } from './types';

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
  userId: string;
  body: string;
  /** 0–4 image files; the upload + atomic RPC happen inside the mutation. */
  files?: File[];
  /** Composer progress callback: `'processing'` then `'uploading'`. */
  onPhase?: UploadPhaseCallback;
  /**
   * Set only when this message is a reply — the id of the message being
   * replied to. Threaded straight through to `sendChatMessage`, which passes
   * `p_reply_to_message_id` to `post_chat_message` **only when present** so a
   * normal message keeps the exact old call shape (design §22.2).
   */
  replyToMessageId?: string;
}

/**
 * Use `.mutate()` (never `.mutateAsync()`) from a fire-and-forget caller —
 * `.mutate` never throws; a rejection lands in `isError`, not the call site.
 * The mutation covers image upload + the atomic `post_chat_message` RPC, and
 * cleans up uploaded objects if the RPC fails.
 */
export function usePostChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: PostVars) =>
      sendChatMessage({
        challengeId: vars.challengeId,
        userId: vars.userId,
        body: vars.body,
        files: vars.files ?? [],
        ...(vars.onPhase ? { onPhase: vars.onPhase } : {}),
        ...(vars.replyToMessageId
          ? { replyToMessageId: vars.replyToMessageId }
          : {}),
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(vars.challengeId),
      });
    },
  });
}

/**
 * Resolve short-lived signed URLs for one message's image attachments, only
 * when the bubble is actually rendered. The storage read policy
 * (`_chat_attachment_readable`) is the real gate: a hidden message's objects
 * return no URL (the query then yields `null` for that slot).
 */
export function useChatImageUrls(
  messageId: string,
  attachments: { position: number; path: string }[],
) {
  return useQuery({
    queryKey: ['chat', 'images', messageId, attachments.map((a) => a.path)],
    enabled: attachments.length > 0,
    queryFn: async () => {
      const out = await Promise.all(
        attachments.map(async (a) => ({
          position: a.position,
          url: await chatImageSignedUrl(a.path),
        })),
      );
      return out;
    },
    staleTime: 90_000,
    retry: false,
    throwOnError: false,
  });
}

/**
 * Resolve short-lived signed URLs for a training card's proof images, only when
 * the card is actually rendered. These objects live in the `proofs` bucket; the
 * bucket's SELECT policy already lets a challenge member read that challenge's
 * proof objects, and `list_chat_messages` only hands a member the paths for an
 * active card — so this mints no new access. A denied / failed path resolves to
 * `null` and the card shows a broken-image fallback for that slot.
 */
export function useTrainingCardProofUrls(
  entryId: string,
  proofs: TrainingCardProof[],
) {
  const paths = proofs.map((p) => p.path);
  return useQuery({
    queryKey: ['chat', 'trainingCardProofs', entryId, paths],
    enabled: proofs.length > 0,
    queryFn: () =>
      Promise.all(
        proofs.map(async (p) => ({
          position: p.position,
          url: await createProofSignedUrl(p.path).catch(() => null),
        })),
      ),
    staleTime: 90_000,
    retry: false,
    throwOnError: false,
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

// ---------------------------------------------------------------------------
// Likes data layer (design §18.1) — optimistic, desired-state heart mutation
// ---------------------------------------------------------------------------

/** The `useChatMessages` cache: pages of `seq`-descending `ChatMessage[]`. */
type ChatMessagesCache = InfiniteData<ChatMessage[], number | null>;

/**
 * Apply `transform` to the one message with `id === messageId` wherever it sits
 * in the infinite-query cache, preserving referential identity everywhere it is
 * not needed: the same `data` object when nothing changed, the same page array
 * for every untouched page, the same `ChatMessage` for every untouched message,
 * and always the same `pageParams`. `transform` returning its own argument
 * means "no change".
 */
function mapMessageInChatCache(
  data: ChatMessagesCache | undefined,
  messageId: string,
  transform: (m: ChatMessage) => ChatMessage,
): ChatMessagesCache | undefined {
  if (!data) return data;
  const pages = data.pages.map((page) => {
    const idx = page.findIndex((m) => m.id === messageId);
    const current = idx === -1 ? undefined : page[idx];
    if (current === undefined) return page;
    const replaced = transform(current);
    if (replaced === current) return page;
    const nextPage = page.slice();
    nextPage[idx] = replaced;
    return nextPage;
  });
  return pages.some((p, i) => p !== data.pages[i]) ? { ...data, pages } : data;
}

/**
 * The **state-aware** optimistic patch for a desired like state — NOT a blind
 * toggle. If the cached message is already in `desiredLiked` the count is left
 * untouched (a repeated / stale request cannot drift it); otherwise
 * `likedByMe := desiredLiked` and `likeCount` moves by exactly one, clamped at
 * 0. Only `likedByMe` / `likeCount` ever change.
 */
export function optimisticLikePatch(
  data: ChatMessagesCache | undefined,
  messageId: string,
  desiredLiked: boolean,
): ChatMessagesCache | undefined {
  return mapMessageInChatCache(data, messageId, (m) =>
    m.likedByMe === desiredLiked
      ? m
      : {
          ...m,
          likedByMe: desiredLiked,
          likeCount: desiredLiked
            ? m.likeCount + 1
            : Math.max(0, m.likeCount - 1),
        },
  );
}

/**
 * Reconcile a cached message to the server's **authoritative** `{ liked,
 * likeCount }`. The server always wins — the optimistic ±1 is only a guess and
 * another participant may have liked concurrently. Count clamped non-negative
 * (Task C's `jcount` already guarantees a non-negative integer; belt-and-braces).
 * Only `likedByMe` / `likeCount` change.
 */
export function reconcileLikeState(
  data: ChatMessagesCache | undefined,
  messageId: string,
  liked: boolean,
  likeCount: number,
): ChatMessagesCache | undefined {
  const count = Math.max(0, likeCount);
  return mapMessageInChatCache(data, messageId, (m) =>
    m.likedByMe === liked && m.likeCount === count
      ? m
      : { ...m, likedByMe: liked, likeCount: count },
  );
}

/** The desired end state for one message — idempotent, not a toggle. */
export interface SetChatMessageLikeVars {
  messageId: string;
  liked: boolean;
}

interface SetLikeContext {
  previous: ChatMessagesCache | undefined;
}

/**
 * Heart-like data layer. The UI calls `setLike({ messageId, liked })` with the
 * DESIRED end state; the messages cache updates immediately (state-aware — a
 * repeat is a no-op), the idempotent `set_chat_message_like` RPC runs, and its
 * authoritative `{ liked, like_count }` reconciles the cache. A server error
 * rolls the cache back to an exact snapshot (never by arithmetic).
 *
 * A per-message in-flight guard drops a second `setLike` for the SAME message
 * while one is running, so out-of-order responses cannot leave ambiguous state;
 * DIFFERENT messages are unaffected. `isPending(messageId)` exposes that state
 * for the future button. No optimistic-only surface and no toast — read errors
 * from `error` / clear them with `reset()`.
 *
 * Realtime is untouched: the server bumps `chat_activity` on a real change, so
 * `useChatMessages` still invalidates + refetches `list_chat_messages`; the
 * optimistic patch, the success reconcile and that refetch all converge on the
 * same authoritative value. The hook adds no invalidation of its own. Mutations
 * do not retry (`retry: false`) so the guard tracks exactly one attempt.
 */
export function useSetChatMessageLike(challengeId: string | null) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const key = chatKeys.messages(challengeId ?? '');

  const mutation = useMutation<
    { liked: boolean; likeCount: number },
    unknown,
    SetChatMessageLikeVars,
    SetLikeContext
  >({
    mutationFn: ({ messageId, liked }) => setChatMessageLike(messageId, liked),
    onMutate: async ({ messageId, liked }) => {
      // Stop any in-flight list refetch from landing between the optimistic
      // patch and the reconcile and clobbering local state.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatMessagesCache>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<ChatMessagesCache>(
          key,
          optimisticLikePatch(previous, messageId, liked),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Exact snapshot restore — never reverse by arithmetic (a concurrent
      // Realtime refetch may have changed the cache in between).
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSuccess: (result, { messageId }) => {
      const current = queryClient.getQueryData<ChatMessagesCache>(key);
      if (current !== undefined) {
        queryClient.setQueryData<ChatMessagesCache>(
          key,
          reconcileLikeState(
            current,
            messageId,
            result.liked,
            result.likeCount,
          ),
        );
      }
    },
    onSettled: (_data, _err, { messageId }) => {
      inFlight.current.delete(messageId);
      bump();
    },
    retry: false,
  });

  const { mutate, error, reset } = mutation;

  const setLike = useCallback(
    (vars: SetChatMessageLikeVars) => {
      if (challengeId === null) return;
      if (inFlight.current.has(vars.messageId)) return; // per-message guard
      inFlight.current.add(vars.messageId); // claim synchronously
      bump();
      mutate(vars);
    },
    [challengeId, mutate, bump],
  );

  const isPending = useCallback(
    (messageId: string): boolean => inFlight.current.has(messageId),
    [],
  );

  return { setLike, isPending, error, reset };
}
