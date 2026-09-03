import { describe, expect, it } from 'vitest';
import {
  effectiveEligibleEnd,
  effectiveEligibleStart,
  eligibleDayCount,
  hasEligibleOverlap,
  isDateEligible,
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
