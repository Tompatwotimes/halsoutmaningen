import { describe, expect, it } from 'vitest';
import {
  escalationMultiplier,
  intensityMultiplier,
  presentationForSeverity,
} from './game-master';

describe('game-master presentation', () => {
  it('uses micro for severity 1-2 and sheet for 3-5', () => {
    expect(presentationForSeverity(1)).toBe('micro');
    expect(presentationForSeverity(2)).toBe('micro');
    expect(presentationForSeverity(3)).toBe('sheet');
    expect(presentationForSeverity(4)).toBe('sheet');
    expect(presentationForSeverity(5)).toBe('sheet');
  });
});

describe('game-master intensity', () => {
  it('uses the approved multipliers', () => {
    expect(intensityMultiplier('low')).toBe(0.65);
    expect(intensityMultiplier('normal')).toBe(1);
    expect(intensityMultiplier('high')).toBe(1.35);
  });
});

describe('final escalation', () => {
  it('starts near 0.7 and approaches 1.7 at the finale', () => {
    expect(
      escalationMultiplier('2026-09-01', '2026-11-28', '2026-09-01'),
    ).toBeCloseTo(0.7, 4);
    expect(
      escalationMultiplier('2026-09-01', '2026-11-28', '2026-11-28'),
    ).toBeCloseTo(1.7, 4);
  });

  it('is a soft continuous curve: early < middle < late', () => {
    const early = escalationMultiplier(
      '2026-09-01',
      '2026-11-28',
      '2026-09-15',
    );
    const middle = escalationMultiplier(
      '2026-09-01',
      '2026-11-28',
      '2026-10-15',
    );
    const late = escalationMultiplier('2026-09-01', '2026-11-28', '2026-11-20');
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
  });

  it('clamps outside the challenge window', () => {
    expect(
      escalationMultiplier('2026-09-01', '2026-11-28', '2026-08-01'),
    ).toBeCloseTo(0.7, 4);
    expect(
      escalationMultiplier('2026-09-01', '2026-11-28', '2027-01-01'),
    ).toBeCloseTo(1.7, 4);
  });

  it('degrades safely when the range is empty', () => {
    expect(escalationMultiplier('2026-09-01', '2026-09-01', '2026-09-01')).toBe(
      1.7,
    );
  });
});
