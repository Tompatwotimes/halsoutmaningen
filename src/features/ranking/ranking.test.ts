import { describe, expect, it } from 'vitest';
import type { ParticipantView } from '@/features/challenge/types';
import { rankParticipants } from './ranking';

function view(over: Partial<ParticipantView>): ParticipantView {
  return {
    userId: 'u',
    displayName: 'Test',
    role: 'participant',
    isSelf: false,
    profileActive: true,
    membership: {
      userId: 'u',
      participationStartDate: '2026-08-01',
      participationEndDate: null,
      active: true,
    },
    membershipDisplay: {
      state: 'active',
      label: 'Aktiv',
      effectiveStart: '2026-08-01',
      effectiveEnd: '2026-11-28',
    },
    days: [],
    statesByDate: new Map(),
    requirementByDate: new Map(),
    todayState: null,
    todayRequirement: null,
    activeToday: true,
    currentStreak: 0,
    longestStreak: 0,
    completionRate: 0,
    decidedDays: 20,
    liability: {
      eligibleDays: 20,
      completedDays: 0,
      missedDays: 0,
      pendingDays: 0,
      futureDays: 0,
      maxApplicableLiability: 0,
      clearedAmount: 0,
      confirmedDebt: 0,
      remainingExposure: 0,
    },
    ...over,
  };
}

describe('rankParticipants (provisional)', () => {
  it('orders by completion rate, then fewer misses, then streak', () => {
    const a = view({ userId: 'a', displayName: 'A', completionRate: 0.9 });
    const b = view({ userId: 'b', displayName: 'B', completionRate: 0.95 });
    const c = view({
      userId: 'c',
      displayName: 'C',
      completionRate: 0.95,
      liability: { ...view({}).liability, missedDays: 1 },
    });

    const { ranked } = rankParticipants([a, b, c]);
    expect(ranked.map((r) => r.participant.userId)).toEqual(['b', 'c', 'a']);
    expect(ranked[0]?.rank).toBe(1);
  });

  it('does not place participants below the decided-days threshold', () => {
    const full = view({ userId: 'full', decidedDays: 30, completionRate: 0.5 });
    const fresh = view({ userId: 'fresh', decidedDays: 5, completionRate: 1 });

    const { ranked, unranked } = rankParticipants([fresh, full], 14);
    expect(ranked.map((r) => r.participant.userId)).toEqual(['full']);
    expect(unranked.map((p) => p.userId)).toEqual(['fresh']);
  });
});
