import { describe, expect, it } from 'vitest';
import { DayState } from './dayState';
import {
  evaluateParticipant,
  summarizeLiability,
  tallyDayStates,
} from './liability';
import { entriesFor, firstChallenge, makeMembership } from '@/test/fixtures';
import { enumerateDates } from './dates';

describe('summarizeLiability', () => {
  it('splits confirmed debt from future exposure', () => {
    const states = [
      DayState.Completed,
      DayState.Completed,
      DayState.Missed,
      DayState.Pending,
      DayState.Future,
      DayState.NotParticipating,
    ];
    expect(summarizeLiability(states, 50)).toEqual({
      eligibleDays: 5,
      completedDays: 2,
      missedDays: 1,
      pendingDays: 1,
      futureDays: 1,
      maxApplicableLiability: 250,
      clearedAmount: 100,
      confirmedDebt: 50,
      remainingExposure: 100,
    });
  });

  it('excludes not-participating days from every figure', () => {
    const totals = tallyDayStates([
      DayState.NotParticipating,
      DayState.NotParticipating,
    ]);
    expect(totals.eligibleDays).toBe(0);
  });
});

describe('evaluateParticipant', () => {
  it('a full participant who trains every past day so far has zero confirmed debt', () => {
    const membership = makeMembership();
    const past = enumerateDates('2026-08-01', '2026-08-31');
    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-09-01',
      entriesByDate: entriesFor(past),
    });
    expect(result.liability.confirmedDebt).toBe(0);
    expect(result.liability.completedDays).toBe(31);
    expect(result.liability.pendingDays).toBe(1); // 2026-09-01
    expect(result.liability.eligibleDays).toBe(120);
    expect(result.liability.maxApplicableLiability).toBe(6000);
  });

  it('a late joiner has a lower applicable maximum', () => {
    const membership = makeMembership({ participationStartDate: '2026-08-20' });
    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-09-01',
      entriesByDate: new Map(),
    });
    // 2026-08-20..2026-11-28 = 101 eligible days.
    expect(result.liability.eligibleDays).toBe(101);
    expect(result.liability.maxApplicableLiability).toBe(101 * 50);
    // 2026-08-20..2026-08-31 = 12 missed days before "today".
    expect(result.liability.missedDays).toBe(12);
    expect(result.liability.confirmedDebt).toBe(600);
  });

  it('does not count future days as debt', () => {
    const membership = makeMembership();
    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-08-01',
      entriesByDate: new Map(),
    });
    expect(result.liability.confirmedDebt).toBe(0);
    expect(result.liability.futureDays).toBe(119);
    expect(result.liability.pendingDays).toBe(1);
  });
});
