import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import type { MembershipConfig } from '@/domain/membership';
import type { TrainingEntrySummary } from '@/domain/dayState';

/** The first challenge's configuration — as data, exactly as it will load. */
export const firstChallenge: ChallengeConfig = {
  id: 'challenge-1',
  name: 'Hälsoutmaningen 2026',
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

export function qualifyingEntry(
  overrides: Partial<TrainingEntrySummary> = {},
): TrainingEntrySummary {
  return { durationMinutes: 30, hasProof: true, ...overrides };
}

/** Build a `Map<date, entry>` from a list of qualifying dates. */
export function entriesFor(
  dates: string[],
  entry: TrainingEntrySummary = qualifyingEntry(),
): Map<string, TrainingEntrySummary> {
  return new Map(dates.map((d) => [d, entry]));
}
