/**
 * The single canonical challenge-day state calculation.
 *
 * This mirrors the PostgreSQL implementation (docs/ARCHITECTURE.md §11) so the
 * frontend can render optimistically. It must never be re-implemented ad hoc
 * inside individual components — import from here.
 */

import type { ChallengeConfig } from './challenge';
import { compareDates } from './dates';
import { isDateEligible, type MembershipConfig } from './membership';

export const DayState = {
  Completed: 'completed',
  Pending: 'pending',
  Missed: 'missed',
  Future: 'future',
  NotParticipating: 'not_participating',
} as const;
export type DayState = (typeof DayState)[keyof typeof DayState];

/**
 * The minimal projection of a training entry needed to decide qualification.
 * `invalidated` covers admin correction (docs/PRODUCT_SPEC.md §12).
 */
export interface TrainingEntrySummary {
  durationMinutes: number;
  hasProof: boolean;
  invalidated?: boolean;
}

/** Whether an entry satisfies the challenge's completion rule. */
export function isQualifyingEntry(
  challenge: ChallengeConfig,
  entry: TrainingEntrySummary | null | undefined,
): boolean {
  if (!entry || entry.invalidated) return false;
  if (entry.durationMinutes < challenge.requiredMinutes) return false;
  if (challenge.proofRequired && !entry.hasProof) return false;
  return true;
}

export interface ComputeDayStateInput {
  challenge: ChallengeConfig;
  membership: MembershipConfig;
  /** The challenge day being evaluated. */
  date: string;
  /** "Today" as a plain date in the challenge timezone. */
  currentDate: string;
  /** The participant's canonical entry for `date`, if any. */
  entry: TrainingEntrySummary | null | undefined;
}

export function computeDayState(input: ComputeDayStateInput): DayState {
  const { challenge, membership, date, currentDate, entry } = input;

  if (!isDateEligible(challenge, membership, date)) {
    return DayState.NotParticipating;
  }
  if (isQualifyingEntry(challenge, entry)) {
    return DayState.Completed;
  }
  const relToToday = compareDates(date, currentDate);
  if (relToToday > 0) return DayState.Future;
  if (relToToday === 0) return DayState.Pending;
  return DayState.Missed;
}
