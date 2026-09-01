import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';

/**
 * Development fixture: the first challenge exactly as it will load from
 * Supabase. Nothing here is hardcoded into domain logic — screens read these
 * as data (CLAUDE.md §2). Replace this module's export with a real query when
 * the challenge API lands.
 */
export const activeChallenge: ChallengeConfig = {
  id: 'challenge-2026',
  name: 'Hälsoutmaningen 2026',
  startDate: '2026-08-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

/**
 * "Today" for the fixture world. Matches the development clock (2026-09-01) —
 * ~1 month into a 120-day challenge, so every screen has real history,
 * a live "today" column and a long future tail.
 */
export const FIXTURE_TODAY = '2026-09-01';
