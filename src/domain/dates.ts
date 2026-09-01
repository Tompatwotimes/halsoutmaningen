/**
 * Plain calendar-date utilities.
 *
 * A "plain date" is an ISO `YYYY-MM-DD` string with no time and no timezone,
 * mirroring the PostgreSQL `date` type. Challenge-day semantics are always
 * expressed in plain dates so that daylight-saving transitions in a
 * challenge's timezone can never shift a day (see docs/ARCHITECTURE.md §8, §12).
 *
 * All arithmetic here treats a plain date as midnight UTC purely as a stable
 * counting anchor; the resulting `Date` objects must not be formatted for
 * display.
 */

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface PlainDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function isPlainDate(value: string): boolean {
  if (!PLAIN_DATE_RE.test(value)) return false;
  const parts = splitParts(value);
  const asDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    asDate.getUTCFullYear() === parts.year &&
    asDate.getUTCMonth() === parts.month - 1 &&
    asDate.getUTCDate() === parts.day
  );
}

function splitParts(value: string): PlainDateParts {
  const [y, m, d] = value.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

export function parsePlainDate(value: string): PlainDateParts {
  assertPlainDate(value);
  return splitParts(value);
}

export function assertPlainDate(value: string): void {
  if (!isPlainDate(value)) {
    throw new RangeError(
      `Invalid plain date: "${value}" (expected YYYY-MM-DD)`,
    );
  }
}

function toUTCms(value: string): number {
  const { year, month, day } = parsePlainDate(value);
  return Date.UTC(year, month - 1, day);
}

function fromUTCms(ms: number): string {
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Days from `a` to `b`; positive when `b` is later. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTCms(b) - toUTCms(a)) / MS_PER_DAY);
}

export function addDays(value: string, amount: number): string {
  return fromUTCms(toUTCms(value) + amount * MS_PER_DAY);
}

/** -1, 0 or 1. */
export function compareDates(a: string, b: string): -1 | 0 | 1 {
  const da = toUTCms(a);
  const db = toUTCms(b);
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

export function minDate(a: string, b: string): string {
  return compareDates(a, b) <= 0 ? a : b;
}

export function maxDate(a: string, b: string): string {
  return compareDates(a, b) >= 0 ? a : b;
}

export function isWithin(value: string, start: string, end: string): boolean {
  return compareDates(value, start) >= 0 && compareDates(value, end) <= 0;
}

/** Inclusive day count, e.g. 2026-08-01..2026-11-28 -> 120. */
export function inclusiveDayCount(start: string, end: string): number {
  const count = diffDays(start, end) + 1;
  return count > 0 ? count : 0;
}

/** Inclusive list of plain dates from `start` to `end`. */
export function enumerateDates(start: string, end: string): string[] {
  const total = inclusiveDayCount(start, end);
  const dates: string[] = [];
  for (let i = 0; i < total; i += 1) {
    dates.push(addDays(start, i));
  }
  return dates;
}
