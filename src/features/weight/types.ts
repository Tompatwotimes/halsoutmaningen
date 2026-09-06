/**
 * Weight Tracking / Viktkampen — domain types.
 * Spec: docs/superpowers/specs/2026-09-05-weight-tracking-design.md
 *
 * Weight is completely independent of training: no proof image, no training
 * dependency, no coupling to day state / streak / liability / KASSAN / ranking.
 * `start_weight_first_saved_at` and `start_weight_locked_at` are set exactly
 * once (first save) and never move — the 24-hour edit window and its lock are
 * enforced server-side, never by a client timer.
 */

export interface WeightProfile {
  challengeId: string;
  userId: string;
  startWeightKg: number | null;
  /** Set once at the first successful start-weight save. Never moves. */
  startWeightFirstSavedAt: string | null;
  /** = firstSavedAt + 24h, set at the same moment. Never recomputed. */
  startWeightLockedAt: string | null;
  isWeightHidden: boolean;
  officialFinalWeightKg: number | null;
  officialFinalRecordedAt: string | null;
}

export interface WeightEntry {
  id: string;
  challengeId: string;
  userId: string;
  /** Always the challenge-local current date at write time. No backdating. */
  entryDate: string;
  weightKg: number;
}

/** One row of the public live Viktkampen ranking (`weight_public_ranking`). */
export interface WeightRankingRow {
  userId: string;
  displayName: string;
  startWeightKg: number;
  latestWeightKg: number;
  latestEntryDate: string;
  kgChange: number;
  percentageChange: number;
}

/** The official final result (`weight_final_result`), field-gated by disclosure. */
export interface WeightFinalResult {
  /** null until disclosed for a hidden winner (or the caller is winner/admin). */
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  winnerPercentageChange: number | null;
  disclosed: boolean;
}
