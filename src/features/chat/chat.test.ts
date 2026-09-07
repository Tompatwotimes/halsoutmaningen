import { describe, expect, it } from 'vitest';
import {
  chatDateSeparatorKey,
  displayBody,
  isNearBottom,
  isProgrammaticScroll,
  isWithinRateLimitWindow,
  scrollAnchorAdjustment,
  shouldFollowNewMessage,
  sortBySeq,
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
    hiddenReason: null,
    gameMasterEventId: null,
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
