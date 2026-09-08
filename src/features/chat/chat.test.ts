import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  REPLY_SWIPE_ARM_PX,
  REPLY_SWIPE_MAX_PX,
  chatDateSeparatorKey,
  classifyPointerMove,
  clampSwipeDx,
  displayBody,
  isChatImageTarget,
  isInteractiveEventTarget,
  isNearBottom,
  isProgrammaticScroll,
  isSwipeArmed,
  isWithinRateLimitWindow,
  likeBadgeAriaLabel,
  scrollAnchorAdjustment,
  shouldFollowNewMessage,
  sortBySeq,
  swedishPossessive,
} from './chat';
import type { ChatMessage } from './types';

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    seq: 1,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u1',
    senderDisplayName: 'Pia',
    body: 'hej',
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
    ...overrides,
  };
}

describe('displayBody', () => {
  it('returns the fixed placeholder for a hidden message, never the real body', () => {
    expect(displayBody({ status: 'hidden', body: 'något olämpligt' })).toBe(
      '[Borttaget av administratör]',
    );
  });
  it('returns the real body for an active message', () => {
    expect(displayBody({ status: 'active', body: 'Hej!' })).toBe('Hej!');
  });
  it('renders the placeholder when the server withheld the body (null)', () => {
    // list_chat_messages sends body: null for a hidden message to a non-admin.
    expect(displayBody({ status: 'hidden', body: null })).toBe(
      '[Borttaget av administratör]',
    );
    // defensive: a null body on an "active" row still never renders as empty
    expect(displayBody({ status: 'active', body: null })).toBe(
      '[Borttaget av administratör]',
    );
  });

  it('renders no text line for an active training card (it draws itself)', () => {
    expect(
      displayBody({
        status: 'active',
        body: null,
        trainingCard: { entryId: 'e1' },
      }),
    ).toBeNull();
  });

  it('renders the placeholder for a hidden training card', () => {
    expect(
      displayBody({ status: 'hidden', body: null, trainingCard: null }),
    ).toBe('[Borttaget av administratör]');
  });

  it('is unchanged for a pre-PR-8 row where the trainingCard key is absent', () => {
    // Release compatibility: the current production list_chat_messages has no
    // training_card column, so `trainingCard` is simply not present.
    expect(displayBody({ status: 'active', body: 'hej' })).toBe('hej');
    expect(displayBody({ status: 'hidden', body: null })).toBe(
      '[Borttaget av administratör]',
    );
    expect(displayBody({ status: 'active', body: null, attachments: [] })).toBe(
      '[Borttaget av administratör]',
    );
    expect(
      displayBody({
        status: 'active',
        body: null,
        attachments: [{ position: 1, path: 'x' }],
      }),
    ).toBeNull();
  });
});

describe('chatDateSeparatorKey', () => {
  it('groups by the CHALLENGE-LOCAL calendar day, not UTC', () => {
    // 23:30Z on the 5th is already the 6th in Europe/Stockholm (CEST, UTC+2).
    expect(
      chatDateSeparatorKey('2026-09-05T23:30:00Z', 'Europe/Stockholm'),
    ).toBe('2026-09-06');
  });
  it('keeps a mid-day timestamp on its own local day', () => {
    expect(
      chatDateSeparatorKey('2026-09-05T10:00:00Z', 'Europe/Stockholm'),
    ).toBe('2026-09-05');
  });
});

describe('isWithinRateLimitWindow', () => {
  it('is true for a message sent 29 seconds ago with a 30s window', () => {
    expect(
      isWithinRateLimitWindow(
        '2026-09-05T12:00:29Z',
        '2026-09-05T12:00:00Z',
        30,
      ),
    ).toBe(true);
  });
  it('is false for a message sent 31 seconds ago with a 30s window', () => {
    expect(
      isWithinRateLimitWindow(
        '2026-09-05T12:00:31Z',
        '2026-09-05T12:00:00Z',
        30,
      ),
    ).toBe(false);
  });
});

describe('sortBySeq', () => {
  it('orders ascending by seq regardless of input order or createdAt', () => {
    const input = [
      msg({ id: 'b', seq: 3, createdAt: '2026-09-05T12:00:00Z' }),
      msg({ id: 'a', seq: 1, createdAt: '2026-09-05T12:00:05Z' }),
      msg({ id: 'c', seq: 2, createdAt: '2026-09-05T12:00:02Z' }),
    ];
    expect(sortBySeq(input).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });
  it('does not mutate the input array', () => {
    const input = [msg({ id: 'b', seq: 2 }), msg({ id: 'a', seq: 1 })];
    sortBySeq(input);
    expect(input.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('isNearBottom', () => {
  it('is true when the scroll position is within the gap of the bottom', () => {
    // 1000 content, 400 viewport, scrolled to 560 → 40px from the bottom.
    expect(
      isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 560 }),
    ).toBe(true);
  });
  it('is true exactly at the bottom', () => {
    expect(
      isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }),
    ).toBe(true);
  });
  it('is false when scrolled up past the gap', () => {
    expect(
      isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 200 }),
    ).toBe(false);
  });
  it('honours a custom gap', () => {
    const m = { scrollHeight: 1000, clientHeight: 400, scrollTop: 500 }; // 100 up
    expect(isNearBottom(m, 96)).toBe(false);
    expect(isNearBottom(m, 120)).toBe(true);
  });
});

describe('scrollAnchorAdjustment', () => {
  it('returns the height the list grew by, to keep the same message in view', () => {
    expect(scrollAnchorAdjustment(1000, 1600)).toBe(600);
  });
  it('never returns a negative adjustment (list got shorter)', () => {
    expect(scrollAnchorAdjustment(1600, 1000)).toBe(0);
  });
  it('is zero when the height did not change', () => {
    expect(scrollAnchorAdjustment(1000, 1000)).toBe(0);
  });
});

describe('shouldFollowNewMessage', () => {
  it('follows when the viewer was near the bottom', () => {
    expect(shouldFollowNewMessage(true)).toBe(true);
  });
  it('does not follow when the viewer was reading older history', () => {
    expect(shouldFollowNewMessage(false)).toBe(false);
  });
});

describe('isProgrammaticScroll', () => {
  it('is true when the scroll landed within tolerance of the expected top', () => {
    expect(isProgrammaticScroll(1200, 1200)).toBe(true);
    expect(isProgrammaticScroll(1199, 1200)).toBe(true);
    expect(isProgrammaticScroll(1202, 1200)).toBe(true);
  });
  it('is false when the scroll is far from the expected top (a user scroll)', () => {
    expect(isProgrammaticScroll(0, 1200)).toBe(false);
    expect(isProgrammaticScroll(1190, 1200)).toBe(false);
  });
  it('is false when no programmatic scroll is pending (expectedTop null)', () => {
    expect(isProgrammaticScroll(0, null)).toBe(false);
    expect(isProgrammaticScroll(1200, null)).toBe(false);
  });
  it('honours a custom tolerance', () => {
    expect(isProgrammaticScroll(1195, 1200, 2)).toBe(false);
    expect(isProgrammaticScroll(1195, 1200, 8)).toBe(true);
  });
});

describe('likeBadgeAriaLabel', () => {
  it('is empty when there is nothing to announce', () => {
    expect(likeBadgeAriaLabel(0, false)).toBe('');
    expect(likeBadgeAriaLabel(0, true)).toBe('');
    expect(likeBadgeAriaLabel(-2, false)).toBe('');
  });
  it('counts other people in singular / plural', () => {
    expect(likeBadgeAriaLabel(1, false)).toBe('1 person gillar meddelandet');
    expect(likeBadgeAriaLabel(3, false)).toBe('3 personer gillar meddelandet');
  });
  it('names the viewer when they liked', () => {
    expect(likeBadgeAriaLabel(1, true)).toBe('Du gillar meddelandet');
    expect(likeBadgeAriaLabel(2, true)).toBe(
      'Du och 1 annan gillar meddelandet',
    );
    expect(likeBadgeAriaLabel(4, true)).toBe(
      'Du och 3 andra gillar meddelandet',
    );
  });
  it('uses the given subject noun for a training card', () => {
    expect(likeBadgeAriaLabel(2, false, 'passet')).toBe(
      '2 personer gillar passet',
    );
    expect(likeBadgeAriaLabel(3, true, 'passet')).toBe(
      'Du och 2 andra gillar passet',
    );
  });
});

describe('swedishPossessive', () => {
  it('adds -s to an ordinary name', () => {
    expect(swedishPossessive('Anna')).toBe('Annas');
    expect(swedishPossessive('Game Master')).toBe('Game Masters');
  });
  it('leaves a name ending in s / x / z unchanged', () => {
    expect(swedishPossessive('Tomas')).toBe('Tomas');
    expect(swedishPossessive('Max')).toBe('Max');
  });
});

describe('isInteractiveEventTarget', () => {
  it('is false for a plain element and for a null target', () => {
    expect(isInteractiveEventTarget(null)).toBe(false);
    const div = document.createElement('div');
    expect(isInteractiveEventTarget(div)).toBe(false);
  });
  it('is true for a button, a link, or a node inside one', () => {
    const button = document.createElement('button');
    const span = document.createElement('span');
    button.append(span);
    expect(isInteractiveEventTarget(button)).toBe(true);
    expect(isInteractiveEventTarget(span)).toBe(true);
    const a = document.createElement('a');
    expect(isInteractiveEventTarget(a)).toBe(true);
  });
});

describe('isChatImageTarget', () => {
  it('is true for a node inside a [data-chat-image] element', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-chat-image', '');
    const img = document.createElement('img');
    btn.append(img);
    expect(isChatImageTarget(img)).toBe(true);
    expect(isChatImageTarget(btn)).toBe(true);
  });
  it('is false for a plain button, a null target, and a non-Element', () => {
    expect(isChatImageTarget(null)).toBe(false);
    expect(isChatImageTarget(document.createElement('button'))).toBe(false);
  });
});

describe('classifyPointerMove', () => {
  it('is idle for a tiny movement', () => {
    expect(classifyPointerMove({ dx: 5, dy: 3 })).toBe('idle');
    expect(classifyPointerMove({ dx: 0, dy: 0 })).toBe('idle');
  });
  it('is vscroll for a dominant vertical move (either direction)', () => {
    expect(classifyPointerMove({ dx: 2, dy: 20 })).toBe('vscroll');
    expect(classifyPointerMove({ dx: -2, dy: -30 })).toBe('vscroll');
    expect(classifyPointerMove({ dx: 15, dy: 14 })).toBe('vscroll');
  });
  it('is swipe only for a dominant RIGHTWARD move', () => {
    expect(classifyPointerMove({ dx: 30, dy: 5 })).toBe('swipe');
    expect(classifyPointerMove({ dx: 40, dy: -8 })).toBe('swipe');
  });
  it('is never swipe for a leftward move', () => {
    expect(classifyPointerMove({ dx: -30, dy: 5 })).toBe('idle');
    expect(classifyPointerMove({ dx: -80, dy: 2 })).toBe('idle');
  });
  it('does not arm on an ambiguous diagonal (dx not clearly dominant)', () => {
    expect(classifyPointerMove({ dx: 12, dy: 9 })).toBe('idle');
    expect(classifyPointerMove({ dx: 20, dy: 15 })).toBe('vscroll');
  });
});

describe('isSwipeArmed', () => {
  it('is false below the arm threshold', () => {
    expect(isSwipeArmed(0)).toBe(false);
    expect(isSwipeArmed(REPLY_SWIPE_ARM_PX - 1)).toBe(false);
  });
  it('is true at or past the arm threshold', () => {
    expect(isSwipeArmed(REPLY_SWIPE_ARM_PX)).toBe(true);
    expect(isSwipeArmed(REPLY_SWIPE_ARM_PX + 40)).toBe(true);
  });
});

describe('clampSwipeDx', () => {
  it('never returns a negative follow distance', () => {
    expect(clampSwipeDx(-40)).toBe(0);
    expect(clampSwipeDx(0)).toBe(0);
  });
  it('clamps to REPLY_SWIPE_MAX_PX so a card cannot slide off-screen', () => {
    expect(clampSwipeDx(30)).toBe(30);
    expect(clampSwipeDx(REPLY_SWIPE_MAX_PX + 500)).toBe(REPLY_SWIPE_MAX_PX);
  });
});

describe('gesture constants', () => {
  it('exports a sane double-tap window and swipe thresholds', () => {
    expect(DOUBLE_TAP_MS).toBe(260);
    expect(REPLY_SWIPE_ARM_PX).toBe(64);
    expect(REPLY_SWIPE_MAX_PX).toBe(96);
    expect(REPLY_SWIPE_ARM_PX).toBeLessThan(REPLY_SWIPE_MAX_PX);
  });
});
