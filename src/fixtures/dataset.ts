import type { ChallengeConfig } from '@/domain/challenge';
import { type DayState } from '@/domain/dayState';
import {
  evaluateParticipant,
  type LiabilityBreakdown,
} from '@/domain/liability';
import { currentStreak, longestStreak } from '@/domain/streaks';
import { isDateEligible, type MembershipConfig } from '@/domain/membership';
import {
  membershipDisplayState,
  type MembershipStateResult,
} from '@/features/admin/membershipState';
import type { Role } from '@/features/profile/profile-api';
import { activeChallenge, FIXTURE_TODAY } from './challenge';
import { participantFixtures, SELF_USER_ID } from './participants';
import { buildEntryMap, type EntryFixture, type EntryMap } from './entries';

export interface ParticipantView {
  userId: string;
  displayName: string;
  role: Role;
  isSelf: boolean;
  profileActive: boolean;
  membership: MembershipConfig;
  membershipDisplay: MembershipStateResult;
  /** Every eligible day with its canonical state, ascending. */
  days: { date: string; state: DayState }[];
  statesByDate: Map<string, DayState>;
  /** Canonical state for today, or null when not eligible today. */
  todayState: DayState | null;
  /** True when eligible today AND membership currently active. */
  activeToday: boolean;
  currentStreak: number;
  longestStreak: number;
  liability: LiabilityBreakdown;
  /** completed / (completed + missed) — decided days only, 0–1. */
  completionRate: number;
  decidedDays: number;
  /** Most recent completed entry, for activity feeds. */
  latestEntry: EntryFixture | null;
}

export interface ChallengeDataset {
  challenge: ChallengeConfig;
  today: string;
  self: ParticipantView;
  /** All participants, ordered by display name. */
  participants: ParticipantView[];
  /** Participants eligible + active today, ordered by display name. */
  rosterToday: ParticipantView[];
  entries: EntryMap;
  getEntry: (userId: string, date: string) => EntryFixture | null;
}

export function buildChallengeDataset(): ChallengeDataset {
  const entries = buildEntryMap();
  const today = FIXTURE_TODAY;

  const participants: ParticipantView[] = participantFixtures
    .map((p) => {
      const entriesByDate = new Map(
        [...entries.values()]
          .filter((e) => e.userId === p.userId)
          .map((e) => [e.date, e] as const),
      );
      const evaluation = evaluateParticipant({
        challenge: activeChallenge,
        membership: p.membership,
        currentDate: today,
        entriesByDate,
      });
      const statesByDate = new Map(
        evaluation.days.map((d) => [d.date, d.state] as const),
      );
      const decided =
        evaluation.liability.completedDays + evaluation.liability.missedDays;
      const latestEntry = [...entriesByDate.values()].sort((a, b) =>
        a.date < b.date ? 1 : -1,
      )[0];

      return {
        userId: p.userId,
        displayName: p.displayName,
        role: p.role,
        isSelf: p.userId === SELF_USER_ID,
        profileActive: p.profileActive,
        membership: p.membership,
        membershipDisplay: membershipDisplayState(
          activeChallenge,
          p.membership,
          today,
        ),
        days: evaluation.days,
        statesByDate,
        todayState: isDateEligible(activeChallenge, p.membership, today)
          ? (statesByDate.get(today) ?? null)
          : null,
        activeToday:
          p.membership.active &&
          isDateEligible(activeChallenge, p.membership, today),
        currentStreak: currentStreak(evaluation.states),
        longestStreak: longestStreak(evaluation.states),
        liability: evaluation.liability,
        completionRate:
          decided === 0 ? 0 : evaluation.liability.completedDays / decided,
        decidedDays: decided,
        latestEntry: latestEntry ?? null,
      } satisfies ParticipantView;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'));

  const self =
    participants.find((p) => p.isSelf) ??
    participants[0] ??
    (() => {
      throw new Error('Fixture dataset has no participants');
    })();

  return {
    challenge: activeChallenge,
    today,
    self,
    participants,
    rosterToday: participants.filter((p) => p.activeToday),
    entries,
    getEntry: (userId, date) => entries.get(`${userId}:${date}`) ?? null,
  };
}
