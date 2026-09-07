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
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  installResizeObserverMock,
  type ResizeObserverMockHandle,
} from '@/test/resize-observer-mock';
import type { ChatMessage } from './types';

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
} = vi.hoisted(() => ({
  useChatMessagesMock: vi.fn<() => Record<string, unknown>>(),
  useMarkChatReadMock: vi.fn<() => Record<string, unknown>>(),
  usePostChatMessageMock: vi.fn<() => Record<string, unknown>>(),
  probeImageMock: vi.fn(),
}));

vi.mock('./useChat', () => ({
  useChatMessages: () => useChatMessagesMock(),
  useMarkChatRead: () => useMarkChatReadMock(),
  usePostChatMessage: () => usePostChatMessageMock(),
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
