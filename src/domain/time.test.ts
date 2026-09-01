import { describe, expect, it } from 'vitest';
import { currentPlainDateInTimeZone, isValidTimeZone } from './time';

describe('currentPlainDateInTimeZone', () => {
  it('resolves the local calendar day in the challenge zone', () => {
    // 2026-08-01 22:30 UTC is 2026-08-02 00:30 in Stockholm (CEST, +2).
    const instant = new Date('2026-08-01T22:30:00Z');
    expect(currentPlainDateInTimeZone('Europe/Stockholm', instant)).toBe(
      '2026-08-02',
    );
  });

  it('does not roll over before local midnight', () => {
    // 2026-08-01 21:30 UTC is 2026-08-01 23:30 in Stockholm.
    const instant = new Date('2026-08-01T21:30:00Z');
    expect(currentPlainDateInTimeZone('Europe/Stockholm', instant)).toBe(
      '2026-08-01',
    );
  });

  it('handles the standard-time offset after DST ends', () => {
    // DST ends 2026-10-25; afterwards Stockholm is UTC+1.
    // 2026-11-27 23:30 UTC -> 2026-11-28 00:30 local.
    const instant = new Date('2026-11-27T23:30:00Z');
    expect(currentPlainDateInTimeZone('Europe/Stockholm', instant)).toBe(
      '2026-11-28',
    );
  });

  it('differs from the UTC date near midnight', () => {
    const instant = new Date('2026-08-01T23:30:00Z');
    expect(currentPlainDateInTimeZone('UTC', instant)).toBe('2026-08-01');
    expect(currentPlainDateInTimeZone('Europe/Stockholm', instant)).toBe(
      '2026-08-02',
    );
  });

  it('throws for an invalid zone', () => {
    expect(() => currentPlainDateInTimeZone('Mars/Olympus')).toThrow();
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones and rejects nonsense', () => {
    expect(isValidTimeZone('Europe/Stockholm')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Nowhere/Nothing')).toBe(false);
  });
});
