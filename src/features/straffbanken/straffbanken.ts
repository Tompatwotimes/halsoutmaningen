/**
 * Straffbanken — presentation helpers for the offensive-penalty inventory,
 * milestones and the penalty-aware daily requirement. Pure and Swedish; the
 * database (`src/domain/penalties.ts` mirror) remains authoritative for
 * granting, requirement maths and assignment.
 */

import type { PenaltyType } from '@/domain/penalties';
import { PenaltyType as PT } from '@/domain/penalties';
import type { DayRequirement } from '@/features/challenge/types';
import type { EarnedPenaltyRow, PenaltyDefinitionRow } from './straffbank-api';

export interface InventoryItem {
  /** Stable key: definition id when known, else `type:value`. */
  key: string;
  displayName: string;
  type: PenaltyType;
  value: number;
  /** Count of `available` earned penalties of this kind. */
  count: number;
  /** One representative earned-penalty id to spend (the oldest available). */
  earnedPenaltyId: string;
}

/** Group a participant's available earned penalties by kind, oldest first. */
export function summarizeInventory(
  earned: readonly EarnedPenaltyRow[],
): InventoryItem[] {
  const byKey = new Map<string, InventoryItem>();
  const ordered = [...earned]
    .filter((e) => e.status === 'available')
    .sort((a, b) =>
      a.earnedOnDate < b.earnedOnDate
        ? -1
        : a.earnedOnDate > b.earnedOnDate
          ? 1
          : 0,
    );

  for (const e of ordered) {
    const key = `${e.penaltyType}:${String(e.value)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, {
        key,
        displayName: e.displayName,
        type: e.penaltyType,
        value: e.value,
        count: 1,
        earnedPenaltyId: e.id,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.value - b.value);
}

export function totalAvailable(earned: readonly EarnedPenaltyRow[]): number {
  return earned.filter((e) => e.status === 'available').length;
}

export interface NextMilestone {
  definition: PenaltyDefinitionRow;
  /** Consecutive completed days still needed. */
  daysAway: number;
}

/**
 * The nearest not-yet-reached milestone for a participant on their current
 * streak run. `null` when every active milestone is already at/below the
 * current streak.
 */
export function nextMilestone(
  definitions: readonly PenaltyDefinitionRow[],
  currentStreak: number,
): NextMilestone | null {
  const upcoming = definitions
    .filter((d) => d.active && d.unlockStreak > currentStreak)
    .sort((a, b) => a.unlockStreak - b.unlockStreak);
  const def = upcoming[0];
  if (!def) return null;
  return { definition: def, daysAway: def.unlockStreak - currentStreak };
}

export interface RequirementCopy {
  /** Short headline, e.g. "60 min" or "Dubbelpass". */
  headline: string;
  /** One-line detail of what the day needs. */
  detail: string;
  /** True when a penalty is in force. */
  penalised: boolean;
  /** The penalty's display name when penalised. */
  penaltyName: string | null;
}

/** Human description of a day's effective requirement. */
export function describeRequirement(req: DayRequirement): RequirementCopy {
  if (req.penaltyType === PT.DoubleSession) {
    return {
      headline: req.penaltyDisplayName ?? 'Dubbelpass',
      detail: `${String(req.requiredSessions)} separata pass, minst ${String(
        req.minMinutesPerSession,
      )} min var`,
      penalised: true,
      penaltyName: req.penaltyDisplayName,
    };
  }
  if (req.penaltyType === PT.MinimumMinutes) {
    return {
      headline: `${String(req.requiredMinutes)} min`,
      detail: `${req.penaltyDisplayName ?? 'Straff'} — minst ${String(
        req.requiredMinutes,
      )} min totalt idag`,
      penalised: true,
      penaltyName: req.penaltyDisplayName,
    };
  }
  return {
    headline: `${String(req.requiredMinutes)} min`,
    detail: `Dagens krav: minst ${String(req.requiredMinutes)} min`,
    penalised: false,
    penaltyName: null,
  };
}

/** "Pass 2 av 2" */
export function sessionCounterLabel(index: number, total: number): string {
  return `Pass ${String(index)} av ${String(total)}`;
}

export const PENALTY_TYPE_LABEL: Record<PenaltyType, string> = {
  [PT.MinimumMinutes]: 'Fler minuter',
  [PT.DoubleSession]: 'Dubbelpass',
};
