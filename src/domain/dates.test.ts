import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  diffDays,
  enumerateDates,
  inclusiveDayCount,
  isPlainDate,
  isWithin,
  maxDate,
  minDate,
} from './dates';

describe('isPlainDate', () => {
  it('accepts valid ISO dates', () => {
    expect(isPlainDate('2026-08-01')).toBe(true);
    expect(isPlainDate('2026-11-28')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isPlainDate('2026-8-1')).toBe(false);
    expect(isPlainDate('2026-13-01')).toBe(false);
    expect(isPlainDate('2026-02-30')).toBe(false);
    expect(isPlainDate('not-a-date')).toBe(false);
    expect(isPlainDate('2026-08-01T00:00:00Z')).toBe(false);
  });
});

describe('inclusiveDayCount', () => {
  it('counts the first challenge: 2026-08-01..2026-11-28 = 120', () => {
    expect(inclusiveDayCount('2026-08-01', '2026-11-28')).toBe(120);
  });

  it('counts a single day as 1', () => {
    expect(inclusiveDayCount('2026-08-01', '2026-08-01')).toBe(1);
  });

  it('counts the spec future example 2027-08-01..2027-11-30 = 122', () => {
    expect(inclusiveDayCount('2027-08-01', '2027-11-30')).toBe(122);
  });

  it('is unaffected by the Europe/Stockholm DST transition', () => {
    // DST ends 2026-10-25 in Sweden.
    expect(inclusiveDayCount('2026-10-24', '2026-10-26')).toBe(3);
  });

  it('returns 0 when end precedes start', () => {
    expect(inclusiveDayCount('2026-08-02', '2026-08-01')).toBe(0);
  });
});

describe('addDays / diffDays', () => {
  it('adds across month boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('adds across the DST boundary correctly', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('diffDays is signed', () => {
    expect(diffDays('2026-08-01', '2026-08-01')).toBe(0);
    expect(diffDays('2026-08-01', '2026-11-28')).toBe(119);
    expect(diffDays('2026-11-28', '2026-08-01')).toBe(-119);
  });
});

describe('compare / min / max / isWithin', () => {
  it('compares chronologically', () => {
    expect(compareDates('2026-08-01', '2026-08-02')).toBe(-1);
    expect(compareDates('2026-08-02', '2026-08-01')).toBe(1);
    expect(compareDates('2026-08-01', '2026-08-01')).toBe(0);
  });

  it('min/max pick the right endpoint', () => {
    expect(minDate('2026-08-20', '2026-08-01')).toBe('2026-08-01');
    expect(maxDate('2026-08-20', '2026-08-01')).toBe('2026-08-20');
  });

  it('isWithin is inclusive', () => {
    expect(isWithin('2026-08-01', '2026-08-01', '2026-11-28')).toBe(true);
    expect(isWithin('2026-11-28', '2026-08-01', '2026-11-28')).toBe(true);
    expect(isWithin('2026-07-31', '2026-08-01', '2026-11-28')).toBe(false);
  });
});

describe('enumerateDates', () => {
  it('produces an inclusive, ordered list', () => {
    expect(enumerateDates('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('has length equal to inclusiveDayCount for the full challenge', () => {
    expect(enumerateDates('2026-08-01', '2026-11-28')).toHaveLength(120);
  });
});
