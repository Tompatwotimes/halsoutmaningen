/**
 * Financial challenge liability, derived from day states — never from
 * frontend-supplied totals (CLAUDE.md §9, §17; docs/ARCHITECTURE.md §16).
 *
 * These helpers are pure and shared; the authoritative figures for anything
 * user-facing as "debt" are produced by PostgreSQL.
 */

import type { ChallengeConfig } from './challenge';
import { computeDayState, DayState } from './dayState';
import { eligibleDates, type MembershipConfig } from './membership';
import type { ActivePenalty, SessionSummary } from './penalties';

export interface DayStateTotals {
  eligibleDays: number;
  completedDays: number;
  missedDays: number;
  pendingDays: number;
  futureDays: number;
}

export interface LiabilityBreakdown extends DayStateTotals {
  /** eligibleDays × missedDayCost. */
  maxApplicableLiability: number;
  /** completedDays × missedDayCost. */
  clearedAmount: number;
  /** Past missed eligible days × missedDayCost. */
  confirmedDebt: number;
  /** (pendingDays + futureDays) × missedDayCost — not yet decided. */
  remainingExposure: number;
}

export function tallyDayStates(states: readonly DayState[]): DayStateTotals {
  const totals: DayStateTotals = {
    eligibleDays: 0,
    completedDays: 0,
    missedDays: 0,
    pendingDays: 0,
    futureDays: 0,
  };
  for (const state of states) {
    switch (state) {
      case DayState.Completed:
        totals.completedDays += 1;
        totals.eligibleDays += 1;
        break;
      case DayState.Missed:
        totals.missedDays += 1;
        totals.eligibleDays += 1;
        break;
      case DayState.Pending:
        totals.pendingDays += 1;
        totals.eligibleDays += 1;
        break;
      case DayState.Future:
        totals.futureDays += 1;
        totals.eligibleDays += 1;
        break;
      case DayState.NotParticipating:
        break;
    }
  }
  return totals;
}

export function summarizeLiability(
  states: readonly DayState[],
  missedDayCost: number,
): LiabilityBreakdown {
  const totals = tallyDayStates(states);
  return {
    ...totals,
    maxApplicableLiability: totals.eligibleDays * missedDayCost,
    clearedAmount: totals.completedDays * missedDayCost,
    confirmedDebt: totals.missedDays * missedDayCost,
    remainingExposure: (totals.pendingDays + totals.futureDays) * missedDayCost,
  };
}

export interface ParticipantEvaluationInput {
  challenge: ChallengeConfig;
  membership: MembershipConfig;
  currentDate: string;
  /** Every training session per plain date (`YYYY-MM-DD` -> sessions[]). */
  sessionsByDate: ReadonlyMap<string, readonly SessionSummary[]>;
  /** Active penalty per plain date, when the participant has one. */
  penaltiesByDate?: ReadonlyMap<string, ActivePenalty>;
}

export interface ParticipantEvaluation {
  /** Day state per eligible plain date, ordered ascending. */
  days: { date: string; state: DayState }[];
  states: DayState[];
  liability: LiabilityBreakdown;
}

/**
 * The single reusable per-participant evaluation: walk every eligible day,
 * compute its canonical state, and summarize. Feed the result to streak and
 * ranking helpers so they all agree.
 */
export function evaluateParticipant(
  input: ParticipantEvaluationInput,
): ParticipantEvaluation {
  const { challenge, membership, currentDate, sessionsByDate } = input;
  const penaltiesByDate = input.penaltiesByDate;
  const days = eligibleDates(challenge, membership).map((date) => ({
    date,
    state: computeDayState({
      challenge,
      membership,
      date,
      currentDate,
      sessions: sessionsByDate.get(date) ?? [],
      penalty: penaltiesByDate?.get(date) ?? null,
    }),
  }));
  const states = days.map((d) => d.state);
  return {
    days,
    states,
    liability: summarizeLiability(states, challenge.missedDayCost),
  };
}
