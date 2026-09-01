import { describe, expect, it } from 'vitest';
import {
  assertValidChallengeConfig,
  challengeDates,
  challengeDurationDays,
  challengeProgress,
  fullPeriodMaxLiability,
} from './challenge';
import { firstChallenge } from '@/test/fixtures';

describe('challenge derived values', () => {
  it('derives 120 days for the first challenge', () => {
    expect(challengeDurationDays(firstChallenge)).toBe(120);
  });

  it('derives one matrix column per challenge day', () => {
    const cols = challengeDates(firstChallenge);
    expect(cols).toHaveLength(120);
    expect(cols[0]).toBe('2026-08-01');
    expect(cols.at(-1)).toBe('2026-11-28');
  });

  it('computes the full-period maximum liability as 6000 SEK', () => {
    expect(fullPeriodMaxLiability(firstChallenge)).toBe(6000);
  });

  it('adapts to a different future challenge without code changes', () => {
    const future = {
      ...firstChallenge,
      startDate: '2027-09-01',
      endDate: '2027-10-15',
      requiredMinutes: 45,
      missedDayCost: 25,
    };
    expect(challengeDurationDays(future)).toBe(45);
    expect(fullPeriodMaxLiability(future)).toBe(45 * 25);
  });
});

describe('challengeProgress', () => {
  it('is 0 before the challenge starts', () => {
    expect(challengeProgress(firstChallenge, '2026-07-01')).toMatchObject({
      elapsedDays: 0,
      remainingDays: 120,
      percentElapsed: 0,
    });
  });

  it('counts elapsed days inclusively during the challenge', () => {
    expect(challengeProgress(firstChallenge, '2026-08-01')).toMatchObject({
      elapsedDays: 1,
      remainingDays: 119,
    });
  });

  it('caps at the total after the challenge ends', () => {
    expect(challengeProgress(firstChallenge, '2027-01-01')).toMatchObject({
      elapsedDays: 120,
      remainingDays: 0,
      percentElapsed: 100,
    });
  });
});

describe('assertValidChallengeConfig', () => {
  it('accepts a valid config', () => {
    expect(() => assertValidChallengeConfig(firstChallenge)).not.toThrow();
  });

  it('rejects end before start', () => {
    expect(() =>
      assertValidChallengeConfig({ ...firstChallenge, endDate: '2026-07-01' }),
    ).toThrow(/endDate/);
  });

  it('rejects a non-positive required minutes', () => {
    expect(() =>
      assertValidChallengeConfig({ ...firstChallenge, requiredMinutes: 0 }),
    ).toThrow(/requiredMinutes/);
  });

  it('rejects an invalid timezone', () => {
    expect(() =>
      assertValidChallengeConfig({
        ...firstChallenge,
        timeZone: 'Europe/Nowhere',
      }),
    ).toThrow(/IANA/);
  });
});
