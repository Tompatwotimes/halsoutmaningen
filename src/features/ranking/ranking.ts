import type { ParticipantView } from '@/features/challenge/types';

/**
 * PROVISIONAL ranking.
 *
 * The competitive formula is deliberately not finalised (docs/PRODUCT_SPEC.md
 * §17, IMPLEMENTATION_PLAN §1.5). This helper produces a reasonable, clearly
 * labelled ordering for the UI and nothing here should be treated as the
 * permanent scoring rule. When the formula is ratified it becomes a single
 * SQL view and this module is replaced.
 *
 * Current provisional order:
 *   1. completion rate (completed / decided days) — fair to late joiners
 *   2. fewer confirmed missed days
 *   3. longer current streak
 *   4. name
 *
 * Participants with fewer than `minDecidedDays` decided days are shown but not
 * placed competitively ("för få dagar").
 */

export interface RankedRow {
  rank: number;
  participant: ParticipantView;
}

export interface RankingResult {
  ranked: RankedRow[];
  unranked: ParticipantView[];
  minDecidedDays: number;
}

export function rankParticipants(
  participants: readonly ParticipantView[],
  minDecidedDays = 14,
): RankingResult {
  const eligible: ParticipantView[] = [];
  const unranked: ParticipantView[] = [];

  for (const p of participants) {
    if (p.decidedDays >= minDecidedDays) eligible.push(p);
    else unranked.push(p);
  }

  eligible.sort((a, b) => {
    if (b.completionRate !== a.completionRate) {
      return b.completionRate - a.completionRate;
    }
    if (a.liability.missedDays !== b.liability.missedDays) {
      return a.liability.missedDays - b.liability.missedDays;
    }
    if (b.currentStreak !== a.currentStreak) {
      return b.currentStreak - a.currentStreak;
    }
    return a.displayName.localeCompare(b.displayName, 'sv');
  });

  unranked.sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'));

  return {
    ranked: eligible.map((participant, i) => ({ rank: i + 1, participant })),
    unranked,
    minDecidedDays,
  };
}
