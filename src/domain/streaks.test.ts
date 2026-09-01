import { describe, expect, it } from 'vitest';
import { DayState } from './dayState';
import { currentStreak, longestStreak } from './streaks';

const C = DayState.Completed;
const M = DayState.Missed;
const P = DayState.Pending;
const F = DayState.Future;

describe('currentStreak', () => {
  it('counts a trailing run of completed days', () => {
    expect(currentStreak([C, M, C, C, C])).toBe(3);
  });

  it('skips a trailing pending day without breaking the streak', () => {
    expect(currentStreak([C, C, C, P])).toBe(3);
  });

  it('skips trailing future days', () => {
    expect(currentStreak([C, C, P, F, F])).toBe(2);
  });

  it('is 0 when the most recent decided day was missed', () => {
    expect(currentStreak([C, C, M])).toBe(0);
  });

  it('is 0 for an empty sequence', () => {
    expect(currentStreak([])).toBe(0);
  });
});

describe('longestStreak', () => {
  it('finds the longest completed run anywhere', () => {
    expect(longestStreak([C, C, M, C, C, C, M, C])).toBe(3);
  });

  it('is 0 when nothing is completed', () => {
    expect(longestStreak([M, M, P])).toBe(0);
  });
});
