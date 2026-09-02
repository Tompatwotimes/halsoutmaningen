import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  challengeDurationDays,
  type ChallengeConfig,
} from '@/domain/challenge';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { DayState } from '@/domain/dayState';
import { currentStreak, longestStreak } from '@/domain/streaks';
import { summarizeLiability } from '@/domain/liability';
import { eligibleDates } from '@/domain/membership';
import { membershipDisplayState } from '@/features/admin/membershipState';
import { useAuth } from '@/features/auth/useAuth';
import {
  fetchDayStates,
  fetchMyPrimaryChallenge,
  type DayStateRow,
} from './challenge-api';
import { fetchChallengeRoster, type RosterMember } from './roster-api';
import { fetchSelfEntries } from './entries-api';
import type {
  ChallengeDataset,
  DayRequirement,
  ParticipantView,
} from './types';

function toRequirement(row: DayStateRow): DayRequirement {
  return {
    requiredMinutes: row.requiredMinutes,
    requiredSessions: row.requiredSessions,
    minMinutesPerSession: row.minMinutesPerSession,
    penaltyType: row.penaltyType,
    penaltyDisplayName: row.penaltyDisplayName,
    penaltyFromUserId: row.penaltyFromUserId,
    sessionCount: row.sessionCount,
    validSessionCount: row.validSessionCount,
    totalValidMinutes: row.totalValidMinutes,
  };
}

/**
 * Adapter boundary for challenge data (docs/DESIGN_SYSTEM.md §7).
 *
 * Composes four small, independently cacheable queries — the current
 * challenge/membership, the roster, the canonical day states
 * (`challenge_day_states` RPC, one round trip for every participant × day),
 * and the signed-in user's own entries — into the `ChallengeDataset` shape
 * every screen already renders. Screens never talk to Supabase directly.
 *
 * `data === null` (once loaded, with no error) is a real, expected state: the
 * signed-in user simply has no challenge membership yet (CLAUDE.md §4) — not
 * a failure. Callers should render an empty/"not a participant" state, not an
 * error state, for that case.
 */

export const challengeKeys = {
  mine: (userId: string) => ['challenge', 'mine', userId] as const,
  roster: (challengeId: string) =>
    ['challenge', 'roster', challengeId] as const,
  dayStates: (challengeId: string) =>
    ['challenge', 'day-states', challengeId] as const,
  selfEntries: (challengeId: string, userId: string) =>
    ['challenge', 'self-entries', challengeId, userId] as const,
};

function buildParticipant(
  member: RosterMember,
  today: string,
  missedDayCost: number,
  dayStateRows: DayStateRow[] | undefined,
  isSelf: boolean,
  challenge: ChallengeConfig,
): ParticipantView {
  const membership = {
    userId: member.userId,
    participationStartDate: member.participationStartDate,
    participationEndDate: member.participationEndDate,
    active: member.membershipActive,
  };

  const rows = [...(dayStateRows ?? [])].sort((a, b) =>
    a.challengeDate < b.challengeDate
      ? -1
      : a.challengeDate > b.challengeDate
        ? 1
        : 0,
  );

  const statesByDate = new Map(rows.map((r) => [r.challengeDate, r.state]));
  const requirementByDate = new Map(
    rows.map((r) => [r.challengeDate, toRequirement(r)]),
  );
  const days = rows
    .filter((r) => r.state !== DayState.NotParticipating)
    .map((r) => ({ date: r.challengeDate, state: r.state }));
  const states = days.map((d) => d.state);

  const rawTodayState = statesByDate.get(today) ?? null;
  const todayState =
    rawTodayState === DayState.NotParticipating ? null : rawTodayState;
  const todayRequirement =
    todayState === null ? null : (requirementByDate.get(today) ?? null);

  const liability = summarizeLiability(states, missedDayCost);
  const decidedDays = liability.completedDays + liability.missedDays;

  return {
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    isSelf,
    profileActive: member.profileActive,
    membership,
    membershipDisplay: membershipDisplayState(challenge, membership, today),
    days,
    statesByDate,
    requirementByDate,
    todayState,
    todayRequirement,
    activeToday: membership.active && todayState !== null,
    currentStreak: currentStreak(states),
    longestStreak: longestStreak(states),
    liability,
    completionRate:
      decidedDays === 0 ? 0 : liability.completedDays / decidedDays,
    decidedDays,
  };
}

async function loadChallengeDataset(
  userId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<ChallengeDataset | null> {
  const primary = await queryClient.query({
    queryKey: challengeKeys.mine(userId),
    queryFn: () => fetchMyPrimaryChallenge(userId),
    staleTime: 30_000,
  });
  if (!primary) return null;

  const { challenge } = primary;
  const today = currentPlainDateInTimeZone(challenge.timeZone);

  const [roster, dayStateRows, selfEntries] = await Promise.all([
    queryClient.query({
      queryKey: challengeKeys.roster(challenge.id),
      queryFn: () => fetchChallengeRoster(challenge.id),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.dayStates(challenge.id),
      queryFn: () => fetchDayStates(challenge.id),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.selfEntries(challenge.id, userId),
      queryFn: () => fetchSelfEntries(challenge.id, userId),
      staleTime: 30_000,
    }),
  ]);

  const dayStatesByUser = new Map<string, DayStateRow[]>();
  for (const row of dayStateRows) {
    const list = dayStatesByUser.get(row.userId) ?? [];
    list.push(row);
    dayStatesByUser.set(row.userId, list);
  }

  // Invariant: every date a roster member is *eligible* for must have a
  // `challenge_day_states` row. A missing eligible-day row is silently
  // rendered as `not_participating` ("—") on Översikt/Gruppen — historically
  // caused by PostgREST truncating the un-paginated RPC response at its row
  // cap. `fetchDayStates` now pages the full set; this check fails loudly on
  // any regression rather than showing wrong data as if it were correct.
  // (Pre-/post-membership `not_participating` rows are not required here —
  // their absence renders the same, correct state.)
  const missingByMember = roster
    .map((m) => {
      const present = new Set(
        (dayStatesByUser.get(m.userId) ?? []).map((r) => r.challengeDate),
      );
      const eligible = eligibleDates(challenge, {
        userId: m.userId,
        participationStartDate: m.participationStartDate,
        participationEndDate: m.participationEndDate,
        active: m.membershipActive,
      });
      return { member: m, missing: eligible.filter((d) => !present.has(d)) };
    })
    .filter((r) => r.missing.length > 0);
  if (missingByMember.length > 0) {
    const expectedTotal = roster.length * challengeDurationDays(challenge);
    console.error(
      `[useChallengeData] challenge_day_states is missing eligible-day rows for ` +
        `challenge ${challenge.id} — Översikt/Gruppen would show these as "—". ` +
        `Returned ${String(dayStateRows.length)} rows (a full grid is ${String(expectedTotal)}). ` +
        `Affected: ` +
        missingByMember
          .map(
            (r) =>
              `${r.member.displayName} (${String(r.missing.length)} days, first ${String(r.missing[0])})`,
          )
          .join('; '),
    );
  }

  const participants = roster
    .map((member) =>
      buildParticipant(
        member,
        today,
        challenge.missedDayCost,
        dayStatesByUser.get(member.userId),
        member.userId === userId,
        challenge,
      ),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'));

  const self = participants.find((p) => p.isSelf);
  if (!self) {
    // Membership exists but the roster fetch didn't include it — should not
    // happen under normal RLS, but fail loudly rather than render wrong data.
    throw new Error('Din egen medlemsrad saknas i deltagarlistan.');
  }

  const selfSessionsByDate = new Map<string, typeof selfEntries>();
  for (const e of selfEntries) {
    const list = selfSessionsByDate.get(e.date) ?? [];
    list.push(e);
    selfSessionsByDate.set(e.date, list);
  }
  for (const list of selfSessionsByDate.values()) {
    list.sort((a, b) => a.sessionSeq - b.sessionSeq);
  }

  return {
    challenge,
    today,
    self,
    participants,
    rosterToday: participants.filter((p) => p.activeToday),
    selfEntries,
    getSelfEntry: (date) => {
      const list = selfSessionsByDate.get(date);
      if (!list || list.length === 0) return null;
      return list.find((e) => e.sessionSeq === 1) ?? list[0] ?? null;
    },
    getSelfSessions: (date) => selfSessionsByDate.get(date) ?? [],
  };
}

export function useChallengeData() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const queryKey: QueryKey = ['challenge-data', userId];

  return useQuery({
    queryKey,
    queryFn: () => {
      if (!userId) {
        throw new Error('Ingen inloggad användare.');
      }
      return loadChallengeDataset(userId, queryClient);
    },
    enabled: userId !== null,
    staleTime: 30_000,
  });
}

/** Invalidate every sub-query for one challenge/user after a write. */
export function invalidateChallengeData(
  queryClient: ReturnType<typeof useQueryClient>,
  challengeId: string,
  userId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: challengeKeys.dayStates(challengeId),
  });
  void queryClient.invalidateQueries({
    queryKey: challengeKeys.selfEntries(challengeId, userId),
  });
  void queryClient.invalidateQueries({ queryKey: ['challenge-data', userId] });
}
