import { describe, expect, it } from 'vitest';
import {
  chatDateSeparatorKey,
  displayBody,
  isWithinRateLimitWindow,
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
    body: 'hej',
    status: 'active',
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
