/**
 * Pure Weight Tracking helpers — no I/O.
 *
 * The lock is authoritative server-side (`start_weight_locked_at`, set once as
 * `first_saved_at + 24h`); these helpers only derive display state from an
 * already-fetched `lockedAt` value. `nowIso` is always passed in — never read
 * from the wall clock at call time — so components stay deterministic and
 * testable (spec §13).
 */

const MS_PER_HOUR = 3_600_000;

/**
 * `(latest - start) / start * 100`. Negative = weight lost (better in the
 * ranking). Spec §7.
 */
export function percentageChange(startKg: number, latestKg: number): number {
  return ((latestKg - startKg) / startKg) * 100;
}

/**
 * True once the 24-hour edit window has closed — i.e. a start weight exists
 * (`lockedAt !== null`) and `now >= lockedAt`. Before the lock, or when no
 * start weight has been set, the participant may still edit.
 */
export function isStartWeightLocked(
  lockedAt: string | null,
  nowIso: string,
): boolean {
  if (lockedAt === null) return false;
  return Date.parse(nowIso) >= Date.parse(lockedAt);
}

/**
 * Hours remaining in the edit window, for the "låses om Xh" countdown.
 * Clamped to >= 0 (never negative once locked).
 */
export function hoursUntilLock(lockedAt: string, nowIso: string): number {
  const remainingMs = Date.parse(lockedAt) - Date.parse(nowIso);
  return remainingMs <= 0 ? 0 : remainingMs / MS_PER_HOUR;
}
