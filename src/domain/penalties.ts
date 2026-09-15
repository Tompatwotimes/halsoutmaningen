/**
 * Straffbanken — the offensive gamification engine (Phase 9, docs/PHASE_9_PLATFORM.md).
 *
 * Pure, framework-free mirror of the PostgreSQL implementation. The database
 * remains authoritative for *granting* earned penalties and for *assigning*
 * them; this module is the shared truth for how a penalty changes a day's
 * training requirement and for the streak-run walk that decides what has been
 * earned. Every status surface must import the requirement from here rather
 * than re-deriving "how many minutes / sessions does today need".
 *
 * Domain principles it encodes:
 *  - There are no free passes. A penalty only ever makes *someone else's*
 *    requirement harder; it never reduces the target's SEK cost.
 *  - `minimum_minutes` raises the day's total-minutes bar; multiple valid
 *    sessions may add up to meet it.
 *  - `double_session` requires N genuinely separate sessions, each meeting the
 *    challenge's normal base minimum (and, when proof is required, each with its
 *    own proof). One long session never satisfies it.
 */

import type { ChallengeConfig } from './challenge';

export const PenaltyType = {
  /** Raise the required total valid minutes for the day. `value` = minutes. */
  MinimumMinutes: 'minimum_minutes',
  /** Require `value` separate qualifying sessions (value >= 2). */
  DoubleSession: 'double_session',
} as const;
export type PenaltyType = (typeof PenaltyType)[keyof typeof PenaltyType];

export const PENALTY_TYPES: readonly PenaltyType[] = [
  PenaltyType.MinimumMinutes,
  PenaltyType.DoubleSession,
];

/**
 * A configurable milestone on a challenge: reaching `unlockStreak` consecutive
 * completed days within one streak run earns this penalty as ammunition.
 */
export interface PenaltyDefinition {
  id: string;
  /** Consecutive completed days that earn this penalty. > 0. */
  unlockStreak: number;
  type: PenaltyType;
  /** `minimum_minutes`: minutes. `double_session`: session count (>= 2). */
  value: number;
  displayName: string;
  active: boolean;
  sortOrder: number;
}

/** A penalty currently in force against a participant on a specific day. */
export interface ActivePenalty {
  type: PenaltyType;
  value: number;
  displayName: string;
  /** The participant who assigned it, when known (for "Erik gav dig …"). */
  fromUserId?: string | null;
}

/** The minimal projection of one training session needed to evaluate a day. */
export interface SessionSummary {
  durationMinutes: number;
  hasProof: boolean;
  /** Admin-invalidated sessions never contribute to anything. */
  invalidated?: boolean;
}

export interface DailyRequirement {
  /** Sum of minutes across contributing sessions the day needs. */
  requiredTotalMinutes: number;
  /** Number of contributing sessions the day needs. */
  requiredSessions: number;
  /** Per-session minute floor to *count* as a contributing session (0 = none). */
  minMinutesPerSession: number;
  /** When true a session must carry its own proof to contribute. */
  proofRequired: boolean;
  /** The penalty in force, or null for a normal day. */
  penalty: ActivePenalty | null;
}

type RequirementChallenge = Pick<
  ChallengeConfig,
  'requiredMinutes' | 'proofRequired'
>;

/**
 * The one authoritative "what does this challenge day require" function.
 *
 * NORMAL (base B):        one session that ALONE reaches >= B
 * minimum_minutes V:      one session that ALONE reaches >= max(B,V)
 * double_session N:       >= N sessions that EACH alone reach >= B
 *
 * Multiple short sessions must NEVER be summed to manufacture a qualifying
 * one — `minMinutesPerSession` is the per-session floor every mode enforces
 * (v1.10.0 voluntary multi-session days; CLAUDE.md domain rules). A
 * participant may log any number of additional sessions in a day; extras
 * that do not individually clear this floor still count toward total
 * training-time statistics (see `evaluateDay`'s `totalValidMinutes`) but
 * never toward completion.
 */
export function computeDailyRequirement(
  challenge: RequirementChallenge,
  penalty: ActivePenalty | null | undefined,
): DailyRequirement {
  const base = challenge.requiredMinutes;

  if (!penalty) {
    return {
      requiredTotalMinutes: base,
      requiredSessions: 1,
      minMinutesPerSession: base,
      proofRequired: challenge.proofRequired,
      penalty: null,
    };
  }

  if (penalty.type === PenaltyType.MinimumMinutes) {
    const floor = Math.max(base, penalty.value);
    return {
      requiredTotalMinutes: floor,
      requiredSessions: 1,
      minMinutesPerSession: floor,
      proofRequired: challenge.proofRequired,
      penalty,
    };
  }

  // double_session
  const requiredSessions = Math.max(2, Math.trunc(penalty.value));
  return {
    requiredTotalMinutes: base * requiredSessions,
    requiredSessions,
    minMinutesPerSession: base,
    proofRequired: challenge.proofRequired,
    penalty,
  };
}

export interface DayEvaluation {
  /**
   * The enhanced (penalty-aware) requirement was met — decided ONLY by
   * individually-qualifying sessions (`sessionContributes`), never by
   * summing several sub-threshold ones.
   */
  completed: boolean;
  /** Sessions that ALONE meet the per-session floor (+ proof) — what decided `completed`. */
  contributingSessions: number;
  /**
   * TOTAL TRAINING TIME statistic: sum of minutes across every session that
   * is active and (when required) proofed — regardless of whether it
   * individually clears the per-session floor. A legitimate short "extra"
   * session still counts here even though it cannot complete the day alone;
   * this is deliberately NOT gated by `minMinutesPerSession` (that gate only
   * ever decides `completed`, never statistics).
   */
  totalValidMinutes: number;
  /** All sessions logged for the day, any status. */
  loggedSessions: number;
}

/**
 * Whether a single session, taken ALONE, satisfies `requirement`'s
 * per-session floor — the one and only test that decides completion.
 * Multiple sessions are never summed to pass this check.
 */
export function sessionContributes(
  requirement: DailyRequirement,
  session: SessionSummary,
): boolean {
  if (!sessionCountsForStatistics(requirement, session)) return false;
  return session.durationMinutes >= requirement.minMinutesPerSession;
}

/**
 * Whether a session counts toward TOTAL TRAINING TIME statistics at all:
 * active (not invalidated) and, when the challenge requires proof, carrying
 * its own proof. Deliberately has NO per-session duration floor — that is
 * what distinguishes it from `sessionContributes` (completion).
 */
export function sessionCountsForStatistics(
  requirement: DailyRequirement,
  session: SessionSummary,
): boolean {
  if (session.invalidated) return false;
  if (requirement.proofRequired && !session.hasProof) return false;
  return true;
}

/** Evaluate one participant-day against its requirement. */
export function evaluateDay(
  requirement: DailyRequirement,
  sessions: readonly SessionSummary[],
): DayEvaluation {
  const contributing = sessions.filter((s) =>
    sessionContributes(requirement, s),
  );
  const contributingMinutes = contributing.reduce(
    (sum, s) => sum + s.durationMinutes,
    0,
  );
  const statsSessions = sessions.filter((s) =>
    sessionCountsForStatistics(requirement, s),
  );
  const totalValidMinutes = statsSessions.reduce(
    (sum, s) => sum + s.durationMinutes,
    0,
  );
  return {
    completed:
      contributing.length >= requirement.requiredSessions &&
      contributingMinutes >= requirement.requiredTotalMinutes,
    contributingSessions: contributing.length,
    totalValidMinutes,
    loggedSessions: sessions.length,
  };
}

/**
 * One decided eligible day for the streak-run walk. Callers pass eligible days
 * ascending, up to and including "today"; a `pending`/`future` trailing day
 * should be passed as `completed: false` (it ends any run but earns nothing).
 */
export interface DayCompletion {
  date: string;
  completed: boolean;
}

export interface EarnedMilestone {
  definitionId: string;
  unlockStreak: number;
  /** First completed day of the streak run that earned it. */
  streakRunStart: string;
  /** The day whose completion reached the threshold. */
  earnedOnDate: string;
}

/**
 * The streak-run walk. A "streak run" is a maximal consecutive sequence of
 * completed eligible days; its identity is the date of its first completed day.
 * Reaching a definition's `unlockStreak` *within* one run earns that definition
 * exactly once for that run (`(definitionId, streakRunStart)` is the identity).
 * A later, separate run may earn the same milestones again.
 *
 * This is deterministic and idempotent: running it again over the same days
 * yields the same set. The database uses `(challenge, user, definition,
 * streak_run_start)` as a unique key so retries / reloads never double-grant.
 */
export function earnedMilestones(
  days: readonly DayCompletion[],
  definitions: readonly PenaltyDefinition[],
): EarnedMilestone[] {
  const active = definitions.filter((d) => d.active && d.unlockStreak > 0);
  const earned: EarnedMilestone[] = [];

  let runStart: string | null = null;
  let runLength = 0;

  for (const day of days) {
    if (!day.completed) {
      runStart = null;
      runLength = 0;
      continue;
    }
    if (runLength === 0) runStart = day.date;
    runLength += 1;
    for (const def of active) {
      if (def.unlockStreak === runLength && runStart !== null) {
        earned.push({
          definitionId: def.id,
          unlockStreak: def.unlockStreak,
          streakRunStart: runStart,
          earnedOnDate: day.date,
        });
      }
    }
  }

  return earned;
}
