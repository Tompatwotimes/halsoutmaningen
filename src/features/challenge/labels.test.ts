import { describe, expect, it } from 'vitest';
import { recentDates, relativeDayLabel, weekdayShort } from './labels';

describe('relativeDayLabel', () => {
  it('names today, yesterday and tomorrow', () => {
    expect(relativeDayLabel('2026-09-01', '2026-09-01')).toBe('Idag');
    expect(relativeDayLabel('2026-08-31', '2026-09-01')).toBe('Igår');
    expect(relativeDayLabel('2026-09-02', '2026-09-01')).toBe('Imorgon');
  });

  it('uses a short weekday within the past week', () => {
    // 2026-08-28 is a Friday
    expect(relativeDayLabel('2026-08-28', '2026-09-01')).toBe('Fre');
  });

  it('falls back to d/m further out', () => {
    expect(relativeDayLabel('2026-07-10', '2026-09-01')).toBe('10/7');
  });
});

describe('recentDates', () => {
  it('returns the last N dates ending at today, oldest first', () => {
    expect(recentDates('2026-09-01', 3, '2026-08-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('never returns a date before the challenge start', () => {
    expect(recentDates('2026-08-02', 5, '2026-08-01')).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

describe('weekdayShort', () => {
  it('maps a known date', () => {
    // 2026-08-01 is a Saturday
    expect(weekdayShort('2026-08-01')).toBe('lör');
  });
});
