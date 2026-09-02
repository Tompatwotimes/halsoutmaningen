import { evaluateParticipant } from '@/domain/liability';
import { currentStreak, longestStreak } from '@/domain/streaks';
import { isDateEligible } from '@/domain/membership';
import { membershipDisplayState } from '@/features/admin/membershipState';
import type {
  ChallengeDataset,
  ParticipantView,
} from '@/features/challenge/types';
import { activeChallenge, FIXTURE_TODAY } from './challenge';
import { participantFixtures, SELF_USER_ID } from './participants';
import { buildEntryMap } from './entries';

export type {
  ParticipantView,
  ChallengeDataset,
} from '@/features/challenge/types';

/**
 * DEV-ONLY. Builds the same `ChallengeDataset` shape the real Supabase-backed
 * `useChallengeData()` produces, so the `/forhandsvisning` design-review
 * harness can render every screen without a backend. Real screens never
 * import this module (docs/DESIGN_SYSTEM.md §7) — only `PreviewFrame` does.
 */
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
      } satisfies ParticipantView;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'));

  const self =
    participants.find((p) => p.isSelf) ??
    participants[0] ??
    (() => {
      throw new Error('Fixture dataset has no participants');
    })();

  const selfEntries = [...entries.values()]
    .filter((e) => e.userId === self.userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({
      entryId: e.entryId,
      date: e.date,
      durationMinutes: e.durationMinutes,
      activity: e.activity,
      note: e.note,
      hasProof: e.hasProof,
      submittedAt: e.submittedAt,
      status: 'active' as const,
    }));
  const selfEntryByDate = new Map(selfEntries.map((e) => [e.date, e]));

  return {
    challenge: activeChallenge,
    today,
    self,
    participants,
    rosterToday: participants.filter((p) => p.activeToday),
    selfEntries,
    getSelfEntry: (date) => selfEntryByDate.get(date) ?? null,
  };
}
