import type { GameMasterIntensity, GameMasterSeverity } from './types';
import type { GameMasterPresentation } from './types';

/**
 * Pure GM1 presentation / scoring helpers. No I/O, no Supabase — these mirror
 * the server-side formulas (spec §4, §17) so the browser can reason about how
 * an event will be shown without a round trip.
 *
 * The authoritative scoring, cooldowns and randomness all live in Postgres;
 * `intensityMultiplier` / `escalationMultiplier` are duplicated here only for
 * display and tests.
 */

/** Severity 1–2 → non-blocking micro banner; 3–5 → Sheet ambush (spec §17). */
export function presentationForSeverity(
  severity: GameMasterSeverity,
): GameMasterPresentation {
  return severity <= 2 ? 'micro' : 'sheet';
}

/** Admin intensity knob (spec §4). */
export function intensityMultiplier(intensity: GameMasterIntensity): number {
  if (intensity === 'low') return 0.65;
  if (intensity === 'high') return 1.35;
  return 1;
}

/**
 * Final escalation curve (spec §4): `escalation = 0.7 + p²` where `p` is
 * challenge progress in [0, 1]. Early = quiet, finale ≈ 1.7. `today` outside the
 * window is clamped; a degenerate (empty) range returns the finale value.
 */
export function escalationMultiplier(
  startDate: string,
  endDate: string,
  today: string,
): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 1.7;
  }
  const p = Math.max(0, Math.min(1, (current - start) / (end - start)));
  return 0.7 + p * p;
}
