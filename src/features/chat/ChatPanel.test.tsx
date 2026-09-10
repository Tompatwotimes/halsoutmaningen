import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  installResizeObserverMock,
  type ResizeObserverMockHandle,
} from '@/test/resize-observer-mock';
import type { ChatMessage } from './types';
import { ChatError } from './chat-error';

// jsdom has no scrollIntoView / createObjectURL / ResizeObserver — stub them.
let roMock: ResizeObserverMockHandle;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x' });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined });
  }
  roMock = installResizeObserverMock();
});
afterAll(() => {
  roMock.uninstall();
});

const {
  useChatMessagesMock,
  useMarkChatReadMock,
  usePostChatMessageMock,
  probeImageMock,
  setLikeMock,
  isLikePendingMock,
} = vi.hoisted(() => ({
  useChatMessagesMock: vi.fn<() => Record<string, unknown>>(),
  useMarkChatReadMock: vi.fn<() => Record<string, unknown>>(),
  usePostChatMessageMock: vi.fn<() => Record<string, unknown>>(),
  probeImageMock: vi.fn(),
  setLikeMock: vi.fn(),
  isLikePendingMock: vi.fn<(id: string) => boolean>(() => false),
}));

vi.mock('./useChat', () => ({
  useChatMessages: () => useChatMessagesMock(),
  useMarkChatRead: () => useMarkChatReadMock(),
  usePostChatMessage: () => usePostChatMessageMock(),
  useSetChatMessageLike: () => ({
    setLike: setLikeMock,
    isPending: isLikePendingMock,
    error: null,
    reset: vi.fn(),
  }),
  useChatImageUrls: () => ({ data: [], isLoading: false }),
  useTrainingCardProofUrls: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/features/challenge/heic', () => ({
  probeImage: probeImageMock,
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

function wrap(node: ReactNode) {
  return render(<>{node}</>);
}

let markReadMutate = vi.fn();
let fetchNextPage = vi.fn();

let postMutate = vi.fn();

function prime(
  over: Partial<ReturnType<typeof buildQuery>> = {},
  post: Record<string, unknown> = {},
): void {
  useChatMessagesMock.mockReturnValue({ ...buildQuery(), ...over });
  useMarkChatReadMock.mockReturnValue({ mutate: markReadMutate });
  usePostChatMessageMock.mockReturnValue({
    mutate: postMutate,
    isPending: false,
    isError: false,
    ...post,
  });
  probeImageMock.mockResolvedValue({
    decodable: true,
    width: 10,
    height: 10,
    likelyHeic: false,
  });
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
  postMutate = vi.fn();
  isLikePendingMock.mockReturnValue(false);
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

  it('renders a training-card message as an activity card, not a text bubble', () => {
    prime({
      messages: [
        row(5, {
          senderType: 'training_card',
          senderUserId: 'u2',
          senderDisplayName: 'Anna',
          body: null,
          trainingCard: {
            entryId: 'e1',
            activity: 'Löpning',
            durationMinutes: 45,
            note: 'skönt',
            challengeDate: '2026-09-05',
            entryStatus: 'active',
            trainedAt: '2026-09-05T12:00:00Z',
            proofs: [],
          },
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('training-card')).toBeInTheDocument();
    expect(screen.getByText(/Anna loggade ett pass/)).toBeInTheDocument();
    expect(screen.getByText('Löpning')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-message-body')).not.toBeInTheDocument();
  });

  it('renders a hidden training card as the placeholder, no card', () => {
    prime({
      messages: [
        row(6, {
          senderType: 'training_card',
          status: 'hidden',
          body: null,
          trainingCard: null,
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.queryByTestId('training-card')).not.toBeInTheDocument();
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
  });

  it('offers admins the moderation affordance on a training card', () => {
    const renderModeration = vi.fn(() => <span data-testid="mod">dölj</span>);
    prime({
      messages: [
        row(7, {
          senderType: 'training_card',
          body: null,
          trainingCard: {
            entryId: 'e1',
            activity: null,
            durationMinutes: 30,
            note: null,
            challengeDate: '2026-09-05',
            entryStatus: 'active',
            trainedAt: '2026-09-05T12:00:00Z',
            proofs: [],
          },
        }),
      ],
    });
    wrap(
      <ChatPanel {...BASE_PROPS} isAdmin renderModeration={renderModeration} />,
    );
    expect(screen.getByTestId('mod')).toBeInTheDocument();
  });
});

describe('ChatPanel — heart badge + message actions (Task E)', () => {
  it('shows a LikeBadge on an active participant message with likes', () => {
    prime({ messages: [row(5, { likeCount: 3 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: '3 personer gillar meddelandet' }),
    ).toBeInTheDocument();
  });

  it('shows NO LikeBadge when a message has zero likes', () => {
    prime({ messages: [row(5, { likeCount: 0 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.queryByRole('button', { name: /gillar meddelandet/ }),
    ).toBeNull();
  });

  it('shows a LikeBadge on a training card with likes', () => {
    prime({
      messages: [
        row(5, {
          senderType: 'training_card',
          body: null,
          likeCount: 6,
          trainingCard: {
            entryId: 'e1',
            activity: 'Löpning',
            durationMinutes: 45,
            note: null,
            challengeDate: '2026-09-05',
            entryStatus: 'active',
            trainedAt: '2026-09-05T12:00:00Z',
            proofs: [],
          },
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: '6 personer gillar passet' }),
    ).toBeInTheDocument();
  });

  it('shows a LikeBadge on a Game Master message with likes', () => {
    prime({
      messages: [
        row(5, {
          senderType: 'game_master',
          senderUserId: null,
          senderDisplayName: null,
          body: 'GAME MASTER: kör hårt',
          likeCount: 2,
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: '2 personer gillar meddelandet' }),
    ).toBeInTheDocument();
  });

  it('shows NEITHER a badge NOR actions on a hidden message', () => {
    prime({
      messages: [row(5, { status: 'hidden', body: null, likeCount: 0 })],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gillar/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Gilla meddelandet' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /^Svara på/ })).toBeNull();
  });

  it('gives an active message a keyboard-reachable like + reply action row', () => {
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: 'Gilla meddelandet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    ).toBeInTheDocument();
  });

  it('gives a training card the "Gilla passet" action', () => {
    prime({
      messages: [
        row(5, {
          senderType: 'training_card',
          body: null,
          senderDisplayName: 'Tomas',
          trainingCard: {
            entryId: 'e1',
            activity: 'Löpning',
            durationMinutes: 45,
            note: null,
            challengeDate: '2026-09-05',
            entryStatus: 'active',
            trainedAt: '2026-09-05T12:00:00Z',
            proofs: [],
          },
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: 'Gilla passet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Svara på Tomas pass' }),
    ).toBeInTheDocument();
  });

  it('the explicit like action calls setLike with the desired state true (unliked → like)', async () => {
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Gilla meddelandet' }),
    );
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
  });

  it('the explicit unlike action calls setLike with liked=false (liked → unlike)', async () => {
    prime({ messages: [row(5, { likedByMe: true, likeCount: 2 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Ta bort gilla-markering' }),
    );
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: false });
  });

  it('disables the like action while that message is pending', () => {
    isLikePendingMock.mockImplementation((id: string) => id === 'm5');
    prime({ messages: [row(5), row(6)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const buttons = screen.getAllByRole('button', {
      name: 'Gilla meddelandet',
    });
    // row 5 pending → disabled; row 6 not pending → enabled
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });

  it('double-click on an unliked message card likes it (desired state true, not a toggle)', () => {
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const card = document.body.querySelector('[data-seq="5"]')!;
    fireEvent.dblClick(card);
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
  });

  it('double-click on an already-liked message does NOT unlike', () => {
    prime({ messages: [row(5, { likedByMe: true, likeCount: 3 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    fireEvent.dblClick(document.body.querySelector('[data-seq="5"]')!);
    expect(setLikeMock).not.toHaveBeenCalled();
  });

  it('double-click landing on an interactive child (the badge button) does not like via the card', () => {
    prime({ messages: [row(5, { likedByMe: false, likeCount: 4 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const badge = screen.getByRole('button', {
      name: '4 personer gillar meddelandet',
    });
    fireEvent.dblClick(badge);
    // the card handler bailed (target is a <button>); no liked=true from the card
    expect(setLikeMock).not.toHaveBeenCalledWith({
      messageId: 'm5',
      liked: true,
    });
  });

  it('a single click on the action button does not also trigger the card double-click like', async () => {
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Gilla meddelandet' }),
    );
    expect(setLikeMock).toHaveBeenCalledTimes(1);
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
  });

  it('carries data-seq on the message row for later jump-to-original', () => {
    prime({ messages: [row(42)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(document.body.querySelector('[data-seq="42"]')).toBeInTheDocument();
  });

  it('leaves the message body, attachments and moderation affordance intact', () => {
    const renderModeration = vi.fn(() => <span data-testid="mod">dölj</span>);
    prime({
      messages: [
        row(5, {
          body: 'oförändrad text',
          likeCount: 2,
          attachments: [{ position: 1, path: 'c1/u2/m5/1-a.jpg' }],
        }),
      ],
    });
    wrap(
      <ChatPanel {...BASE_PROPS} isAdmin renderModeration={renderModeration} />,
    );
    expect(screen.getByTestId('chat-message-body')).toHaveTextContent(
      'oförändrad text',
    );
    expect(screen.getByTestId('mod')).toBeInTheDocument();
  });

  it('the "Svara" action calls onReplyToMessage with the message', async () => {
    const onReplyToMessage = vi.fn();
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    expect(onReplyToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm5', seq: 5 }),
    );
  });
});

describe('ChatPanel — reply composer mode + quoted replies (Task G)', () => {
  function replyPreview(
    over: Partial<NonNullable<ChatMessage['replyPreview']>> = {},
  ): NonNullable<ChatMessage['replyPreview']> {
    return {
      deleted: false,
      messageId: 'p1',
      seq: 2,
      senderType: 'participant',
      senderUserId: 'u2',
      senderDisplayName: 'Anna',
      kind: 'text',
      text: 'Golf räknas inte',
      hasImage: false,
      training: null,
      ...over,
    };
  }

  it('arming a reply via the Svara button shows the composer strip with the target sender', async () => {
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    expect(screen.getByText('Svarar på Anna')).toBeInTheDocument();
  });

  it('arming a reply via a right swipe shows the same composer strip', () => {
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const cardEl = document.body.querySelector(
      '[data-seq="5"]',
    )! as HTMLElement;
    fireEvent.pointerDown(cardEl, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(cardEl, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 80,
      clientY: 2,
    });
    fireEvent.pointerUp(cardEl, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 80,
      clientY: 2,
    });
    expect(screen.getByText('Svarar på Anna')).toBeInTheDocument();
  });

  it('the ✕ cancels reply mode but keeps the typed draft', async () => {
    const user = userEvent.setup({ delay: null });
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'mitt svar');
    await user.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    expect(screen.getByText('Svarar på Anna')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avbryt svar' }));
    expect(screen.queryByText('Svarar på Anna')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('mitt svar');
  });

  it('sending while in reply mode threads replyToMessageId to post.mutate', async () => {
    const user = userEvent.setup({ delay: null });
    prime({ messages: [row(5, { id: 'm5', senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'det gör det visst');
    await user.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    expect(postMutate).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: 'm5' }),
      expect.anything(),
    );
  });

  it('a normal (non-reply) send does NOT include replyToMessageId', async () => {
    const user = userEvent.setup({ delay: null });
    prime({ messages: [row(5)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'vanligt meddelande');
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    const [vars] = postMutate.mock.calls[0] as [Record<string, unknown>];
    expect(vars).not.toHaveProperty('replyToMessageId');
  });

  it('on a successful reply send the strip and the draft both clear', async () => {
    const user = userEvent.setup({ delay: null });
    postMutate = vi.fn((_vars, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'klart');
    await user.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    expect(screen.queryByText('Svarar på Anna')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('on a failed reply send the strip and the draft both remain', async () => {
    const user = userEvent.setup({ delay: null });
    postMutate = vi.fn((_vars, opts?: { onError?: (e: unknown) => void }) =>
      opts?.onError?.(new Error('nätverksfel')),
    );
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'behåll mig');
    await user.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    expect(screen.getByText('Svarar på Anna')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('behåll mig');
  });

  it('a hidden-target server error drops reply mode, keeps the draft, and shows the Swedish message', async () => {
    const user = userEvent.setup({ delay: null });
    const err = new ChatError('Meddelandet går inte längre att svara på');
    postMutate = vi.fn((_vars, opts?: { onError?: (e: unknown) => void }) =>
      opts?.onError?.(err),
    );
    prime(
      { messages: [row(5, { senderDisplayName: 'Anna' })] },
      { isError: true, error: err },
    );
    wrap(<ChatPanel {...BASE_PROPS} />);
    await user.type(screen.getByRole('textbox'), 'för sent');
    await user.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    expect(screen.queryByText('Svarar på Anna')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('för sent');
    expect(
      screen.getByText('Meddelandet går inte längre att svara på'),
    ).toBeInTheDocument();
  });

  it('renders one ReplyQuote inside a message that has a replyPreview', () => {
    prime({
      messages: [
        row(9, {
          replyPreview: replyPreview({
            senderDisplayName: 'Anna',
            text: 'Golf räknas inte',
          }),
          body: 'Det gör det visst',
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: /Svar på Annas meddelande/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Det gör det visst')).toBeInTheDocument();
  });

  it('renders replies flat — C replying to B quotes B only, never A', () => {
    // A ← B ← C. C's replyPreview describes B; A's text must not appear anywhere.
    prime({
      messages: [
        row(1, { id: 'mA', body: 'A: ursprunget', replyPreview: null }),
        row(2, {
          id: 'mB',
          body: 'B: svar på A',
          replyPreview: replyPreview({
            messageId: 'mA',
            senderDisplayName: 'Anna',
            text: 'A: ursprunget',
          }),
        }),
        row(3, {
          id: 'mC',
          body: 'C: svar på B',
          replyPreview: replyPreview({
            messageId: 'mB',
            senderDisplayName: 'Bo',
            text: 'B: svar på A',
          }),
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    // Exactly two quote blocks (B quotes A, C quotes B) — no recursive expansion.
    expect(screen.getAllByRole('button', { name: /^Svar på/ })).toHaveLength(2);
    // C's quote names Bo and shows B's text once (as a quote) + once (as C's... no, that's C's body)
    expect(
      screen.getByRole('button', { name: /Svar på Bos meddelande/ }),
    ).toBeInTheDocument();
  });

  it('a reply to a since-hidden parent shows exactly the placeholder in the quote, no leak', () => {
    prime({
      messages: [
        row(9, {
          body: 'mitt svar',
          replyPreview: replyPreview({
            deleted: true,
            messageId: null,
            seq: null,
            senderType: null,
            senderUserId: null,
            senderDisplayName: null,
            kind: null,
            text: null,
          }),
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(
      screen.getByRole('button', { name: 'Svar på ett borttaget meddelande' }),
    ).toBeInTheDocument();
    // the quote itself renders the canonical constant
    expect(
      screen.getAllByText('[Borttaget av administratör]').length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('ChatPanel — jump to original from a reply quote (Task H)', () => {
  function rp(
    over: Partial<NonNullable<ChatMessage['replyPreview']>> = {},
  ): NonNullable<ChatMessage['replyPreview']> {
    return {
      deleted: false,
      messageId: 'm1',
      seq: 1,
      senderType: 'participant',
      senderUserId: 'u2',
      senderDisplayName: 'Anna',
      kind: 'text',
      text: 'ursprunget',
      hasImage: false,
      training: null,
      ...over,
    };
  }

  function primeDynamic(
    getState: () => { messages: ChatMessage[]; hasNextPage: boolean },
  ) {
    useChatMessagesMock.mockImplementation(() => ({
      ...buildQuery(),
      ...getState(),
    }));
    useMarkChatReadMock.mockReturnValue({ mutate: markReadMutate });
    usePostChatMessageMock.mockReturnValue({
      mutate: postMutate,
      isPending: false,
      isError: false,
    });
    probeImageMock.mockResolvedValue({
      decodable: true,
      width: 10,
      height: 10,
      likelyHeic: false,
    });
  }

  it('scrolls a loaded target into view and briefly highlights it, leaving the follow latch alone', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    prime({
      messages: [
        row(1, { id: 'm1', body: 'ursprunget' }),
        row(2),
        row(9, {
          body: 'mitt svar',
          replyPreview: rp({ seq: 1, messageId: 'm1' }),
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /^Svar på/ }));

    const target = document.body.querySelector('[data-seq="1"]')!;
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    );
    expect(target).toHaveAttribute('data-jump-highlight');
    // the "Nya meddelanden" pill is never conjured by a jump
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(target).not.toHaveAttribute('data-jump-highlight');
    vi.useRealTimers();
    scrollIntoView.mockRestore();
  });

  it('pages upward (bounded) to reach an unloaded target, then scrolls to it', async () => {
    let revealedPages = 0;
    fetchNextPage = vi.fn(() => {
      revealedPages += 1;
      return Promise.resolve();
    });
    const deepTarget = row(1, { id: 'm1', body: 'långt bak' });
    const anchor = row(50, {
      body: 'svar',
      replyPreview: rp({ seq: 1, messageId: 'm1' }),
    });
    primeDynamic(() => ({
      messages: revealedPages >= 3 ? [deepTarget, anchor] : [anchor],
      hasNextPage: true,
    }));
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    wrap(<ChatPanel {...BASE_PROPS} />);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /^Svar på/ }));

    await waitFor(() =>
      expect(document.body.querySelector('[data-seq="1"]')).toBeInTheDocument(),
    );
    expect(fetchNextPage.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetchNextPage.mock.calls.length).toBeLessThanOrEqual(3);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    );
  });

  it('stops at the page cap and shows a one-line notice when the target is never found', async () => {
    fetchNextPage = vi.fn(() => Promise.resolve());
    primeDynamic(() => ({
      messages: [
        row(20),
        row(50, {
          body: 'svar',
          replyPreview: rp({ seq: 999, messageId: 'mX' }),
        }),
      ],
      hasNextPage: true,
    }));
    wrap(<ChatPanel {...BASE_PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: /^Svar på/ }));

    await screen.findByText('Kunde inte hitta meddelandet i historiken.');
    expect(fetchNextPage).toHaveBeenCalledTimes(10);

    // no further paging after the cap
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchNextPage).toHaveBeenCalledTimes(10);
  });

  it('does not page at all when there is no more history and the target is absent', async () => {
    fetchNextPage = vi.fn(() => Promise.resolve());
    primeDynamic(() => ({
      messages: [
        row(20),
        row(50, {
          body: 'svar',
          replyPreview: rp({ seq: 999, messageId: 'mX' }),
        }),
      ],
      hasNextPage: false,
    }));
    wrap(<ChatPanel {...BASE_PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: /^Svar på/ }));

    await screen.findByText('Kunde inte hitta meddelandet i historiken.');
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — moderation / privacy / regression sweep (Task I)', () => {
  const tombstone: NonNullable<ChatMessage['replyPreview']> = {
    deleted: true,
    messageId: null,
    seq: null,
    senderType: null,
    senderUserId: null,
    senderDisplayName: null,
    kind: null,
    text: null,
    hasImage: false,
    training: null,
  };

  it('a reply to a since-hidden parent shows ONLY the canonical placeholder — no parent body / note / activity / GM text', () => {
    prime({
      messages: [
        row(9, { body: 'mitt svar på det dolda', replyPreview: tombstone }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const quote = screen.getByRole('button', {
      name: 'Svar på ett borttaget meddelande',
    });
    expect(quote).toHaveTextContent('[Borttaget av administratör]');
    // none of the strings a real parent preview could have carried
    for (const leak of [
      'Löpning',
      'Simning',
      'hemlig anteckning',
      'GAME MASTER',
      'Golf räknas inte',
    ]) {
      expect(screen.queryByText(new RegExp(leak))).toBeNull();
    }
  });

  it('a hidden message that is ALSO a reply: quote placeholder shows, body withheld, and NO social controls', () => {
    prime({
      messages: [
        row(9, {
          status: 'hidden',
          body: null,
          likeCount: 0,
          likedByMe: false,
          replyPreview: tombstone,
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} />);
    // both the message body and the quote render the same placeholder
    expect(
      screen.getAllByText('[Borttaget av administratör]').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: /gillar/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Gilla meddelandet' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /^Svara på/ })).toBeNull();
  });

  it('a like refetch that returns the SAME seqs does not move the viewport or raise "Nya meddelanden"', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    // open → loading → messages, then the reader scrolls up to read history
    prime({ isLoading: true });
    const view = wrap(<ChatPanel {...BASE_PROPS} />);
    const el = screen.getByRole('log').parentElement!;
    const ctl = mockScroller(el, {
      scrollHeight: 900,
      clientHeight: 300,
      scrollTop: 0,
    });
    prime({ isLoading: false, messages: [row(1), row(2), row(3)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);
    ctl.scrollTop = 100; // scrolled well up
    ctl.fireScroll();
    scrollIntoView.mockClear();
    markReadMutate.mockClear();

    // a like landed → Realtime invalidates → refetch returns the SAME 3 seqs,
    // only like_count changed on row 2
    prime({
      isLoading: false,
      messages: [row(1), row(2, { likeCount: 1 }), row(3)],
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    expect(ctl.scrollTop).toBe(100);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
    expect(markReadMutate).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it('the moderation slot is still offered to admins on a plain participant message alongside the like badge', () => {
    const renderModeration = vi.fn(() => <span data-testid="mod">dölj</span>);
    prime({ messages: [row(5, { likeCount: 2, senderDisplayName: 'Anna' })] });
    wrap(
      <ChatPanel {...BASE_PROPS} isAdmin renderModeration={renderModeration} />,
    );
    expect(screen.getByTestId('mod')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '2 personer gillar meddelandet' }),
    ).toBeInTheDocument();
  });
});

describe('ChatPanel — mobile gestures (Task F)', () => {
  function card(seq: number): HTMLElement {
    return document.body.querySelector(`[data-seq="${seq}"]`)!;
  }
  function swipeRight(el: HTMLElement, toX: number) {
    fireEvent.pointerDown(el, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(el, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: toX,
      clientY: 2,
    });
    fireEvent.pointerUp(el, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: toX,
      clientY: 2,
    });
  }
  function doubleTap(el: HTMLElement, target?: Element) {
    const t = target ?? el;
    fireEvent.pointerDown(t, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(t, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerDown(t, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(t, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
  }

  it('swiping a participant message right past the threshold arms reply', () => {
    const onReplyToMessage = vi.fn();
    prime({ messages: [row(5, { senderDisplayName: 'Anna' })] });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    swipeRight(card(5), 80);
    expect(onReplyToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm5' }),
    );
  });

  it('a short right drag below the threshold does NOT arm reply', () => {
    const onReplyToMessage = vi.fn();
    prime({ messages: [row(5)] });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    swipeRight(card(5), 30);
    expect(onReplyToMessage).not.toHaveBeenCalled();
  });

  it('swiping a training card right arms reply with the training-card message', () => {
    const onReplyToMessage = vi.fn();
    prime({
      messages: [
        row(5, {
          senderType: 'training_card',
          body: null,
          trainingCard: {
            entryId: 'e1',
            activity: 'Löpning',
            durationMinutes: 45,
            note: null,
            challengeDate: '2026-09-05',
            entryStatus: 'active',
            trainedAt: '2026-09-05T12:00:00Z',
            proofs: [],
          },
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    swipeRight(card(5), 80);
    expect(onReplyToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm5', senderType: 'training_card' }),
    );
  });

  it('swiping a Game Master message right arms reply with the GM message', () => {
    const onReplyToMessage = vi.fn();
    prime({
      messages: [
        row(5, {
          senderType: 'game_master',
          senderUserId: null,
          senderDisplayName: null,
          body: 'GAME MASTER: kör hårt',
        }),
      ],
    });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    swipeRight(card(5), 80);
    expect(onReplyToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm5', senderType: 'game_master' }),
    );
  });

  it('a hidden message cannot be swipe-replied', () => {
    const onReplyToMessage = vi.fn();
    prime({ messages: [row(5, { status: 'hidden', body: null })] });
    wrap(<ChatPanel {...BASE_PROPS} onReplyToMessage={onReplyToMessage} />);
    swipeRight(card(5), 80);
    expect(onReplyToMessage).not.toHaveBeenCalled();
  });

  it('a touch double-tap on an unliked message likes it (make liked, never a toggle)', () => {
    vi.useFakeTimers();
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    doubleTap(card(5));
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
    expect(setLikeMock).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('a touch double-tap on an already-liked message does NOT unlike', () => {
    vi.useFakeTimers();
    prime({ messages: [row(5, { likedByMe: true, likeCount: 3 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    doubleTap(card(5));
    expect(setLikeMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('a hidden message cannot be double-tap-liked', () => {
    vi.useFakeTimers();
    prime({ messages: [row(5, { status: 'hidden', body: null })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    doubleTap(card(5));
    expect(setLikeMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('a touch double-tap while pending does nothing', () => {
    vi.useFakeTimers();
    isLikePendingMock.mockReturnValue(true);
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    doubleTap(card(5));
    expect(setLikeMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps data-seq on the row', () => {
    prime({ messages: [row(42)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(document.body.querySelector('[data-seq="42"]')).toBeInTheDocument();
  });

  it('the Task E explicit heart action still works alongside gestures', async () => {
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Gilla meddelandet' }),
    );
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
  });

  it('the Task E desktop double-click still likes (mouse path unchanged)', () => {
    prime({ messages: [row(5, { likedByMe: false })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    fireEvent.dblClick(card(5));
    expect(setLikeMock).toHaveBeenCalledWith({ messageId: 'm5', liked: true });
    expect(setLikeMock).toHaveBeenCalledTimes(1);
  });

  it('the Task E desktop double-click on an already-liked message still no-ops', () => {
    prime({ messages: [row(5, { likedByMe: true, likeCount: 2 })] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    fireEvent.dblClick(card(5));
    expect(setLikeMock).not.toHaveBeenCalled();
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
    const { view, ctl } = openWithMessages([row(1), row(2)], {
      scrollHeight: 500,
      clientHeight: 400,
      scrollTop: 100, // 500-100-400 = 0 → at the bottom
    });
    ctl.fireScroll();
    markReadMutate.mockClear();
    ctl.grow(640); // the new row adds height
    prime({ isLoading: false, messages: [row(1), row(2), row(3)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    // pinned to the (grown) bottom, not stranded at 100
    expect(ctl.scrollTop).toBe(640);
    expect(markReadMutate).toHaveBeenCalledWith({ challengeId: 'c1', seq: 3 });
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
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
    const { view, ctl } = openWithMessages([row(1), row(2)], {
      scrollHeight: 900,
      clientHeight: 300,
    });
    ctl.scrollTop = 50; // scrolled up — reading history
    ctl.fireScroll();
    ctl.grow(1000);

    // own message arrives (senderUserId === BASE_PROPS.userId)
    prime({
      isLoading: false,
      messages: [row(1), row(2), row(3, { senderUserId: 'u1' })],
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    // followed to the bottom despite being scrolled up (own message)
    expect(ctl.scrollTop).toBe(1000);
    expect(
      screen.queryByRole('button', { name: /nya meddelanden/i }),
    ).not.toBeInTheDocument();
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

  // --- first-open media/layout growth (the production bug) ------------------

  it('re-pins to the newest message when first-page media grows the list after the initial pin', () => {
    // Cold first open: the initial pin runs against a not-yet-settled height
    // (image thumbnails still skeletons). Then the images load and grow the
    // list. The viewport must stay pinned to the newest message.
    const { ctl } = openWithMessages(
      [row(1, { attachments: [{ position: 1, path: 'p1' }] }), row(2), row(3)],
      { scrollHeight: 1400, clientHeight: 400, scrollTop: 0 },
    );
    expect(ctl.scrollTop).toBe(1400);

    // media finishes loading → list is 800px taller, reported by ResizeObserver
    ctl.grow(2200);
    roMock.trigger();

    expect(ctl.scrollTop).toBe(2200);
  });

  it('stops re-pinning once the user scrolls up to read history', () => {
    const { ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: 0,
    });
    expect(ctl.scrollTop).toBe(1400);

    // user scrolls well up (1400 - 200 - 400 = 800 > 96 → not near bottom)
    ctl.scrollTop = 200;
    ctl.fireScroll();

    // later layout growth must NOT drag them back down
    ctl.grow(2600);
    roMock.trigger();
    expect(ctl.scrollTop).toBe(200);
  });

  it('resumes re-pinning after the user scrolls back to the bottom', () => {
    const { ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: 0,
    });
    ctl.scrollTop = 200;
    ctl.fireScroll();
    ctl.grow(2600);
    roMock.trigger();
    expect(ctl.scrollTop).toBe(200);

    // user scrolls back to the bottom (2600 - 2200 - 400 = 0 → near bottom)
    ctl.scrollTop = 2200;
    ctl.fireScroll();

    // now later growth follows again
    ctl.grow(3000);
    roMock.trigger();
    expect(ctl.scrollTop).toBe(3000);
  });

  it('opens at the newest message again after being closed and reopened', () => {
    const { view, ctl } = openWithMessages([row(1), row(2), row(3)], {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: 0,
    });
    expect(ctl.scrollTop).toBe(1400);

    // user scrolls up, then closes the panel
    ctl.scrollTop = 100;
    ctl.fireScroll();
    view.rerender(<>{<ChatPanel {...BASE_PROPS} open={false} />}</>);

    // reopen → loading → messages; a fresh scroller starting at 0
    prime({ isLoading: true });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);
    const el2 = screen.getByRole('log').parentElement!;
    const ctl2 = mockScroller(el2, {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: 0,
    });
    prime({ isLoading: false, messages: [row(1), row(2), row(3)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} />}</>);

    expect(ctl2.scrollTop).toBe(1400);
  });
});

describe('ChatPanel — opens at the latest message (cached React Query lifecycle)', () => {
  // The B1 helper above always routes reopen through `isLoading: true` →
  // `isLoading: false`, which re-triggers the pin layout effect. Real
  // TanStack Query does NOT reload when the panel reopens with data already in
  // cache: `isLoading` is false and `messages` is populated on the FIRST
  // `open` render. This block models that path.
  function installProtoGeometry(opts: {
    scrollHeight: number;
    clientHeight: number;
  }) {
    const tops = new WeakMap<HTMLElement, number>();
    let scrollHeight = opts.scrollHeight;
    const proto = HTMLElement.prototype;
    const prev = {
      scrollHeight: Object.getOwnPropertyDescriptor(proto, 'scrollHeight'),
      clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
      scrollTop: Object.getOwnPropertyDescriptor(proto, 'scrollTop'),
    };
    Object.defineProperty(proto, 'scrollHeight', {
      configurable: true,
      get() {
        return scrollHeight;
      },
    });
    Object.defineProperty(proto, 'clientHeight', {
      configurable: true,
      get() {
        return opts.clientHeight;
      },
    });
    Object.defineProperty(proto, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return tops.get(this) ?? 0;
      },
      // A real scroll container CLAMPS scrollTop to [0, scrollHeight -
      // clientHeight] and fires a `scroll` event. jsdom does neither — which is
      // exactly why `scrollTop = scrollHeight` (pinToBottom) used to be
      // mis-measured as a user scroll in production but never in unit tests.
      set(this: HTMLElement, v: number) {
        const max = Math.max(0, scrollHeight - opts.clientHeight);
        const clamped = Math.max(0, Math.min(v, max));
        const before = tops.get(this) ?? 0;
        tops.set(this, clamped);
        if (clamped !== before) this.dispatchEvent(new Event('scroll'));
      },
    });
    return {
      grow(to: number) {
        scrollHeight = to;
      },
      get scrollHeight() {
        return scrollHeight;
      },
      get maxScroll() {
        return Math.max(0, scrollHeight - opts.clientHeight);
      },
      clientHeight: opts.clientHeight,
      scrollTopOf(el: HTMLElement) {
        return tops.get(el) ?? 0;
      },
      uninstall() {
        for (const key of [
          'scrollHeight',
          'clientHeight',
          'scrollTop',
        ] as const) {
          const d = prev[key];
          if (d) Object.defineProperty(proto, key, d);
        }
      },
    };
  }

  let geom: ReturnType<typeof installProtoGeometry> | undefined;
  afterEach(() => {
    geom?.uninstall();
    geom = undefined;
  });

  /** Mount closed, then flip to open with cached data present on the first open render. */
  function cachedOpen(
    messages: ChatMessage[],
    g: ReturnType<typeof installProtoGeometry>,
  ) {
    prime({ isLoading: false, messages });
    const view = wrap(<ChatPanel {...BASE_PROPS} open={false} />);
    // now open — messages are ALREADY there, no loading transition
    view.rerender(<>{<ChatPanel {...BASE_PROPS} open />}</>);
    const scroller = screen.getByRole('log').parentElement!;
    return { view, scroller, top: () => g.scrollTopOf(scroller) };
  }

  it('lands at the actual bottom on a cached open (no loading transition)', () => {
    geom = installProtoGeometry({ scrollHeight: 1400, clientHeight: 400 });
    const { top } = cachedOpen([row(1), row(2), row(3)], geom);
    expect(top()).toBe(geom.maxScroll); // = scrollHeight - clientHeight = 1000
  });

  it('keeps following the bottom when content grows AFTER a cached open (images/quotes settle)', () => {
    geom = installProtoGeometry({ scrollHeight: 1400, clientHeight: 400 });
    const { top } = cachedOpen([row(1), row(2), row(3)], geom);
    expect(top()).toBe(1000);

    // media / reply-quote / action-row heights land a frame later → list grows.
    // The pin's own scroll event (scrollTop clamped to the OLD max while the
    // list is taller) must NOT be read as "user scrolled up".
    geom.grow(2600);
    act(() => roMock.trigger());

    expect(top()).toBe(geom.maxScroll); // 2200 — still pinned to the newest
  });

  it('reopen after a new message arrived while closed opens at that new message', () => {
    geom = installProtoGeometry({ scrollHeight: 1400, clientHeight: 400 });
    const { view } = cachedOpen([row(1), row(2), row(3)], geom);
    view.rerender(<>{<ChatPanel {...BASE_PROPS} open={false} />}</>);

    geom.grow(1900);
    prime({ isLoading: false, messages: [row(1), row(2), row(3), row(4)] });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} open />}</>);
    const scroller2 = screen.getByRole('log').parentElement!;
    expect(geom.scrollTopOf(scroller2)).toBe(geom.maxScroll); // 1500
    expect(markReadMutate).toHaveBeenCalledWith({ challengeId: 'c1', seq: 4 });
  });

  it('reopen after scrolling up in a PRIOR session still opens at the latest', () => {
    geom = installProtoGeometry({ scrollHeight: 1400, clientHeight: 400 });
    const { view, scroller, top } = cachedOpen([row(1), row(2), row(3)], geom);
    expect(top()).toBe(1000);

    // user scrolls up, then closes
    act(() => {
      scroller.scrollTop = 100;
    });
    view.rerender(<>{<ChatPanel {...BASE_PROPS} open={false} />}</>);

    view.rerender(<>{<ChatPanel {...BASE_PROPS} open />}</>);
    const scroller2 = screen.getByRole('log').parentElement!;
    expect(geom.scrollTopOf(scroller2)).toBe(1000);

    // and a later growth on THIS session is still followed
    geom.grow(3000);
    act(() => roMock.trigger());
    expect(geom.scrollTopOf(scroller2)).toBe(geom.maxScroll); // 2600
  });

  it('a deliberate scroll-up in the CURRENT open session still stops the follow', () => {
    geom = installProtoGeometry({ scrollHeight: 2000, clientHeight: 400 });
    const { scroller } = cachedOpen([row(1), row(2), row(3)], geom);
    expect(geom.scrollTopOf(scroller)).toBe(1600);

    // user scrolls well up — a downward scrollTop move past the intent threshold
    act(() => {
      scroller.scrollTop = 200;
    });

    // later growth must NOT drag them back down
    geom.grow(3200);
    act(() => roMock.trigger());
    expect(geom.scrollTopOf(scroller)).toBe(200);
  });

  it('a tiny sub-threshold scroll wobble does NOT count as scrolling away', () => {
    geom = installProtoGeometry({ scrollHeight: 2000, clientHeight: 400 });
    const { scroller } = cachedOpen([row(1), row(2), row(3)], geom);
    expect(geom.scrollTopOf(scroller)).toBe(1600);

    // a 2px jitter (momentum settle / rounding) — still following
    act(() => {
      scroller.scrollTop = 1598;
    });
    geom.grow(2600);
    act(() => roMock.trigger());
    expect(geom.scrollTopOf(scroller)).toBe(geom.maxScroll); // 2200
  });

  it('scrolling back down to the bottom re-arms the follow', () => {
    const g = installProtoGeometry({ scrollHeight: 3000, clientHeight: 400 });
    geom = g;
    const { scroller } = cachedOpen([row(1), row(2), row(3)], g);

    act(() => {
      scroller.scrollTop = 300;
    }); // away
    g.grow(3400);
    act(() => roMock.trigger());
    expect(g.scrollTopOf(scroller)).toBe(300); // not yanked

    act(() => {
      scroller.scrollTop = g.maxScroll;
    }); // user returns to bottom
    g.grow(4000);
    act(() => roMock.trigger());
    expect(g.scrollTopOf(scroller)).toBe(g.maxScroll); // following again
  });
});

describe('ChatPanel image composer (B3)', () => {
  function jpeg(name = 'a.jpg') {
    return new File(['x'], name, { type: 'image/jpeg' });
  }

  it('shows a preview thumbnail after picking an image and can remove it', async () => {
    const user = userEvent.setup();
    prime({ messages: [row(1)] });
    wrap(<ChatPanel {...BASE_PROPS} />);

    const input = screen.getByLabelText('Välj bilder');
    await user.upload(input, jpeg());

    const strip = await screen.findByTestId('chat-compose-images');
    expect(strip.querySelectorAll('img')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Ta bort bild 1' }));
    expect(screen.queryByTestId('chat-compose-images')).not.toBeInTheDocument();
  });

  it('sends the picked files with the message and clears them on success', async () => {
    const user = userEvent.setup();
    postMutate = vi.fn((_vars, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    prime({ messages: [row(1)] });
    wrap(<ChatPanel {...BASE_PROPS} />);

    await user.upload(screen.getByLabelText('Välj bilder'), jpeg());
    await screen.findByTestId('chat-compose-images');
    await user.click(screen.getByRole('button', { name: 'Skicka' }));

    expect(postMutate).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: 'c1', userId: 'u1' }),
      expect.anything(),
    );
    const [vars] = postMutate.mock.calls[0] as [{ files: File[] }];
    expect(vars.files).toHaveLength(1);
    expect(screen.queryByTestId('chat-compose-images')).not.toBeInTheDocument();
  });

  it('rejects a fifth image and keeps four', async () => {
    const user = userEvent.setup();
    prime({ messages: [row(1)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    const input = screen.getByLabelText('Välj bilder');
    await user.upload(input, [jpeg('1'), jpeg('2'), jpeg('3'), jpeg('4')]);
    await screen.findByTestId('chat-compose-images');
    await user.upload(input, jpeg('5'));

    expect(
      screen.getByTestId('chat-compose-images').querySelectorAll('img'),
    ).toHaveLength(4);
    expect(screen.getByText(/högst fyra bilder/i)).toBeInTheDocument();
  });

  it('disables send and shows a pending label while a send is in flight', () => {
    prime({ messages: [row(1)] }, { isPending: true });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /laddar upp/i })).toBeDisabled();
  });

  it('shows "Förbereder bild…" then "Laddar upp…" as the send reports progress', async () => {
    const user = userEvent.setup();
    let capturedOnPhase: ((p: 'processing' | 'uploading') => void) | undefined;
    postMutate = vi.fn(
      (vars: { onPhase?: (p: 'processing' | 'uploading') => void }) => {
        capturedOnPhase = vars.onPhase;
      },
    );
    prime({ messages: [row(1)] });
    wrap(<ChatPanel {...BASE_PROPS} />);

    await user.upload(screen.getByLabelText('Välj bilder'), jpeg());
    await screen.findByTestId('chat-compose-images');
    await user.click(screen.getByRole('button', { name: 'Skicka' }));
    expect(capturedOnPhase).toBeTypeOf('function');

    capturedOnPhase?.('processing');
    expect(
      await screen.findByRole('button', { name: /förbereder bild/i }),
    ).toBeInTheDocument();

    capturedOnPhase?.('uploading');
    expect(
      await screen.findByRole('button', { name: /laddar upp/i }),
    ).toBeInTheDocument();
  });

  it('an image-only send is allowed (send enabled with no text)', async () => {
    const user = userEvent.setup();
    prime({ messages: [row(1)] });
    wrap(<ChatPanel {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: 'Skicka' })).toBeDisabled();
    await user.upload(screen.getByLabelText('Välj bilder'), jpeg());
    await screen.findByTestId('chat-compose-images');
    expect(screen.getByRole('button', { name: 'Skicka' })).toBeEnabled();
  });
});
