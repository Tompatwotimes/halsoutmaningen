/**
 * Swedish day / date labels for challenge UI. Pure string helpers layered on
 * the domain date utilities — challenge-day semantics stay in `src/domain`.
 */
import { addDays, compareDates, diffDays, parsePlainDate } from '@/domain/dates';

const WEEKDAYS_SHORT = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const WEEKDAYS_LONG = [
  'söndag',
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
];

function weekdayIndex(plainDate: string): number {
  const { year, month, day } = parsePlainDate(plainDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayShort(plainDate: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(plainDate)] ?? '';
}

export function weekdayLong(plainDate: string): string {
  return WEEKDAYS_LONG[weekdayIndex(plainDate)] ?? '';
}

/** "Idag" / "Igår" / short weekday for anything within a week, else "3/8". */
export function relativeDayLabel(plainDate: string, today: string): string {
  const delta = diffDays(today, plainDate);
  if (delta === 0) return 'Idag';
  if (delta === -1) return 'Igår';
  if (delta === 1) return 'Imorgon';
  if (delta > -7 && delta < 0) return capitalize(weekdayShort(plainDate));
  const { day, month } = parsePlainDate(plainDate);
  return `${String(day)}/${String(month)}`;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The most recent `count` challenge dates ending at `today` (inclusive),
 * ordered oldest → newest — the columns of the recent-days dashboard.
 */
export function recentDates(
  today: string,
  count: number,
  startDate: string,
): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    if (compareDates(date, startDate) >= 0) dates.push(date);
  }
  return dates;
}
