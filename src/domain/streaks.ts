/**
 * Streak calculations over an ordered sequence of day states.
 *
 * Input must be ordered by challenge date ascending and contain only the
 * participant's eligible days (skip "not participating" days when building it).
 */

import { DayState } from './dayState';

/**
 * Consecutive completed days ending at the most recent decided day.
 *
 * A trailing "pending" (today, not yet done) neither extends nor breaks the
 * streak — it is skipped. Trailing "future" days are skipped. A "missed" day
 * ends the streak.
 */
export function currentStreak(states: readonly DayState[]): number {
  let streak = 0;
  for (let i = states.length - 1; i >= 0; i -= 1) {
    const state = states[i];
    if (state === DayState.Future || state === DayState.Pending) {
      continue;
    }
    if (state === DayState.Completed) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

/** Longest run of consecutive completed days anywhere in the sequence. */
export function longestStreak(states: readonly DayState[]): number {
  let longest = 0;
  let run = 0;
  for (const state of states) {
    if (state === DayState.Completed) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}
