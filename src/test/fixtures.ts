import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import type { MembershipConfig } from '@/domain/membership';
import type { SessionSummary } from '@/domain/penalties';
import {
  PenaltyType,
  type ActivePenalty,
  type PenaltyDefinition,
} from '@/domain/penalties';

/** The first challenge's configuration — as data, exactly as it will load. */
export const firstChallenge: ChallengeConfig = {
  id: 'challenge-1',
  name: 'Hälsoutmaningen 2026',
  description: null,
  startDate: '2026-08-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

export function makeMembership(
  overrides: Partial<MembershipConfig> = {},
): MembershipConfig {
  return {
    userId: 'user-1',
    participationStartDate: '2026-08-01',
    participationEndDate: null,
    active: true,
    ...overrides,
  };
}

/** A single session that on its own satisfies the base (30 min + proof) rule. */
export function qualifyingEntry(
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return { durationMinutes: 30, hasProof: true, ...overrides };
}

/** Build a `Map<date, sessions[]>` from a list of dates. */
export function sessionsFor(
  dates: string[],
  sessions: readonly SessionSummary[] = [qualifyingEntry()],
): Map<string, readonly SessionSummary[]> {
  return new Map(dates.map((d) => [d, sessions]));
}

export const DEFAULT_PENALTY_DEFINITIONS: PenaltyDefinition[] = [
  {
    id: 'def-45',
    unlockStreak: 20,
    type: PenaltyType.MinimumMinutes,
    value: 45,
    displayName: '45-minutaren',
    active: true,
    sortOrder: 1,
  },
  {
    id: 'def-60',
    unlockStreak: 40,
    type: PenaltyType.MinimumMinutes,
    value: 60,
    displayName: '60-minutaren',
    active: true,
    sortOrder: 2,
  },
  {
    id: 'def-double',
    unlockStreak: 60,
    type: PenaltyType.DoubleSession,
    value: 2,
    displayName: 'Dubbelpass',
    active: true,
    sortOrder: 3,
  },
];

export function activePenalty(
  overrides: Partial<ActivePenalty> = {},
): ActivePenalty {
  return {
    type: PenaltyType.MinimumMinutes,
    value: 60,
    displayName: '60-minutaren',
    fromUserId: 'user-2',
    ...overrides,
  };
}
