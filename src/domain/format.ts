/**
 * Swedish-locale display formatting. UI language is Swedish (CLAUDE.md §14).
 */

import { parsePlainDate } from './dates';

const SEK = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  maximumFractionDigits: 0,
});

const MONTHS_SV = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];

/** e.g. 6000 -> "6 000 kr". */
export function formatSek(amount: number): string {
  return SEK.format(amount);
}

/** e.g. "2026-08-31" -> "31 augusti". */
export function formatDayMonth(plainDate: string): string {
  const { month, day } = parsePlainDate(plainDate);
  return `${String(day)} ${MONTHS_SV[month - 1] ?? ''}`.trim();
}

/** e.g. "2026-08-31" -> "31 augusti 2026". */
export function formatLongDate(plainDate: string): string {
  const { year } = parsePlainDate(plainDate);
  return `${formatDayMonth(plainDate)} ${String(year)}`;
}

/** e.g. 45 -> "45 min". */
export function formatMinutes(minutes: number): string {
  return `${String(minutes)} min`;
}

/** 0-100 -> "81 %". */
export function formatPercent(value: number): string {
  return `${String(Math.round(value))} %`;
}
