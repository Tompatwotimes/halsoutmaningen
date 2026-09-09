import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { InfiniteData } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage } from './types';

const {
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
  sendChatMessage,
  markChatRead,
  setChatMessageLike,
} = vi.hoisted(() => ({
  fetchRecentChatMessages: vi.fn(),
  fetchOlderChatMessages: vi.fn(),
  fetchUnreadCount: vi.fn(),
  sendChatMessage: vi.fn(),
  markChatRead: vi.fn(),
  setChatMessageLike: vi.fn(),
}));

vi.mock('./chat-api', () => ({
  ChatError: class ChatError extends Error {},
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
  sendChatMessage,
  markChatRead,
  setChatMessageLike,
}));

vi.mock('./chat-media', () => ({
  chatImageSignedUrl: vi.fn().mockResolvedValue(null),
}));

const { createProofSignedUrl } = vi.hoisted(() => ({
  createProofSignedUrl: vi.fn(),
}));
vi.mock('@/features/challenge/entries-api', () => ({ createProofSignedUrl }));

/**
 * A minimal fake of the Supabase Realtime surface `useChatMessages` touches:
 * `supabase.channel(name).on(event, filter, handler).subscribe()` and
 * `supabase.removeChannel(channel)`. Each `.on()` call's filter + handler are
 * captured so a test can fire a synthetic INSERT.
 */
interface FakeChannel {
  name: string;
  filters: Record<string, unknown>[];
  handlers: (() => void)[];
  on: (
    event: string,
    filter: Record<string, unknown>,
    handler: () => void,
  ) => FakeChannel;
  subscribe: () => FakeChannel;
}

const { channelSpy, removeChannelSpy, channels } = vi.hoisted(() => ({
  channelSpy: vi.fn(),
  removeChannelSpy: vi.fn(),
  channels: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string): FakeChannel => {
      const ch: FakeChannel = {
        name,
        filters: [],
        handlers: [],
        on: (_event, filter, handler) => {
          ch.filters.push(filter);
          ch.handlers.push(handler);
          return ch;
        },
        subscribe: () => ch,
      };
      channelSpy(name);
      channels.push(ch);
      return ch;
    },
    removeChannel: (ch: unknown) => {
      removeChannelSpy(ch);
      return Promise.resolve('ok');
    },
  },
}));

function lastChannel(): FakeChannel {
  return channels[channels.length - 1] as FakeChannel;
}

function emitInsert(ch: FakeChannel): void {
  for (const handler of ch.handlers) handler();
}

import {
  chatKeys,
  optimisticLikePatch,
  reconcileLikeState,
  useChatMessages,
  useMarkChatRead,
  usePostChatMessage,
  useSetChatMessageLike,
  useTrainingCardProofUrls,
  useUnreadChatCount,
} from './useChat';

function row(seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u1',
    senderDisplayName: 'Pia',
    body: `body ${seq}`,
    status: 'active',
    attachments: [],
    trainingCard: null,
    hiddenReason: null,
    gameMasterEventId: null,
    replyToMessageId: null,
    replyPreview: null,
    likeCount: 0,
    likedByMe: false,
    createdAt: '2026-09-05T12:00:00Z',
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// `beforeEach`, not `afterEach`: Testing Library's auto-`cleanup()` unmounts the
// previous test's hook during the afterEach phase — after a file-local
// `afterEach` would already have run — and that unmount calls `removeChannel`.
// Clearing here, before the next test, keeps the Realtime spy counts honest.
beforeEach(() => {
  vi.clearAllMocks();
  channels.length = 0;
});

describe('useChatMessages', () => {
  it('flattens pages and presents them sorted ascending by seq (not API order)', async () => {
    // API returns the newest page seq-descending.
    fetchRecentChatMessages.mockResolvedValue([row(9), row(7), row(8)]);
    const { result } = renderHook(() => useChatMessages('c1'), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBe(3));
    expect(result.current.messages.map((m) => m.seq)).toEqual([7, 8, 9]);
  });

  it('does not fetch when challengeId is null', () => {
    renderHook(() => useChatMessages(null), { wrapper });
    expect(fetchRecentChatMessages).not.toHaveBeenCalled();
  });

  it('fetches the older page using the oldest currently-loaded seq as the cursor', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(20), row(19), row(18)]);
    fetchOlderChatMessages.mockResolvedValue([row(17), row(16)]);
    const { result } = renderHook(() => useChatMessages('c1'), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBe(3));

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.messages.length).toBe(5));

    expect(fetchOlderChatMessages).toHaveBeenCalledWith(
      'c1',
      18,
      expect.any(Number),
    );
    expect(result.current.messages.map((m) => m.seq)).toEqual([
      16, 17, 18, 19, 20,
    ]);
  });

  it('stops paginating when an older page comes back empty', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(2), row(1)]);
    fetchOlderChatMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useChatMessages('c1'), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBe(2));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});

describe('useChatMessages — Realtime', () => {
  it('subscribes to the no-secrets chat_activity signal table, not chat_messages, and tears it down on unmount', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(1)]);
    const { result, unmount } = renderHook(() => useChatMessages('c1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages.length).toBe(1));

    expect(channelSpy).toHaveBeenCalledTimes(1);
    expect(channelSpy).toHaveBeenCalledWith('chat:c1');
    expect(lastChannel().filters).toEqual([
      {
        event: '*',
        schema: 'public',
        table: 'chat_activity',
        filter: 'challenge_id=eq.c1',
      },
    ]);
    // Never chat_messages — a moderated body must not ride the socket (I-1).
    expect(lastChannel().filters.some((f) => f.table === 'chat_messages')).toBe(
      false,
    );

    unmount();
    expect(removeChannelSpy).toHaveBeenCalledTimes(1);
  });

  it('does not open a channel when challengeId is null', () => {
    renderHook(() => useChatMessages(null), { wrapper });
    expect(channelSpy).not.toHaveBeenCalled();
  });

  it('reflects a message delivered over Realtime after invalidation', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(1)]);
    const { result } = renderHook(() => useChatMessages('c1'), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBe(1));

    // A new row is now visible to a refetch; the socket only nudges the cache.
    fetchRecentChatMessages.mockResolvedValue([row(2), row(1)]);
    emitInsert(lastChannel());

    await waitFor(() => expect(result.current.messages.length).toBe(2));
    expect(result.current.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('keeps the list seq-ascending regardless of Realtime arrival order', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(7)]);
    const { result } = renderHook(() => useChatMessages('c1'), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBe(1));

    // Two INSERT events fire; the higher-seq row's event arrives first. The
    // handler ignores the payload entirely and refetches — the refetch result
    // (in any order) is re-sorted by seq.
    fetchRecentChatMessages.mockResolvedValue([row(9), row(7), row(8)]);
    emitInsert(lastChannel()); // "seq 9 arrived"
    emitInsert(lastChannel()); // "seq 8 arrived"

    await waitFor(() => expect(result.current.messages.length).toBe(3));
    expect(result.current.messages.map((m) => m.seq)).toEqual([7, 8, 9]);
  });
});

describe('useUnreadChatCount', () => {
  it('returns the count, is disabled without both ids, and passes only the challenge id', async () => {
    fetchUnreadCount.mockResolvedValue(4);
    const { result } = renderHook(() => useUnreadChatCount('c1', 'u1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(4));
    // The count is computed server-side from auth.uid(); userId is a cache-key
    // concern only and must not be sent to the RPC layer.
    expect(fetchUnreadCount).toHaveBeenCalledWith('c1');

    fetchUnreadCount.mockClear();
    renderHook(() => useUnreadChatCount('c1', null), { wrapper });
    expect(fetchUnreadCount).not.toHaveBeenCalled();
  });
});

describe('usePostChatMessage', () => {
  it('does not throw out of the caller when the post rejects', async () => {
    sendChatMessage.mockRejectedValue(new Error('rate limit'));
    const { result } = renderHook(() => usePostChatMessage(), { wrapper });
    // .mutate is fire-and-forget — it must never throw synchronously or
    // produce an unhandled rejection.
    expect(() =>
      result.current.mutate({ challengeId: 'c1', userId: 'u1', body: 'x' }),
    ).not.toThrow();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('invalidates the message list on a successful post', async () => {
    sendChatMessage.mockResolvedValue(row(5));
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostChatMessage(), {
      wrapper: localWrapper,
    });
    result.current.mutate({ challengeId: 'c1', userId: 'u1', body: 'x' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: chatKeys.messages('c1') });
  });

  it('forwards image files to sendChatMessage', async () => {
    sendChatMessage.mockResolvedValue(row(6));
    const { result } = renderHook(() => usePostChatMessage(), { wrapper });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    result.current.mutate({
      challengeId: 'c1',
      userId: 'u1',
      body: '',
      files: [file],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ files: [file], userId: 'u1' }),
    );
  });

  it('forwards the onPhase progress callback to sendChatMessage', async () => {
    sendChatMessage.mockResolvedValue(row(7));
    const { result } = renderHook(() => usePostChatMessage(), { wrapper });
    const onPhase = vi.fn();
    result.current.mutate({
      challengeId: 'c1',
      userId: 'u1',
      body: '',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
      onPhase,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ onPhase }),
    );
  });
});

describe('useMarkChatRead', () => {
  it('invalidates the unread count on success', async () => {
    markChatRead.mockResolvedValue(undefined);
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMarkChatRead(), {
      wrapper: localWrapper,
    });
    result.current.mutate({ challengeId: 'c1', seq: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({
      queryKey: chatKeys.unreadRoot('c1'),
    });
  });
});

describe('useTrainingCardProofUrls', () => {
  beforeEach(() => {
    createProofSignedUrl.mockReset();
  });

  it('is disabled and fetches nothing when the card has no proofs', () => {
    const { result } = renderHook(() => useTrainingCardProofUrls('e1', []), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(createProofSignedUrl).not.toHaveBeenCalled();
  });

  it('resolves a signed proofs-bucket URL per proof, in position order', async () => {
    createProofSignedUrl.mockImplementation((p: string) =>
      Promise.resolve(`signed:${p}`),
    );
    const { result } = renderHook(
      () =>
        useTrainingCardProofUrls('e1', [
          { position: 1, path: 'c/u/d/1-a.jpg' },
          { position: 2, path: 'c/u/d/2-b.jpg' },
        ]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { position: 1, url: 'signed:c/u/d/1-a.jpg' },
      { position: 2, url: 'signed:c/u/d/2-b.jpg' },
    ]);
  });

  it('yields null for a denied path instead of rejecting the whole query', async () => {
    createProofSignedUrl.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(
      () =>
        useTrainingCardProofUrls('e1', [
          { position: 1, path: 'c/u/d/1-a.jpg' },
        ]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ position: 1, url: null }]);
  });
});

// ---------------------------------------------------------------------------
// Task D — likes data layer. Optimistic desired-state heart mutation.
// ---------------------------------------------------------------------------

type ChatCache = InfiniteData<ChatMessage[], number | null>;

function cache(pages: ChatMessage[][]): ChatCache {
  return {
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? null : 100 - i)),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('optimisticLikePatch (pure)', () => {
  it('returns the same reference when the cache is undefined', () => {
    expect(optimisticLikePatch(undefined, 'm1', true)).toBeUndefined();
  });

  it('flips likedByMe false→true and bumps likeCount by exactly one', () => {
    const before = cache([[row(1, { likeCount: 2, likedByMe: false })]]);
    const after = optimisticLikePatch(before, 'm1', true)!;
    expect(after.pages[0]![0]!.likedByMe).toBe(true);
    expect(after.pages[0]![0]!.likeCount).toBe(3);
  });

  it('flips likedByMe true→false and drops likeCount by exactly one', () => {
    const before = cache([[row(1, { likeCount: 5, likedByMe: true })]]);
    const after = optimisticLikePatch(before, 'm1', false)!;
    expect(after.pages[0]![0]!.likedByMe).toBe(false);
    expect(after.pages[0]![0]!.likeCount).toBe(4);
  });

  it('does NOT increment when the message is already in the desired liked state', () => {
    const before = cache([[row(1, { likeCount: 5, likedByMe: true })]]);
    const after = optimisticLikePatch(before, 'm1', true)!;
    expect(after.pages[0]![0]!.likedByMe).toBe(true);
    expect(after.pages[0]![0]!.likeCount).toBe(5);
    expect(after).toBe(before); // nothing changed → same reference
  });

  it('does NOT decrement when the message is already unliked', () => {
    const before = cache([[row(1, { likeCount: 4, likedByMe: false })]]);
    const after = optimisticLikePatch(before, 'm1', false)!;
    expect(after.pages[0]![0]!.likeCount).toBe(4);
    expect(after).toBe(before);
  });

  it('never produces a negative likeCount', () => {
    const before = cache([[row(1, { likeCount: 0, likedByMe: true })]]);
    const after = optimisticLikePatch(before, 'm1', false)!;
    expect(after.pages[0]![0]!.likeCount).toBe(0);
  });

  it('touches only likedByMe / likeCount — every other field is preserved', () => {
    const original = row(1, {
      likeCount: 1,
      likedByMe: false,
      body: 'behåll mig',
      replyPreview: {
        deleted: false,
        messageId: 'p',
        seq: 1,
        senderType: 'participant',
        senderUserId: 'u9',
        senderDisplayName: 'Anna',
        kind: 'text',
        text: 'förälder',
        hasImage: false,
        training: null,
      },
      trainingCard: null,
      attachments: [{ position: 1, path: 'c/u/m/1.jpg' }],
    });
    const after = optimisticLikePatch(cache([[original]]), 'm1', true)!;
    const patched = after.pages[0]![0]!;
    expect(patched.body).toBe('behåll mig');
    expect(patched.seq).toBe(original.seq);
    expect(patched.status).toBe(original.status);
    expect(patched.createdAt).toBe(original.createdAt);
    expect(patched.replyPreview).toBe(original.replyPreview);
    expect(patched.attachments).toBe(original.attachments);
    expect(patched.senderDisplayName).toBe(original.senderDisplayName);
  });

  it('patches the target across pages and leaves other messages / pages / pageParams by reference', () => {
    const a = row(1, { likeCount: 0 });
    const b = row(2, { likeCount: 0 });
    const c = row(3, { likeCount: 4, likedByMe: false });
    const d = row(4, { likeCount: 0 });
    const before = cache([
      [a, b],
      [c, d],
    ]);
    const after = optimisticLikePatch(before, 'm3', true)!;
    expect(after.pages[0]).toBe(before.pages[0]); // page 1 untouched by reference
    expect(after.pages[0]![0]).toBe(a);
    expect(after.pages[0]![1]).toBe(b);
    expect(after.pages[1]![1]).toBe(d); // sibling untouched
    expect(after.pages[1]![0]!.likeCount).toBe(5); // c updated
    expect(after.pages[1]![0]!.likedByMe).toBe(true);
    expect(after.pageParams).toBe(before.pageParams); // pagination cursors untouched
  });

  it('is a no-op when the target message is not in the cache', () => {
    const before = cache([[row(1)]]);
    expect(optimisticLikePatch(before, 'missing', true)).toBe(before);
  });
});

describe('reconcileLikeState (pure)', () => {
  it('sets the authoritative liked + count from the server', () => {
    const before = cache([[row(1, { likeCount: 2, likedByMe: false })]]);
    const after = reconcileLikeState(before, 'm1', true, 7)!;
    expect(after.pages[0]![0]!.likedByMe).toBe(true);
    expect(after.pages[0]![0]!.likeCount).toBe(7);
  });

  it('lets the server count win even when it differs from the optimistic guess', () => {
    // optimistic put it at 5; another participant liked → server says 7
    const optimistic = cache([[row(1, { likeCount: 5, likedByMe: true })]]);
    const after = reconcileLikeState(optimistic, 'm1', true, 7)!;
    expect(after.pages[0]![0]!.likeCount).toBe(7);
  });

  it('clamps a bogus negative server count to 0', () => {
    const before = cache([[row(1, { likeCount: 3 })]]);
    const after = reconcileLikeState(before, 'm1', false, -1)!;
    expect(after.pages[0]![0]!.likeCount).toBe(0);
  });

  it('returns the same reference when nothing needs to change', () => {
    const before = cache([[row(1, { likeCount: 3, likedByMe: true })]]);
    expect(reconcileLikeState(before, 'm1', true, 3)).toBe(before);
  });

  it('does not crash on an undefined cache or a missing message', () => {
    expect(reconcileLikeState(undefined, 'm1', true, 1)).toBeUndefined();
    expect(
      reconcileLikeState(cache([[row(1)]]), 'gone', true, 1)!.pages[0]![0]!.id,
    ).toBe('m1');
  });
});

describe('useSetChatMessageLike', () => {
  function makeClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  }
  function withClient(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  it('optimistically flips likedByMe and bumps the count before the server responds', async () => {
    const d = deferred<{ liked: boolean; likeCount: number }>();
    setChatMessageLike.mockReturnValueOnce(d.promise);
    const client = makeClient();
    client.setQueryData(
      chatKeys.messages('c1'),
      cache([[row(1, { likeCount: 2, likedByMe: false })]]),
    );
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'm1', liked: true }));

    await waitFor(() => {
      const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
      expect(c.pages[0]![0]!.likedByMe).toBe(true);
      expect(c.pages[0]![0]!.likeCount).toBe(3);
    });
    expect(setChatMessageLike).toHaveBeenCalledWith('m1', true);

    await act(async () => {
      d.resolve({ liked: true, likeCount: 3 });
      await d.promise;
    });
  });

  it('reconciles to the authoritative server count on success', async () => {
    setChatMessageLike.mockResolvedValueOnce({ liked: true, likeCount: 9 });
    const client = makeClient();
    client.setQueryData(
      chatKeys.messages('c1'),
      cache([[row(1, { likeCount: 2, likedByMe: false })]]),
    );
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'm1', liked: true }));

    await waitFor(() => {
      const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
      expect(c.pages[0]![0]!.likeCount).toBe(9);
      expect(c.pages[0]![0]!.likedByMe).toBe(true);
    });
  });

  it('rolls the cache back to the exact snapshot on a server error', async () => {
    class ChatError extends Error {}
    setChatMessageLike.mockRejectedValueOnce(
      new ChatError('Det går inte att gilla ett dolt meddelande'),
    );
    const client = makeClient();
    const before = cache([[row(1, { likeCount: 4, likedByMe: false })]]);
    client.setQueryData(chatKeys.messages('c1'), before);
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'm1', liked: true }));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    const after = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
    expect(after.pages[0]![0]!.likeCount).toBe(4);
    expect(after.pages[0]![0]!.likedByMe).toBe(false);
    expect((result.current.error as Error).message).toBe(
      'Det går inte att gilla ett dolt meddelande',
    );
  });

  it('drops a second setLike for the SAME message while the first is in flight', async () => {
    const d = deferred<{ liked: boolean; likeCount: number }>();
    setChatMessageLike.mockReturnValueOnce(d.promise);
    const client = makeClient();
    client.setQueryData(
      chatKeys.messages('c1'),
      cache([[row(1, { likeCount: 2, likedByMe: false })]]),
    );
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => {
      result.current.setLike({ messageId: 'm1', liked: true });
      result.current.setLike({ messageId: 'm1', liked: false }); // blocked
    });

    expect(result.current.isPending('m1')).toBe(true);
    await waitFor(() => expect(setChatMessageLike).toHaveBeenCalledTimes(1));
    expect(setChatMessageLike).toHaveBeenCalledWith('m1', true);

    await act(async () => {
      d.resolve({ liked: true, likeCount: 3 });
      await d.promise;
    });
    await waitFor(() => expect(result.current.isPending('m1')).toBe(false));

    // after settle the same message can be mutated again
    setChatMessageLike.mockResolvedValueOnce({ liked: false, likeCount: 2 });
    act(() => result.current.setLike({ messageId: 'm1', liked: false }));
    await waitFor(() => expect(setChatMessageLike).toHaveBeenCalledTimes(2));
  });

  it('allows two DIFFERENT messages to mutate concurrently', async () => {
    const dA = deferred<{ liked: boolean; likeCount: number }>();
    const dB = deferred<{ liked: boolean; likeCount: number }>();
    setChatMessageLike
      .mockReturnValueOnce(dA.promise)
      .mockReturnValueOnce(dB.promise);
    const client = makeClient();
    client.setQueryData(
      chatKeys.messages('c1'),
      cache([[row(1, { likeCount: 0 }), row(2, { likeCount: 0 })]]),
    );
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => {
      result.current.setLike({ messageId: 'm1', liked: true });
      result.current.setLike({ messageId: 'm2', liked: true });
    });

    expect(result.current.isPending('m1')).toBe(true);
    expect(result.current.isPending('m2')).toBe(true);
    await waitFor(() => expect(setChatMessageLike).toHaveBeenCalledTimes(2));

    await act(async () => {
      dA.resolve({ liked: true, likeCount: 1 });
      dB.resolve({ liked: true, likeCount: 1 });
      await Promise.all([dA.promise, dB.promise]);
    });
    await waitFor(() => {
      expect(result.current.isPending('m1')).toBe(false);
      expect(result.current.isPending('m2')).toBe(false);
    });
    const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
    expect(c.pages[0]!.map((m) => m.likeCount)).toEqual([1, 1]);
  });

  it('clears the in-flight guard after an error so the message can be retried', async () => {
    class ChatError extends Error {}
    setChatMessageLike.mockRejectedValueOnce(new ChatError('nätverk'));
    const client = makeClient();
    client.setQueryData(chatKeys.messages('c1'), cache([[row(1)]]));
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'm1', liked: true }));
    await waitFor(() => expect(result.current.isPending('m1')).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);

    setChatMessageLike.mockResolvedValueOnce({ liked: true, likeCount: 1 });
    act(() => result.current.setLike({ messageId: 'm1', liked: true }));
    await waitFor(() => expect(setChatMessageLike).toHaveBeenCalledTimes(2));
  });

  it('does not crash when the target message is not in the loaded cache', async () => {
    setChatMessageLike.mockResolvedValueOnce({ liked: true, likeCount: 1 });
    const client = makeClient();
    client.setQueryData(chatKeys.messages('c1'), cache([[row(1)]]));
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'not-loaded', liked: true }));
    await waitFor(() =>
      expect(setChatMessageLike).toHaveBeenCalledWith('not-loaded', true),
    );
    // the timeline is untouched and no phantom message appears
    const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
    expect(c.pages[0]!.map((m) => m.id)).toEqual(['m1']);
  });

  it('does not crash when there is no messages cache at all', async () => {
    setChatMessageLike.mockResolvedValueOnce({ liked: true, likeCount: 1 });
    const client = makeClient();
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });
    act(() => result.current.setLike({ messageId: 'm1', liked: true }));
    await waitFor(() =>
      expect(setChatMessageLike).toHaveBeenCalledWith('m1', true),
    );
    expect(client.getQueryData(chatKeys.messages('c1'))).toBeUndefined();
  });

  it('does nothing (no server call) when challengeId is null', () => {
    const client = makeClient();
    const { result } = renderHook(() => useSetChatMessageLike(null), {
      wrapper: withClient(client),
    });
    act(() => result.current.setLike({ messageId: 'm1', liked: true }));
    expect(setChatMessageLike).not.toHaveBeenCalled();
  });

  it('does not touch seq / status / unread on an optimistic like', async () => {
    const d = deferred<{ liked: boolean; likeCount: number }>();
    setChatMessageLike.mockReturnValueOnce(d.promise);
    const client = makeClient();
    const before = cache([
      [row(1, { seq: 42, status: 'active', likeCount: 1 })],
    ]);
    client.setQueryData(chatKeys.messages('c1'), before);
    client.setQueryData(chatKeys.unreadRoot('c1'), 3);
    const { result } = renderHook(() => useSetChatMessageLike('c1'), {
      wrapper: withClient(client),
    });

    act(() => result.current.setLike({ messageId: 'm1', liked: true }));
    await waitFor(() => {
      const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
      expect(c.pages[0]![0]!.likeCount).toBe(2);
    });
    const c = client.getQueryData<ChatCache>(chatKeys.messages('c1'))!;
    expect(c.pages[0]![0]!.seq).toBe(42);
    expect(c.pages[0]![0]!.status).toBe('active');
    // unread cache is untouched by the like mutation
    expect(client.getQueryData(chatKeys.unreadRoot('c1'))).toBe(3);

    await act(async () => {
      d.resolve({ liked: true, likeCount: 2 });
      await d.promise;
    });
  });
});
