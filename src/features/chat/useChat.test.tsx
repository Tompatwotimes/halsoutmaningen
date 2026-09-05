import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage } from './types';

const {
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
  postChatMessage,
  markChatRead,
} = vi.hoisted(() => ({
  fetchRecentChatMessages: vi.fn(),
  fetchOlderChatMessages: vi.fn(),
  fetchUnreadCount: vi.fn(),
  postChatMessage: vi.fn(),
  markChatRead: vi.fn(),
}));

vi.mock('./chat-api', () => ({
  ChatError: class ChatError extends Error {},
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
  postChatMessage,
  markChatRead,
}));

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
  useChatMessages,
  useMarkChatRead,
  usePostChatMessage,
  useUnreadChatCount,
} from './useChat';

function row(seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u1',
    body: `body ${seq}`,
    status: 'active',
    hiddenReason: null,
    gameMasterEventId: null,
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
  it('opens exactly one INSERT channel scoped to the open challenge and tears it down on unmount', async () => {
    fetchRecentChatMessages.mockResolvedValue([row(1)]);
    const { result, unmount } = renderHook(() => useChatMessages('c1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages.length).toBe(1));

    expect(channelSpy).toHaveBeenCalledTimes(1);
    expect(channelSpy).toHaveBeenCalledWith('chat:c1');
    expect(lastChannel().filters).toEqual([
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'challenge_id=eq.c1',
      },
    ]);

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
  it('returns the count and is disabled without both ids', async () => {
    fetchUnreadCount.mockResolvedValue(4);
    const { result } = renderHook(() => useUnreadChatCount('c1', 'u1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(4));

    fetchUnreadCount.mockClear();
    renderHook(() => useUnreadChatCount('c1', null), { wrapper });
    expect(fetchUnreadCount).not.toHaveBeenCalled();
  });
});

describe('usePostChatMessage', () => {
  it('does not throw out of the caller when the post rejects', async () => {
    postChatMessage.mockRejectedValue(new Error('rate limit'));
    const { result } = renderHook(() => usePostChatMessage(), { wrapper });
    // .mutate is fire-and-forget — it must never throw synchronously or
    // produce an unhandled rejection.
    expect(() =>
      result.current.mutate({ challengeId: 'c1', body: 'x' }),
    ).not.toThrow();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('invalidates the message list on a successful post', async () => {
    postChatMessage.mockResolvedValue(row(5));
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostChatMessage(), {
      wrapper: localWrapper,
    });
    result.current.mutate({ challengeId: 'c1', body: 'x' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: chatKeys.messages('c1') });
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
