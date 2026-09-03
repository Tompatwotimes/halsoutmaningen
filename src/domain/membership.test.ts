import { describe, expect, it } from 'vitest';
import {
  effectiveEligibleEnd,
  effectiveEligibleStart,
  eligibleDayCount,
  hasEligibleOverlap,
  isDateEligible,
  visibleRangeStart,
} from './membership';
import { firstChallenge, makeMembership } from '@/test/fixtures';

describe('full participation', () => {
  const m = makeMembership({ participationStartDate: '2026-08-01' });

  it('is eligible for all 120 days', () => {
    expect(eligibleDayCount(firstChallenge, m)).toBe(120);
    expect(effectiveEligibleStart(firstChallenge, m)).toBe('2026-08-01');
    expect(effectiveEligibleEnd(firstChallenge, m)).toBe('2026-11-28');
  });
});

describe('late join (Erik, 2026-08-20)', () => {
  const m = makeMembership({ participationStartDate: '2026-08-20' });

  it('clamps the eligible start to the join date', () => {
    expect(effectiveEligibleStart(firstChallenge, m)).toBe('2026-08-20');
  });

  it('treats days before the join as not eligible, not missed', () => {
    expect(isDateEligible(firstChallenge, m, '2026-08-19')).toBe(false);
    expect(isDateEligible(firstChallenge, m, '2026-08-20')).toBe(true);
  });

  it('has fewer eligible days than a full participant', () => {
    // 2026-08-20..2026-11-28 inclusive = 101 days.
    expect(eligibleDayCount(firstChallenge, m)).toBe(101);
  });
});

describe('early departure (Lisa, ends 2026-10-15)', () => {
  const m = makeMembership({
    participationStartDate: '2026-08-01',
    participationEndDate: '2026-10-15',
  });

  it('clamps the eligible end to the departure date', () => {
    expect(effectiveEligibleEnd(firstChallenge, m)).toBe('2026-10-15');
  });

  it('does not count days after departure as misses', () => {
    expect(isDateEligible(firstChallenge, m, '2026-10-15')).toBe(true);
    expect(isDateEligible(firstChallenge, m, '2026-10-16')).toBe(false);
  });
});

describe('visibleRangeStart', () => {
  const sepChallenge = { ...firstChallenge, startDate: '2026-09-01' };

  it('falls back to the challenge start date with no memberships', () => {
    expect(visibleRangeStart(sepChallenge, [])).toBe('2026-09-01');
  });

  it('clips forward to the earliest membership when everyone joins late', () => {
    const members = [
      makeMembership({ userId: 'a', participationStartDate: '2026-09-03' }),
      makeMembership({ userId: 'b', participationStartDate: '2026-09-03' }),
    ];
    expect(visibleRangeStart(sepChallenge, members)).toBe('2026-09-03');
  });

  it('never clips past the challenge start when at least one member starts then', () => {
    const members = [
      makeMembership({ userId: 'a', participationStartDate: '2026-09-01' }),
      makeMembership({ userId: 'b', participationStartDate: '2026-09-03' }),
    ];
    expect(visibleRangeStart(sepChallenge, members)).toBe('2026-09-01');
  });

  it('clips forward when the earliest membership starts after an early challenge start', () => {
    const members = [
      makeMembership({ userId: 'a', participationStartDate: '2026-08-15' }),
    ];
    // firstChallenge starts 2026-08-01; the only member joins on the 15th.
    expect(visibleRangeStart(firstChallenge, members)).toBe('2026-08-15');
  });

  it('never hides a date any given membership actually participated on', () => {
    const members = [
      makeMembership({ userId: 'a', participationStartDate: '2026-09-03' }),
      makeMembership({ userId: 'b', participationStartDate: '2026-09-10' }),
    ];
    const visible = visibleRangeStart(sepChallenge, members);
    for (const m of members) {
      expect(visible <= effectiveEligibleStart(sepChallenge, m)).toBe(true);
    }
  });
});

describe('no overlap with the challenge range', () => {
  const m = makeMembership({
    participationStartDate: '2025-01-01',
    participationEndDate: '2025-02-01',
  });

  it('reports no eligible overlap and zero eligible days', () => {
    expect(hasEligibleOverlap(firstChallenge, m)).toBe(false);
    expect(eligibleDayCount(firstChallenge, m)).toBe(0);
    expect(isDateEligible(firstChallenge, m, '2026-08-01')).toBe(false);
  });
});
