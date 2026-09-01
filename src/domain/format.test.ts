import { describe, expect, it } from 'vitest';
import {
  formatDayMonth,
  formatLongDate,
  formatMinutes,
  formatPercent,
  formatSek,
} from './format';

const norm = (s: string): string => s.replace(/\s/g, ' ');

describe('Swedish formatting', () => {
  it('formats SEK without decimals', () => {
    expect(norm(formatSek(6000))).toBe('6 000 kr');
    expect(norm(formatSek(50))).toBe('50 kr');
  });

  it('formats day + month in Swedish', () => {
    expect(formatDayMonth('2026-08-31')).toBe('31 augusti');
    expect(formatDayMonth('2026-11-28')).toBe('28 november');
  });

  it('formats a long date', () => {
    expect(formatLongDate('2026-08-01')).toBe('1 augusti 2026');
  });

  it('formats minutes and percentages', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatPercent(80.6)).toBe('81 %');
  });
});
