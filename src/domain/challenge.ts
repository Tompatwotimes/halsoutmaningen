/**
 * Challenge configuration and values derived purely from it.
 *
 * Nothing about participant count, challenge length, dates, required minutes,
 * proof requirement or missed-day cost is hardcoded — it all lives in a
 * `ChallengeConfig` loaded from the database (CLAUDE.md §2, §3).
 */

import { enumerateDates, inclusiveDayCount, isPlainDate } from './dates';
import { isValidTimeZone } from './time';

export const ChallengeStatus = {
  Draft: 'draft',
  Active: 'active',
  Completed: 'completed',
  Archived: 'archived',
} as const;
export type ChallengeStatus =
  (typeof ChallengeStatus)[keyof typeof ChallengeStatus];

export interface ChallengeConfig {
  id: string;
  name: string;
  /** Inclusive first challenge day, plain date. */
  startDate: string;
  /** Inclusive last challenge day, plain date. */
  endDate: string;
  /** IANA timezone, e.g. "Europe/Stockholm". */
  timeZone: string;
  /** Minimum qualifying training duration per eligible day. */
  requiredMinutes: number;
  proofRequired: boolean;
  /** Cost applied per missed eligible day, in whole SEK. */
  missedDayCost: number;
  status: ChallengeStatus;
}

export function assertValidChallengeConfig(config: ChallengeConfig): void {
  const errors: string[] = [];
  if (!isPlainDate(config.startDate))
    errors.push('startDate is not a valid date');
  if (!isPlainDate(config.endDate)) errors.push('endDate is not a valid date');
  if (
    isPlainDate(config.startDate) &&
    isPlainDate(config.endDate) &&
    config.endDate < config.startDate
  ) {
    errors.push('endDate must be on or after startDate');
  }
  if (!isValidTimeZone(config.timeZone)) {
    errors.push(`timeZone "${config.timeZone}" is not a valid IANA zone`);
  }
  if (
    !Number.isInteger(config.requiredMinutes) ||
    config.requiredMinutes <= 0
  ) {
    errors.push('requiredMinutes must be a positive integer');
  }
  if (!Number.isFinite(config.missedDayCost) || config.missedDayCost < 0) {
    errors.push('missedDayCost must be >= 0');
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid challenge configuration:\n- ${errors.join('\n- ')}`,
    );
  }
}

/** Total calendar days in the challenge, inclusive of both endpoints. */
export function challengeDurationDays(config: ChallengeConfig): number {
  return inclusiveDayCount(config.startDate, config.endDate);
}

/** Every plain date in the challenge range — the full-matrix columns. */
export function challengeDates(config: ChallengeConfig): string[] {
  return enumerateDates(config.startDate, config.endDate);
}

/**
 * Maximum challenge liability for a participant eligible for the entire
 * challenge period. Late joiners have a lower applicable maximum — see
 * `maxApplicableLiability` in ./liability.ts.
 */
export function fullPeriodMaxLiability(config: ChallengeConfig): number {
  return challengeDurationDays(config) * config.missedDayCost;
}

export interface ChallengeProgress {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  /** 0-100, based on elapsed calendar days. */
  percentElapsed: number;
}

export function challengeProgress(
  config: ChallengeConfig,
  currentDate: string,
): ChallengeProgress {
  const totalDays = challengeDurationDays(config);
  let elapsedDays: number;
  if (currentDate < config.startDate) {
    elapsedDays = 0;
  } else if (currentDate > config.endDate) {
    elapsedDays = totalDays;
  } else {
    elapsedDays = inclusiveDayCount(config.startDate, currentDate);
  }
  const remainingDays = totalDays - elapsedDays;
  const percentElapsed =
    totalDays === 0 ? 0 : Math.round((elapsedDays / totalDays) * 100);
  return { totalDays, elapsedDays, remainingDays, percentElapsed };
}
