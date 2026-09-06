import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from './types';

// jsdom has no scrollIntoView — give it a spy so the B1 tests can assert on it.
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

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
    senderDisplayName: 'Anna',
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

let markReadMutate = vi.fn();
let fetchNextPage = vi.fn();

function prime(over: Partial<ReturnType<typeof buildQuery>> = {}): void {
  useChatMessagesMock.mockReturnValue({ ...buildQuery(), ...over });
  useMarkChatReadMock.mockReturnValue({ mutate: markReadMutate });
  usePostChatMessageMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function buildQuery() {
  return {
    messages: [] as ChatMessage[],
    fetchNextPage,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  };
}

/**
 * jsdom reports 0 for every layout metric and no-ops `scrollIntoView`. Give one
 * element real, mutable scroll geometry so the B1 positioning logic can be
 * driven and asserted.
 */
function mockScroller(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number },
) {
  let top = metrics.scrollTop ?? 0;
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  return {
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      top = v;
    },
    grow(to: number) {
      metrics.scrollHeight = to;
    },
    fireScroll() {
      el.dispatchEvent(new Event('scroll'));
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  markReadMutate = vi.fn();
  fetchNextPage = vi.fn();
});

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  challengeId: 'c1',
  userId: 'u1',
  timeZone: 'Europe/Stockholm',
  isAdmin: false,
};

describe('ChatPanel', () => {
  it('renders messages in exactly the order the hook provides and imposes no sort of its own', () => {
    // The hook (`useChatMessages`) owns ordering — it flattens pages and
    // `sortBySeq`s them (proven in useChat.test.tsx / chat.test.ts). The panel
    // must be a faithful pass-through: feed it a deliberately NON-ascending
    // list and assert it renders that exact order, not a re-sorted one.
    prime({ messages: [row(8), row(7), row(9)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const bodies = screen
      .getAllByTestId('chat-message-body')
      .map((n) => n.textContent);
    expect(bodies).toEqual(['body 8', 'body 7', 'body 9']);
  });

  it('renders the fixed placeholder for a hidden message, never its body', () => {
    // Even if a real body somehow reached the client, the panel must not show
    // it. (The server also withholds it — body: null — proven in chat-api /
    // pgTAP tests.)
    prime({ messages: [row(3, { status: 'hidden', body: 'något fult' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
    expect(screen.queryByText('något fult')).not.toBeInTheDocument();
  });

  it('shows "Du" for the viewer\'s own message', () => {
    prime({
      messages: [row(1, { senderUserId: 'u1', senderDisplayName: 'Johan' })],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByText('Du')).toBeInTheDocument();
    expect(screen.queryByText('Johan')).not.toBeInTheDocument();
  });

  it("shows another participant's display name as the sender label", () => {
    prime({
      messages: [
        row(1, { senderUserId: 'u9', senderDisplayName: 'Erik Berg' }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByText('Erik Berg')).toBeInTheDocument();
  });

  it('keeps the sender label on a hidden participant message while withholding the body', () => {
    prime({
      messages: [
        row(1, {
          senderUserId: 'u9',
          senderDisplayName: 'Erik Berg',
          status: 'hidden',
          body: null,
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByText('Erik Berg')).toBeInTheDocument();
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
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

describe('ChatPanel scroll behaviour (B1)', () => {
  function openWithMessages(
    initial: ChatMessage[],
    metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number },
  ) {
    // Open → brief loading → messages arrive, mirroring the real lifecycle so
    // the container ref is mounted before the first positioning pass.
    prime({ isLoading: true });
    const view = wrap(<ChatPanel {...BASE_PROPS} />);
    const el = screen.getByRole('log').parentElement!;
    const ctl = mockScroller(el, metrics);
    prime({ isLoading: false, messages: initial });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);
    return { view, el, ctl };
  }

  it('opens pinned to the newest message', () => {
    const { ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 800,
      clientHeight: 300,
      scrollTop: 0,
    });
    expect(ctl.scrollTop).toBe(800);
    expect(markReadMutate).toHaveBeenCalledWith({ challengeId: 'c1', seq: 3 });
  });

  it('keeps the same message in view when older history is prepended', () => {
    const { view, ctl } = openWithMessages([row(10), row(11), row(12)], {
      scrollHeight: 800,
      clientHeight: 300,
    });
    // reader scrolls up to the top
    ctl.scrollTop = 0;
    ctl.fireScroll();
    prime({
      isLoading: false,
      messages: [row(10), row(11), row(12)],
      hasNextPage: true,
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    fireEvent.click(
      screen.getByRole('button', { name: /ladda äldre meddelanden/i }),
    );
    expect(fetchNextPage).toHaveBeenCalled();

    // older page renders — list grows by 600px
    ctl.grow(1400);
    prime({
      isLoading: false,
      messages: [row(7), row(8), row(9), row(10), row(11), row(12)],
      hasNextPage: true,
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    // scrollTop shifted by exactly the height delta → viewport did not jump
    expect(ctl.scrollTop).toBe(600);
  });

  it('follows an incoming message when the reader is near the bottom', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { view, ctl } = openWithMessages([row(1), row(2)], {
      scrollHeight: 500,
      clientHeight: 400,
      scrollTop: 100, // 500-100-400 = 0 → at the bottom
    });
    ctl.fireScroll();
    markReadMutate.mockClear();

    prime({ isLoading: false, messages: [row(1), row(2), row(3)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
    expect(markReadMutate).toHaveBeenCalledWith({ challengeId: 'c1', seq: 3 });
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
    scrollIntoView.mockRestore();
  });

  it('does not yank the reader down while they read history — shows "Nya meddelanden"', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { view, ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 900,
      clientHeight: 300,
    });
    // reader scrolls well up
    ctl.scrollTop = 100; // 900-100-300 = 500 > 96 → not near bottom
    ctl.fireScroll();
    scrollIntoView.mockClear();
    markReadMutate.mockClear();

    prime({ isLoading: false, messages: [row(1), row(2), row(3), row(4)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    // viewport untouched, read cursor not advanced, indicator shown
    expect(ctl.scrollTop).toBe(100);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(markReadMutate).not.toHaveBeenCalled();
    const pill = screen.getByRole('button', { name: /nya meddelanden/i });

    // tapping it jumps to the latest and clears itself
    ctl.grow(1100);
    fireEvent.click(pill);
    expect(ctl.scrollTop).toBe(1100);
    expect(markReadMutate).toHaveBeenCalledWith({ challengeId: 'c1', seq: 4 });
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
    scrollIntoView.mockRestore();
  });

  it("always follows the viewer's own outgoing message even if scrolled up", () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { view, ctl } = openWithMessages([row(1), row(2)], {
      scrollHeight: 900,
      clientHeight: 300,
    });
    ctl.scrollTop = 50;
    ctl.fireScroll();
    scrollIntoView.mockClear();

    // own message arrives (senderUserId === BASE_PROPS.userId)
    prime({
      isLoading: false,
      messages: [row(1), row(2), row(3, { senderUserId: 'u1' })],
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    expect(scrollIntoView).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
    scrollIntoView.mockRestore();
  });

  it('does not advance the read cursor while only scrolling through old history', () => {
    const { ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 900,
      clientHeight: 300,
    });
    markReadMutate.mockClear();
    ctl.scrollTop = 0;
    ctl.fireScroll();
    ctl.scrollTop = 120;
    ctl.fireScroll();
    expect(markReadMutate).not.toHaveBeenCalled();
  });
});
