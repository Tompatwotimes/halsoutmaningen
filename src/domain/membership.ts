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

/**
 * Earliest plain date genuinely worth *displaying* across a set of
 * memberships — a presentation-only clipping rule, never a challenge-
 * semantics one (CLAUDE.md §7 states are unchanged; this only trims leading
 * columns/weeks nobody could have participated on).
 *
 * Never earlier than the challenge start, and never later than any one of
 * the given memberships' own effective eligible start — so no date any of
 * them actually participated on is ever hidden. With no memberships it falls
 * back to the challenge start date.
 */
export function visibleRangeStart(
  challenge: ChallengeConfig,
  memberships: readonly MembershipConfig[],
): string {
  if (memberships.length === 0) return challenge.startDate;
  return memberships
    .map((m) => effectiveEligibleStart(challenge, m))
    .reduce((earliest, start) => minDate(earliest, start));
}
