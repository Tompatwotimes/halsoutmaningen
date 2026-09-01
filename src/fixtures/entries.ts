import type { TrainingEntrySummary } from '@/domain/dayState';
import { compareDates } from '@/domain/dates';
import { eligibleDates } from '@/domain/membership';
import { activeChallenge, FIXTURE_TODAY } from './challenge';
import { participantFixtures, SELF_USER_ID } from './participants';
import { intBetween, mulberry32, pick } from './rng';

export interface EntryFixture extends TrainingEntrySummary {
  entryId: string;
  userId: string;
  date: string;
  durationMinutes: number;
  activity: string;
  note: string | null;
  /** ISO timestamp in the challenge timezone offset — display only. */
  submittedAt: string;
  /** Seed for the generated placeholder proof visual. */
  proofSeed: number;
}

const ACTIVITIES = [
  'Löpning',
  'Promenad',
  'Styrketräning',
  'Cykling',
  'Simning',
  'Yoga',
  'Padel',
  'Innebandy',
  'Gym',
  'Vandring',
  'Roddmaskin',
  'Spinning',
  'Crossfit',
];

const NOTES = [
  'Skön morgonrunda innan jobbet.',
  'Tungt men klart.',
  '8 km i lugnt tempo.',
  'Regn hela vägen, värt det.',
  'Intervaller på banan.',
  'Lätt återhämtning.',
  'Nytt PB på 5 km!',
  'Kändes trögt i benen idag.',
  'Långpass med klubben.',
  'Snabbt pass på lunchen.',
  null,
  null,
  null,
];

/** `${userId}:${date}` → entry. Only past / today completed days get one. */
export type EntryMap = Map<string, EntryFixture>;

function keyOf(userId: string, date: string): string {
  return `${userId}:${date}`;
}

export function buildEntryMap(): EntryMap {
  const map: EntryMap = new Map();

  for (const p of participantFixtures) {
    const rng = mulberry32(hashSeed(p.userId));
    const dates = eligibleDates(activeChallenge, p.membership).filter(
      (d) => compareDates(d, FIXTURE_TODAY) <= 0,
    );

    let prevCompleted = true;
    dates.forEach((date, index) => {
      const isToday = date === FIXTURE_TODAY;
      let probability = p.discipline + (prevCompleted ? 0.02 : -0.08);
      if (isToday) probability = p.discipline * 0.85;
      const completed = applyOverrides(
        p.userId,
        index,
        dates.length,
        rng() < probability,
      );
      prevCompleted = completed && !isToday ? true : completed;

      if (!completed) return;

      const activity = pick(rng, ACTIVITIES);
      const duration = durationFor(activity, rng);
      map.set(keyOf(p.userId, date), {
        entryId: `e-${p.userId}-${date}`,
        userId: p.userId,
        date,
        durationMinutes: duration,
        hasProof: true,
        activity,
        note: pick(rng, NOTES),
        submittedAt: `${date}T${String(intBetween(rng, 6, 21)).padStart(2, '0')}:${String(
          intBetween(rng, 0, 59),
        ).padStart(2, '0')}:00+02:00`,
        proofSeed: intBetween(rng, 1, 9999),
      });
    });
  }

  return map;
}

function durationFor(activity: string, rng: () => number): number {
  const base =
    activity === 'Promenad' || activity === 'Yoga'
      ? intBetween(rng, 30, 50)
      : activity === 'Löpning' || activity === 'Cykling'
        ? intBetween(rng, 32, 78)
        : intBetween(rng, 30, 65);
  return base;
}

/**
 * Targeted tweaks so a few participants tell a clear story on the demo
 * screens (a clean streak for "you", a perfect record, a struggling member).
 */
function applyOverrides(
  userId: string,
  index: number,
  total: number,
  generated: boolean,
): boolean {
  const fromEnd = total - 1 - index;
  if (userId === SELF_USER_ID) {
    if (index === 3 || index === 6) return false; // early stumbles
    if (fromEnd >= 1 && fromEnd <= 9) return true; // 9-day streak up to yesterday
    if (fromEnd === 0) return false; // pending today
  }
  if (userId === 'u-anna') return true; // one flawless record in the group
  if (userId === 'u-fredrik' && fromEnd <= 2) return false; // recent slump
  if (userId === 'u-erik' && fromEnd >= 1 && fromEnd <= 6) return true;
  return generated;
}

function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
