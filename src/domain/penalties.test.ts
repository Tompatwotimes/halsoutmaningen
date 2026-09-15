import { describe, expect, it } from 'vitest';
import {
  computeDailyRequirement,
  earnedMilestones,
  evaluateDay,
  PenaltyType,
  type ActivePenalty,
  type DayCompletion,
  type SessionSummary,
} from './penalties';
import { DEFAULT_PENALTY_DEFINITIONS } from '@/test/fixtures';

const base30 = { requiredMinutes: 30, proofRequired: true } as const;
const base30NoProof = { requiredMinutes: 30, proofRequired: false } as const;

const min45: ActivePenalty = {
  type: PenaltyType.MinimumMinutes,
  value: 45,
  displayName: '45-minutaren',
};
const min60: ActivePenalty = {
  type: PenaltyType.MinimumMinutes,
  value: 60,
  displayName: '60-minutaren',
};
const double: ActivePenalty = {
  type: PenaltyType.DoubleSession,
  value: 2,
  displayName: 'Dubbelpass',
};

function s(
  durationMinutes: number,
  hasProof = true,
  invalidated = false,
): SessionSummary {
  return { durationMinutes, hasProof, invalidated };
}

describe('computeDailyRequirement', () => {
  it('normal day = base minutes, one session, EACH qualifying session must independently reach the base', () => {
    expect(computeDailyRequirement(base30, null)).toEqual({
      requiredTotalMinutes: 30,
      requiredSessions: 1,
      minMinutesPerSession: 30,
      proofRequired: true,
      penalty: null,
    });
  });

  it('minimum_minutes raises BOTH the total-minutes bar AND the per-session floor to the same value', () => {
    expect(computeDailyRequirement(base30, min45)).toMatchObject({
      requiredTotalMinutes: 45,
      requiredSessions: 1,
      minMinutesPerSession: 45,
    });
    expect(computeDailyRequirement(base30, min60).requiredTotalMinutes).toBe(
      60,
    );
    expect(computeDailyRequirement(base30, min60).minMinutesPerSession).toBe(
      60,
    );
  });

  it('minimum_minutes never lowers the bar below the base', () => {
    const weak: ActivePenalty = { ...min45, value: 10 };
    expect(computeDailyRequirement(base30, weak).requiredTotalMinutes).toBe(30);
  });

  it('double_session requires N sessions each at the base minimum', () => {
    expect(computeDailyRequirement(base30, double)).toMatchObject({
      requiredTotalMinutes: 60,
      requiredSessions: 2,
      minMinutesPerSession: 30,
    });
  });
});

/**
 * DOMAIN RULE (voluntary multi-session days, v1.10.0): multiple short
 * sessions must NEVER be accumulated to complete a day. Completion requires
 * at least `requiredSessions` sessions that EACH individually reach
 * `minMinutesPerSession` — summing several sub-threshold sessions must never
 * satisfy it, for a normal day or any penalty.
 */
describe('evaluateDay — NORMAL day (base 30 min)', () => {
  const req = computeDailyRequirement(base30, null);

  it('30 -> completed', () => {
    expect(evaluateDay(req, [s(30)]).completed).toBe(true);
  });
  it('29 -> not completed', () => {
    expect(evaluateDay(req, [s(29)]).completed).toBe(false);
  });
  it('15+15 -> NOT completed (neither session individually qualifies)', () => {
    expect(evaluateDay(req, [s(15), s(15)]).completed).toBe(false);
  });
  it('20+25 -> NOT completed', () => {
    expect(evaluateDay(req, [s(20), s(25)]).completed).toBe(false);
  });
  it('15+35 -> completed (the 35-minute session qualifies alone)', () => {
    expect(evaluateDay(req, [s(15), s(35)]).completed).toBe(true);
  });
  it('30+20 -> completed', () => {
    expect(evaluateDay(req, [s(30), s(20)]).completed).toBe(true);
  });
  it('30+30+30 -> completed, and only ONE completed day (a single boolean, never multiplied)', () => {
    const result = evaluateDay(req, [s(30), s(30), s(30)]);
    expect(result.completed).toBe(true);
  });
  it('an unlimited number of extra sessions still resolves to one boolean', () => {
    const many = Array.from({ length: 10 }, () => s(5));
    expect(evaluateDay(req, many).completed).toBe(false);
    expect(evaluateDay(req, [...many, s(30)]).completed).toBe(true);
  });
  it('45 with no proof -> not completed (proof required)', () => {
    expect(evaluateDay(req, [s(45, false)]).completed).toBe(false);
  });
  it('proof is not required when the challenge does not require it', () => {
    const noProofReq = computeDailyRequirement(base30NoProof, null);
    expect(evaluateDay(noProofReq, [s(30, false)]).completed).toBe(true);
  });
  it('an invalidated session never contributes, even if long enough alone', () => {
    expect(evaluateDay(req, [s(45, true, true)]).completed).toBe(false);
    expect(
      evaluateDay(req, [s(45, true, true), s(30, true, false)]).completed,
    ).toBe(true);
  });
});

describe('evaluateDay — 45-minute penalty (minimum_minutes)', () => {
  const req = computeDailyRequirement(base30, min45);

  it('45 -> completed', () => {
    expect(evaluateDay(req, [s(45)]).completed).toBe(true);
  });
  it('30+15 -> NOT completed', () => {
    expect(evaluateDay(req, [s(30), s(15)]).completed).toBe(false);
  });
  it('20+25 -> NOT completed (neither session alone reaches 45)', () => {
    expect(evaluateDay(req, [s(20), s(25)]).completed).toBe(false);
  });
  it('45+10 -> completed (the 45-minute session qualifies alone)', () => {
    expect(evaluateDay(req, [s(45), s(10)]).completed).toBe(true);
  });
});

describe('evaluateDay — 60-minute penalty (minimum_minutes)', () => {
  const req = computeDailyRequirement(base30, min60);

  it('60 -> completed', () => {
    expect(evaluateDay(req, [s(60)]).completed).toBe(true);
  });
  it('30+30 -> NOT completed (neither session alone reaches 60)', () => {
    expect(evaluateDay(req, [s(30), s(30)]).completed).toBe(false);
  });
  it('45+15 -> NOT completed', () => {
    expect(evaluateDay(req, [s(45), s(15)]).completed).toBe(false);
  });
  it('60+20 -> completed', () => {
    expect(evaluateDay(req, [s(60), s(20)]).completed).toBe(true);
  });
  it('35 minutes alone is not enough', () => {
    expect(evaluateDay(req, [s(35)]).completed).toBe(false);
  });
});

describe('evaluateDay — double_session, base 30', () => {
  const req = computeDailyRequirement(base30, double);

  it('30+30 -> completed', () => {
    expect(evaluateDay(req, [s(30), s(30)]).completed).toBe(true);
  });
  it('60 as ONE session -> NOT completed', () => {
    const result = evaluateDay(req, [s(60)]);
    expect(result.completed).toBe(false);
    expect(result.contributingSessions).toBe(1);
  });
  it('45+15 -> NOT completed (the 15-minute session does not count as a session)', () => {
    expect(evaluateDay(req, [s(45), s(15)]).completed).toBe(false);
  });
  it('30+30+10 -> completed (the extra 10-minute session is harmless)', () => {
    expect(evaluateDay(req, [s(30), s(30), s(10)]).completed).toBe(true);
  });
  it('each session needs its own proof when proof is required', () => {
    expect(evaluateDay(req, [s(30, true), s(30, false)]).completed).toBe(false);
    expect(evaluateDay(req, [s(30, true), s(30, true)]).completed).toBe(true);
  });
});

describe('evaluateDay — statistics vs. completion are independent', () => {
  it('20+35: completed, and total training minutes include BOTH sessions (55), not just the qualifying one', () => {
    const req = computeDailyRequirement(base30, null);
    const result = evaluateDay(req, [s(20), s(35)]);
    expect(result.completed).toBe(true);
    expect(result.totalValidMinutes).toBe(55);
  });

  it('15+15: not completed, but the legitimate logged minutes still count for statistics (30)', () => {
    const req = computeDailyRequirement(base30, null);
    const result = evaluateDay(req, [s(15), s(15)]);
    expect(result.completed).toBe(false);
    expect(result.totalValidMinutes).toBe(30);
  });

  it('an unproven session (proof required) counts toward neither completion nor statistics', () => {
    const req = computeDailyRequirement(base30, null);
    const result = evaluateDay(req, [s(20), s(15, false)]);
    expect(result.totalValidMinutes).toBe(20);
  });

  it('an invalidated session counts toward neither completion nor statistics', () => {
    const req = computeDailyRequirement(base30, null);
    const result = evaluateDay(req, [s(20), s(15, true, true)]);
    expect(result.totalValidMinutes).toBe(20);
  });
});

describe('earnedMilestones — streak-run walk', () => {
  const defs = DEFAULT_PENALTY_DEFINITIONS; // 20 -> 45, 40 -> 60, 60 -> Dubbelpass

  function run(completedCount: number): DayCompletion[] {
    return Array.from({ length: completedCount }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      completed: true,
    }));
  }

  it('19 completed days earn nothing', () => {
    expect(earnedMilestones(run(19), defs)).toHaveLength(0);
  });

  it('day 20 earns exactly the 20-day milestone once', () => {
    const earned = earnedMilestones(run(20), defs);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({
      unlockStreak: 20,
      streakRunStart: '2026-08-01',
      earnedOnDate: '2026-08-20',
    });
  });

  it('re-running the walk over the same days yields the same set (idempotent)', () => {
    expect(earnedMilestones(run(25), defs)).toEqual(
      earnedMilestones(run(25), defs),
    );
  });

  it('day 40 and day 60 each earn their milestone within one run', () => {
    const earned = earnedMilestones(run(60), defs);
    expect(earned.map((e) => e.unlockStreak)).toEqual([20, 40, 60]);
    expect(earned.every((e) => e.streakRunStart === '2026-08-01')).toBe(true);
  });

  it('a broken streak then a new run may earn the same milestone again', () => {
    const days: DayCompletion[] = [
      ...run(20),
      { date: '2026-08-21', completed: false },
      ...Array.from({ length: 20 }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        completed: true,
      })),
    ];
    const earned = earnedMilestones(days, defs);
    expect(earned).toHaveLength(2);
    expect(earned[0]?.streakRunStart).toBe('2026-08-01');
    expect(earned[1]?.streakRunStart).toBe('2026-09-01');
    expect(earned[1]?.unlockStreak).toBe(20);
  });

  it('a non-completed day mid-sequence resets the run length', () => {
    const days: DayCompletion[] = [
      ...run(15),
      { date: '2026-08-16', completed: false },
      ...Array.from({ length: 10 }, (_, i) => ({
        date: `2026-08-${String(i + 17).padStart(2, '0')}`,
        completed: true,
      })),
    ];
    expect(earnedMilestones(days, defs)).toHaveLength(0);
  });

  it('ignores inactive definitions', () => {
    const inactive = defs.map((d) =>
      d.unlockStreak === 20 ? { ...d, active: false } : d,
    );
    expect(earnedMilestones(run(20), inactive)).toHaveLength(0);
  });
});
