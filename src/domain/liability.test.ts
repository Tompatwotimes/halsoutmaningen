import { describe, expect, it } from 'vitest';
import { DayState } from './dayState';
import {
  evaluateParticipant,
  summarizeLiability,
  tallyDayStates,
  totalKassan,
} from './liability';
import {
  sessionsFor,
  firstChallenge,
  makeMembership,
  qualifyingEntry,
  activePenalty,
} from '@/test/fixtures';
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

describe('totalKassan', () => {
  it('is zero for no participants', () => {
    expect(totalKassan([])).toBe(0);
  });

  it("is one participant's confirmed debt", () => {
    expect(totalKassan([150])).toBe(150);
  });

  it("sums multiple participants' confirmed debts", () => {
    expect(totalKassan([150, 50, 100])).toBe(300);
  });

  it(
    "sums straight from each participant's own confirmedDebt — completed, " +
      'pending, future and not-participating days contribute nothing, a ' +
      'penalised missed day contributes the same single missed_day_cost',
    () => {
      const missedDayCost = 50;
      const participants = [
        // All completed: 0.
        summarizeLiability(
          [DayState.Completed, DayState.Completed],
          missedDayCost,
        ),
        // Pending + future only: 0 (not yet decided, never a debt).
        summarizeLiability([DayState.Pending, DayState.Future], missedDayCost),
        // Not participating: 0, and excluded from eligibleDays entirely.
        summarizeLiability(
          [DayState.NotParticipating, DayState.NotParticipating],
          missedDayCost,
        ),
        // Two missed days, one of them under an active penalty at the
        // dayState layer — by the time it reaches liability it is simply
        // MISSED, costed exactly once, never a second "penalty charge".
        summarizeLiability([DayState.Missed, DayState.Missed], missedDayCost),
      ];

      expect(totalKassan(participants.map((p) => p.confirmedDebt))).toBe(
        2 * missedDayCost,
      );

      // No payment-related concept exists anywhere in the breakdown.
      for (const p of participants) {
        expect(Object.keys(p)).not.toContain('paid');
        expect(Object.keys(p)).not.toContain('outstanding');
      }
    },
  );
});

describe('evaluateParticipant', () => {
  it('a full participant who trains every past day so far has zero confirmed debt', () => {
    const membership = makeMembership();
    const past = enumerateDates('2026-08-01', '2026-08-31');
    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-09-01',
      sessionsByDate: sessionsFor(past),
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
      sessionsByDate: new Map(),
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
      sessionsByDate: new Map(),
    });
    expect(result.liability.confirmedDebt).toBe(0);
    expect(result.liability.futureDays).toBe(119);
    expect(result.liability.pendingDays).toBe(1);
  });

  it('a penalty day that meets the base rule but fails the penalty is still MISSED, costed once', () => {
    const membership = makeMembership();
    // 2026-08-10 has a 60-min penalty; the participant trained a normally-fine
    // 35 minutes. Every other past day is completed.
    const past = enumerateDates('2026-08-01', '2026-08-31');
    const sessionsByDate = new Map(
      past.map(
        (d) =>
          [
            d,
            d === '2026-08-10'
              ? [qualifyingEntry({ durationMinutes: 35 })]
              : [qualifyingEntry()],
          ] as const,
      ),
    );
    const penaltiesByDate = new Map([['2026-08-10', activePenalty()]]);

    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-09-01',
      sessionsByDate,
      penaltiesByDate,
    });

    expect(result.liability.missedDays).toBe(1);
    // one missed day × 50 SEK — the penalty never adds a second charge
    expect(result.liability.confirmedDebt).toBe(firstChallenge.missedDayCost);
    expect(result.days.find((d) => d.date === '2026-08-10')?.state).toBe(
      DayState.Missed,
    );
  });

  it('a penalty day whose enhanced requirement is met extends the streak normally', () => {
    const membership = makeMembership();
    const past = enumerateDates('2026-08-01', '2026-08-20');
    const sessionsByDate = new Map(
      past.map(
        (d) =>
          [
            d,
            d === '2026-08-15'
              ? [qualifyingEntry({ durationMinutes: 60 })]
              : [qualifyingEntry()],
          ] as const,
      ),
    );
    const penaltiesByDate = new Map([['2026-08-15', activePenalty()]]);

    const result = evaluateParticipant({
      challenge: firstChallenge,
      membership,
      currentDate: '2026-08-21',
      sessionsByDate,
      penaltiesByDate,
    });

    expect(result.liability.missedDays).toBe(0);
    expect(result.liability.completedDays).toBe(20);
  });
});
