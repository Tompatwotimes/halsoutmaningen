import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from './types';

const { useChatMessagesMock, useMarkChatReadMock, usePostChatMessageMock } =
  vi.hoisted(() => ({
    useChatMessagesMock: vi.fn<() => Record<string, unknown>>(),
    useMarkChatReadMock: vi.fn<() => Record<string, unknown>>(),
    usePostChatMessageMock: vi.fn<() => Record<string, unknown>>(),
  }));

vi.mock('./useChat', () => ({
  useChatMessages: () => useChatMessagesMock(),
  useMarkChatRead: () => useMarkChatReadMock(),
  usePostChatMessage: () => usePostChatMessageMock(),
}));

import { ChatPanel } from './ChatPanel';

function row(seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${seq}`,
    seq,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u2',
    body: `body ${seq}`,
    status: 'active',
    hiddenReason: null,
    gameMasterEventId: null,
    createdAt: '2026-09-05T12:00:00Z',
    ...over,
  };
}

function wrap(node: ReactNode) {
  return render(<>{node}</>);
}

function prime(over: Partial<ReturnType<typeof buildQuery>> = {}): void {
  useChatMessagesMock.mockReturnValue({ ...buildQuery(), ...over });
  useMarkChatReadMock.mockReturnValue({ mutate: vi.fn() });
  usePostChatMessageMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function buildQuery() {
  return {
    messages: [] as ChatMessage[],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  };
}

afterEach(() => vi.clearAllMocks());

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  challengeId: 'c1',
  userId: 'u1',
  timeZone: 'Europe/Stockholm',
  isAdmin: false,
};

describe('ChatPanel', () => {
  it('renders messages in seq order (oldest first) trusting the hook, not its own sort', () => {
    prime({ messages: [row(9), row(7), row(8)] }); // deliberately unsorted-looking
    // the hook contract guarantees `messages` is seq-ascending; the panel
    // renders them in the order given.
    prime({ messages: [row(7), row(8), row(9)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const bodies = screen
      .getAllByTestId('chat-message-body')
      .map((n) => n.textContent);
    expect(bodies).toEqual(['body 7', 'body 8', 'body 9']);
  });

  it('renders the fixed placeholder for a hidden message, never its body', () => {
    prime({ messages: [row(3, { status: 'hidden', body: 'något fult' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
    expect(screen.queryByText('något fult')).not.toBeInTheDocument();
  });

  it('marks a Game Master message with a distinct GAME MASTER sender label', () => {
    prime({
      messages: [
        row(4, {
          senderType: 'game_master',
          senderUserId: null,
          body: 'Systemet observerar.',
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByText(/GAME MASTER/i)).toBeInTheDocument();
    expect(screen.getByText('Systemet observerar.')).toBeInTheDocument();
  });

  it('shows a date separator between messages on different challenge-local days', () => {
    prime({
      messages: [
        row(1, { createdAt: '2026-09-05T10:00:00Z' }), // 5th in Stockholm
        row(2, { createdAt: '2026-09-05T23:30:00Z' }), // already the 6th
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getAllByTestId('chat-date-separator')).toHaveLength(2);
  });

  it('disables send for an empty / whitespace / over-limit body', async () => {
    prime();
    const user = userEvent.setup({ delay: null });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const send = screen.getByRole('button', { name: /skicka/i });
    const input = screen.getByRole('textbox');

    expect(send).toBeDisabled();
    await user.type(input, '   ');
    expect(send).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'hej');
    expect(send).toBeEnabled();
  });

  it('renders an understated empty/error state inside the panel, not a page error', () => {
    prime({ isError: true });
    wrap(
      <>
        <div data-testid="sibling">host page content</div>
        <ChatPanel {...BASE_PROPS} />
      </>,
    );
    expect(screen.getByTestId('sibling')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    prime({ messages: [row(1)] });
    const { container } = wrap(<ChatPanel {...BASE_PROPS} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
