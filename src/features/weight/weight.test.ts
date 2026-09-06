import { describe, expect, it } from 'vitest';
import {
  hoursUntilLock,
  isStartWeightLocked,
  percentageChange,
} from './weight';

describe('percentageChange', () => {
  it('matches the spec example: 82.0 -> 78.7 is approximately -4.02%', () => {
    expect(percentageChange(82.0, 78.7)).toBeCloseTo(-4.02, 1);
  });
  it('is positive for a weight gain', () => {
    expect(percentageChange(80, 84)).toBeCloseTo(5, 4);
  });
  it('is zero when weight is unchanged', () => {
    expect(percentageChange(80, 80)).toBe(0);
  });
});

describe('isStartWeightLocked', () => {
  it('is false before lockedAt', () => {
    expect(
      isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T11:59:59Z'),
    ).toBe(false);
  });
  it('is true exactly at and after lockedAt', () => {
    expect(
      isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z'),
    ).toBe(true);
    expect(
      isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T12:00:01Z'),
    ).toBe(true);
  });
  it('is false when no start weight has been set yet', () => {
    expect(isStartWeightLocked(null, '2026-09-06T12:00:00Z')).toBe(false);
  });
});

describe('hoursUntilLock', () => {
  it('counts down from 24 toward 0', () => {
    expect(
      hoursUntilLock('2026-09-06T12:00:00Z', '2026-09-05T18:00:00Z'),
    ).toBeCloseTo(18, 1);
  });
  it('never goes negative once locked', () => {
    expect(hoursUntilLock('2026-09-06T12:00:00Z', '2026-09-07T00:00:00Z')).toBe(
      0,
    );
  });
});
