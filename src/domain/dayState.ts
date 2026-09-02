/**
 * The single canonical challenge-day state calculation.
 *
 * This mirrors the PostgreSQL implementation (`challenge_day_states`,
 * docs/ARCHITECTURE.md §11, docs/PHASE_9_PLATFORM.md) so the frontend can render
 * optimistically. It must never be re-implemented ad hoc inside individual
 * components — import from here.
 *
 * Phase 9: a challenge day can hold *multiple* training sessions, and an active
 * penalty can raise the day's requirement. Completion is decided by the shared
 * requirement engine in `./penalties`, never by a per-entry check in a screen.
 */

import type { ChallengeConfig } from './challenge';
import { compareDates } from './dates';
import { isDateEligible, type MembershipConfig } from './membership';
import {
  computeDailyRequirement,
  evaluateDay,
  type ActivePenalty,
  type DailyRequirement,
  type SessionSummary,
} from './penalties';

export const DayState = {
  Completed: 'completed',
  Pending: 'pending',
  Missed: 'missed',
  Future: 'future',
  NotParticipating: 'not_participating',
} as const;
export type DayState = (typeof DayState)[keyof typeof DayState];

/**
 * The minimal projection of a training session needed to decide qualification.
 * Retained name/shape for existing call sites; a day may have several of these.
 */
export type TrainingEntrySummary = SessionSummary;

/**
 * Whether a set of sessions satisfies the challenge's *normal* completion rule
 * for a day (no penalty). Kept for call sites that only need the base check.
 */
export function isQualifyingDay(
  challenge: ChallengeConfig,
  sessions: readonly SessionSummary[],
): boolean {
  return evaluateDay(computeDailyRequirement(challenge, null), sessions)
    .completed;
}

/**
 * Back-compat single-session helper: does this one session alone satisfy a
 * normal day? Equivalent to the pre-Phase-9 `isQualifyingEntry`.
 */
export function isQualifyingEntry(
  challenge: ChallengeConfig,
  entry: SessionSummary | null | undefined,
): boolean {
  if (!entry) return false;
  return isQualifyingDay(challenge, [entry]);
}

export interface ComputeDayStateInput {
  challenge: ChallengeConfig;
  membership: MembershipConfig;
  /** The challenge day being evaluated. */
  date: string;
  /** "Today" as a plain date in the challenge timezone. */
  currentDate: string;
  /** Every training session the participant logged for `date` (any status). */
  sessions: readonly SessionSummary[];
  /** The penalty in force against this participant on `date`, if any. */
  penalty?: ActivePenalty | null;
}

export interface DayStateResult {
  state: DayState;
  requirement: DailyRequirement;
  totalValidMinutes: number;
  contributingSessions: number;
  loggedSessions: number;
}

/** Full evaluation: state plus the requirement/totals that produced it. */
export function evaluateDayState(input: ComputeDayStateInput): DayStateResult {
  const { challenge, membership, date, currentDate, sessions } = input;
  const penalty = input.penalty ?? null;
  const requirement = computeDailyRequirement(challenge, penalty);
  const evaluation = evaluateDay(requirement, sessions);

  let state: DayState;
  if (!isDateEligible(challenge, membership, date)) {
    state = DayState.NotParticipating;
  } else if (evaluation.completed) {
    state = DayState.Completed;
  } else {
    const relToToday = compareDates(date, currentDate);
    if (relToToday > 0) state = DayState.Future;
    else if (relToToday === 0) state = DayState.Pending;
    else state = DayState.Missed;
  }

  return {
    state,
    requirement,
    totalValidMinutes: evaluation.totalValidMinutes,
    contributingSessions: evaluation.contributingSessions,
    loggedSessions: evaluation.loggedSessions,
  };
}

/** Canonical day state only. */
export function computeDayState(input: ComputeDayStateInput): DayState {
  return evaluateDayState(input).state;
}
