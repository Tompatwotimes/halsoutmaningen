import { describe, expect, it } from 'vitest';
import { PenaltyType } from '@/domain/penalties';
import type { DayRequirement } from '@/features/challenge/types';
import {
  describeRequirement,
  nextMilestone,
  sessionCounterLabel,
  summarizeInventory,
  totalAvailable,
} from './straffbanken';
import type { EarnedPenaltyRow, PenaltyDefinitionRow } from './straffbank-api';

function earned(over: Partial<EarnedPenaltyRow>): EarnedPenaltyRow {
  return {
    id: 'e1',
    challengeId: 'c1',
    penaltyDefinitionId: 'd1',
    streakRunStart: '2026-08-01',
    penaltyType: PenaltyType.MinimumMinutes,
    value: 45,
    displayName: '45-minutaren',
    earnedOnDate: '2026-08-20',
    status: 'available',
    spentAssignmentId: null,
    ...over,
  };
}

function def(over: Partial<PenaltyDefinitionRow>): PenaltyDefinitionRow {
  return {
    id: 'd1',
    challengeId: 'c1',
    unlockStreak: 20,
    penaltyType: PenaltyType.MinimumMinutes,
    value: 45,
    displayName: '45-minutaren',
    active: true,
    sortOrder: 1,
    ...over,
  };
}

function req(over: Partial<DayRequirement>): DayRequirement {
  return {
    requiredMinutes: 30,
    requiredSessions: 1,
    minMinutesPerSession: 0,
    penaltyType: null,
    penaltyDisplayName: null,
    penaltyFromUserId: null,
    sessionCount: 0,
    validSessionCount: 0,
    totalValidMinutes: 0,
    ...over,
  };
}

describe('summarizeInventory', () => {
  it('groups available earned penalties by kind and counts them', () => {
    const items = summarizeInventory([
      earned({ id: 'a', value: 45, displayName: '45-minutaren' }),
      earned({ id: 'b', value: 45, displayName: '45-minutaren' }),
      earned({ id: 'c', value: 60, displayName: '60-minutaren' }),
      earned({ id: 'd', value: 45, status: 'spent' }),
      earned({ id: 'e', value: 45, status: 'revoked' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      value: 45,
      count: 2,
      displayName: '45-minutaren',
    });
    expect(items[1]).toMatchObject({ value: 60, count: 1 });
    expect(totalAvailable).toBeTypeOf('function');
  });

  it('picks the oldest available earned penalty as the one to spend', () => {
    const items = summarizeInventory([
      earned({ id: 'newer', earnedOnDate: '2026-09-10' }),
      earned({ id: 'older', earnedOnDate: '2026-08-20' }),
    ]);
    expect(items[0]?.earnedPenaltyId).toBe('older');
  });

  it('totalAvailable ignores spent / expired / revoked', () => {
    expect(
      totalAvailable([
        earned({ status: 'available' }),
        earned({ status: 'spent' }),
        earned({ status: 'expired' }),
      ]),
    ).toBe(1);
  });
});

describe('nextMilestone', () => {
  const defs = [
    def({ id: 'd20', unlockStreak: 20 }),
    def({ id: 'd40', unlockStreak: 40, value: 60 }),
    def({
      id: 'd60',
      unlockStreak: 60,
      penaltyType: PenaltyType.DoubleSession,
      value: 2,
    }),
  ];

  it('returns the nearest not-yet-reached milestone', () => {
    const m = nextMilestone(defs, 12);
    expect(m?.definition.unlockStreak).toBe(20);
    expect(m?.daysAway).toBe(8);
  });

  it('advances past reached milestones', () => {
    expect(nextMilestone(defs, 25)?.definition.unlockStreak).toBe(40);
  });

  it('is null when every milestone is reached', () => {
    expect(nextMilestone(defs, 60)).toBeNull();
  });

  it('ignores inactive definitions', () => {
    const withInactive = defs.map((d) =>
      d.unlockStreak === 20 ? { ...d, active: false } : d,
    );
    expect(nextMilestone(withInactive, 5)?.definition.unlockStreak).toBe(40);
  });
});

describe('describeRequirement', () => {
  it('describes a normal day', () => {
    const c = describeRequirement(req({}));
    expect(c.penalised).toBe(false);
    expect(c.headline).toBe('30 min');
  });

  it('describes a minimum_minutes penalty day', () => {
    const c = describeRequirement(
      req({
        requiredMinutes: 60,
        penaltyType: PenaltyType.MinimumMinutes,
        penaltyDisplayName: '60-minutaren',
      }),
    );
    expect(c.penalised).toBe(true);
    expect(c.headline).toBe('60 min');
    expect(c.penaltyName).toBe('60-minutaren');
  });

  it('describes a double-session penalty day', () => {
    const c = describeRequirement(
      req({
        requiredMinutes: 60,
        requiredSessions: 2,
        minMinutesPerSession: 30,
        penaltyType: PenaltyType.DoubleSession,
        penaltyDisplayName: 'Dubbelpass',
      }),
    );
    expect(c.penalised).toBe(true);
    expect(c.headline).toBe('Dubbelpass');
    expect(c.detail).toContain('2 separata pass');
    expect(c.detail).toContain('30 min');
  });
});

describe('sessionCounterLabel', () => {
  it('formats the pass counter', () => {
    expect(sessionCounterLabel(1, 2)).toBe('Pass 1 av 2');
    expect(sessionCounterLabel(2, 2)).toBe('Pass 2 av 2');
  });
});
