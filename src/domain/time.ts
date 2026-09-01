/**
 * Timezone-aware "what day is it" resolution.
 *
 * A challenge's current day must be derived from wall-clock time in the
 * challenge's configured timezone, never from the browser's local date or a
 * raw UTC date. This matters most around midnight (docs/ARCHITECTURE.md §12).
 *
 * The authoritative "current challenge date" is computed by PostgreSQL; this
 * module gives the frontend a matching value for optimistic rendering and is
 * covered by tests for the boundary cases.
 */

import { assertPlainDate } from './dates';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // Throws RangeError for an invalid IANA zone — surface that to the caller.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** The plain date (`YYYY-MM-DD`) currently in effect in `timeZone`. */
export function currentPlainDateInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const parts = getFormatter(timeZone).formatToParts(now);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    if (!found) {
      throw new Error(`Missing "${type}" from Intl parts for zone ${timeZone}`);
    }
    return found.value;
  };
  const result = `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
  assertPlainDate(result);
  return result;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
