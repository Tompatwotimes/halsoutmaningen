/**
 * Challenge membership: the date-aware link between a participant and a
 * challenge. Eligibility is driven by the membership's participation window
 * intersected with the challenge range (CLAUDE.md §4, docs/ARCHITECTURE.md §6).
 *
 * Late joiners: days before `participationStartDate` are "not participating",
 * never missed. Early leavers: days after `participationEndDate` likewise.
 */

import type { ChallengeConfig } from './challenge';
import { enumerateDates, isWithin, maxDate, minDate } from './dates';

export interface MembershipConfig {
  userId: string;
  /** Plain date the participant's involvement begins. */
  participationStartDate: string;
  /** Plain date it ends (inclusive), or null for "through challenge end". */
  participationEndDate: string | null;
  /**
   * Administrative flag. An inactive membership is hidden from "today" and
   * dashboard lists, but its historical eligible days are still evaluated
   * (results are driven by the participation window, not this flag).
   */
  active: boolean;
}

/** First plain date this participant is evaluated on. */
export function effectiveEligibleStart(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
): string {
  return maxDate(challenge.startDate, membership.participationStartDate);
}

/** Last plain date this participant is evaluated on. */
export function effectiveEligibleEnd(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
): string {
  const membershipEnd = membership.participationEndDate ?? challenge.endDate;
  return minDate(challenge.endDate, membershipEnd);
}

/** True when the participation window overlaps the challenge range at all. */
export function hasEligibleOverlap(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
): boolean {
  return (
    effectiveEligibleStart(challenge, membership) <=
    effectiveEligibleEnd(challenge, membership)
  );
}

/** Whether a specific plain date falls in this participant's eligible window. */
export function isDateEligible(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
  date: string,
): boolean {
  if (!hasEligibleOverlap(challenge, membership)) return false;
  return isWithin(
    date,
    effectiveEligibleStart(challenge, membership),
    effectiveEligibleEnd(challenge, membership),
  );
}

/** Inclusive list of the participant's eligible plain dates. */
export function eligibleDates(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
): string[] {
  if (!hasEligibleOverlap(challenge, membership)) return [];
  return enumerateDates(
    effectiveEligibleStart(challenge, membership),
    effectiveEligibleEnd(challenge, membership),
  );
}

export function eligibleDayCount(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
): number {
  return eligibleDates(challenge, membership).length;
}
