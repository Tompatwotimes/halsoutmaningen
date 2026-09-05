import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.clearAllMocks());

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
