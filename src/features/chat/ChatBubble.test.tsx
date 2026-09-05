import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  useChallengeDataMock,
  useAuthMock,
  useUnreadChatCountMock,
  useChatMessagesMock,
  useMarkChatReadMock,
  usePostChatMessageMock,
} = vi.hoisted(() => ({
  useChallengeDataMock: vi.fn<() => Record<string, unknown>>(),
  useAuthMock: vi.fn<() => Record<string, unknown>>(),
  useUnreadChatCountMock: vi.fn<() => Record<string, unknown>>(),
  useChatMessagesMock: vi.fn<() => Record<string, unknown>>(),
  useMarkChatReadMock: vi.fn<() => Record<string, unknown>>(),
  usePostChatMessageMock: vi.fn<() => Record<string, unknown>>(),
}));

vi.mock('@/features/challenge/useChallengeData', () => ({
  useChallengeData: () => useChallengeDataMock(),
}));
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => useAuthMock() }));
vi.mock('./useChat', () => ({
  chatKeys: {
    messages: (c: string) => ['chat', 'messages', c],
    unread: (c: string, u: string) => ['chat', 'unread', c, u],
    unreadRoot: (c: string) => ['chat', 'unread', c],
  },
  useUnreadChatCount: () => useUnreadChatCountMock(),
  useChatMessages: () => useChatMessagesMock(),
  useMarkChatRead: () => useMarkChatReadMock(),
  usePostChatMessage: () => usePostChatMessageMock(),
}));

import { ChatBubble } from './ChatBubble';

function wrap(node: ReactNode) {
  return render(<>{node}</>);
}

afterEach(() => vi.clearAllMocks());

const okQueryData = {
  data: {
    user: { id: 'u1' },
    challenge: { id: 'c1', timeZone: 'Europe/Stockholm' },
  },
};

function primeHooks(unread: number) {
  useChallengeDataMock.mockReturnValue(okQueryData);
  useAuthMock.mockReturnValue({ user: { id: 'u1' } });
  useUnreadChatCountMock.mockReturnValue({ data: unread });
  useChatMessagesMock.mockReturnValue({
    messages: [],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isLoading: false,
    isError: false,
  });
  useMarkChatReadMock.mockReturnValue({ mutate: vi.fn() });
  usePostChatMessageMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe('ChatBubble', () => {
  it('renders nothing when there is no challenge / user', () => {
    useChallengeDataMock.mockReturnValue({ data: null });
    useAuthMock.mockReturnValue({ user: null });
    useUnreadChatCountMock.mockReturnValue({ data: 0 });
    useChatMessagesMock.mockReturnValue({
      messages: [],
      fetchNextPage: vi.fn(),
    });
    useMarkChatReadMock.mockReturnValue({ mutate: vi.fn() });
    usePostChatMessageMock.mockReturnValue({ mutate: vi.fn() });
    const { container } = wrap(<ChatBubble />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the exact unread count on the trigger', () => {
    primeHooks(4);
    wrap(<ChatBubble />);
    expect(screen.getByRole('button', { name: /chatt/i })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('caps a large unread count for display without changing the trigger', () => {
    primeHooks(150);
    wrap(<ChatBubble />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows no badge at all when there is nothing unread', () => {
    primeHooks(0);
    wrap(<ChatBubble />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('opens the panel (a dialog) when clicked', async () => {
    primeHooks(1);
    const user = userEvent.setup();
    wrap(<ChatBubble />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /chatt/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
