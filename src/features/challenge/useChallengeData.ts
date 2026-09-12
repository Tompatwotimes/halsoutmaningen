import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ChallengeConfig } from '@/domain/challenge';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { DayState } from '@/domain/dayState';
import { liabilityFromTotals } from '@/domain/liability';
import { eligibleDates } from '@/domain/membership';
import { membershipDisplayState } from '@/features/admin/membershipState';
import { useAuth } from '@/features/auth/useAuth';
import { recentDates, RECENT_WINDOW_DAYS } from './labels';
import {
  fetchChallengeResults,
  fetchDayStatesForUser,
  fetchDayStatesOnDates,
  fetchMyPrimaryChallenge,
  type ChallengeResultRow,
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
 * EGRESS ARCHITECTURE (2026-09 forensic audit — see docs/DEPLOYMENT.md
 * postmortem): the full `challenge_day_states` matrix is one row per
 * participant × challenge day (e.g. 21 × 120 ≈ 2520 rows, ~690 KB for the
 * first real challenge) and used to be fetched unconditionally by every
 * screen through this hook, on every navigation. Almost nothing but
 * Översikt's complete grid ever renders more than the signed-in user's own
 * history plus a recent window for everyone else. This hook now fetches:
 *
 *   - the signed-in user's own full day-state history (`fetchDayStatesForUser`
 *     — ~20x smaller than the full matrix for one real challenge),
 *   - every OTHER participant's day states for only the last
 *     `RECENT_WINDOW_DAYS` days (`fetchDayStatesOnDates`),
 *   - every participant's pre-aggregated summary stats (streak, completion
 *     rate, liability) from the `challenge_results` RPC, computed server-side
 *     from the full matrix without it ever crossing the network.
 *
 * Screens that need the complete historical grid for every participant
 * (Översikt only) use `useChallengeMatrix()` instead — a separate,
 * intentionally-opt-in query.
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
  results: (challengeId: string) =>
    ['challenge', 'results', challengeId] as const,
  selfDayStates: (challengeId: string, userId: string) =>
    ['challenge', 'self-day-states', challengeId, userId] as const,
  recentDayStates: (challengeId: string, today: string) =>
    ['challenge', 'recent-day-states', challengeId, today] as const,
  fullDayStates: (challengeId: string) =>
    ['challenge', 'full-day-states', challengeId] as const,
  selfEntries: (challengeId: string, userId: string) =>
    ['challenge', 'self-entries', challengeId, userId] as const,
};

function rowsToViews(rows: DayStateRow[] | undefined) {
  const sorted = [...(rows ?? [])].sort((a, b) =>
    a.challengeDate < b.challengeDate
      ? -1
      : a.challengeDate > b.challengeDate
        ? 1
        : 0,
  );
  const statesByDate = new Map(sorted.map((r) => [r.challengeDate, r.state]));
  const requirementByDate = new Map(
    sorted.map((r) => [r.challengeDate, toRequirement(r)]),
  );
  const days = sorted
    .filter((r) => r.state !== DayState.NotParticipating)
    .map((r) => ({ date: r.challengeDate, state: r.state }));
  return { days, statesByDate, requirementByDate };
}

/**
 * Builds one participant's view from whatever day-state rows were fetched
 * for them (full history for self and for `useChallengeMatrix()`, a recent
 * window for everyone else in the base dataset — see module doc above) plus
 * their pre-aggregated `challenge_results` row. Streak/completion-rate/
 * liability always come from `resultRow`, never recomputed from the raw
 * rows client-side (CLAUDE.md §17) — the raw rows only ever drive the
 * per-day grid/calendar rendering.
 */
function buildParticipant(
  member: RosterMember,
  today: string,
  missedDayCost: number,
  dayStateRows: DayStateRow[] | undefined,
  resultRow: ChallengeResultRow | undefined,
  isSelf: boolean,
  challenge: ChallengeConfig,
): ParticipantView {
  const membership = {
    userId: member.userId,
    participationStartDate: member.participationStartDate,
    participationEndDate: member.participationEndDate,
    active: member.membershipActive,
  };

  const { days, statesByDate, requirementByDate } = rowsToViews(dayStateRows);

  const rawTodayState = statesByDate.get(today) ?? null;
  const todayState =
    rawTodayState === DayState.NotParticipating ? null : rawTodayState;
  const todayRequirement =
    todayState === null ? null : (requirementByDate.get(today) ?? null);

  const liability = liabilityFromTotals(
    {
      eligibleDays: resultRow?.eligibleDays ?? 0,
      completedDays: resultRow?.completedDays ?? 0,
      missedDays: resultRow?.missedDays ?? 0,
      pendingDays: resultRow?.pendingDays ?? 0,
      futureDays: resultRow?.futureDays ?? 0,
    },
    missedDayCost,
    resultRow?.liabilitySek ?? 0,
  );

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
    currentStreak: resultRow?.currentStreak ?? 0,
    longestStreak: resultRow?.longestStreak ?? 0,
    liability,
    completionRate: resultRow?.completionRate ?? 0,
    decidedDays: (resultRow?.completedDays ?? 0) + (resultRow?.missedDays ?? 0),
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
  const windowDates = recentDates(
    today,
    RECENT_WINDOW_DAYS,
    challenge.startDate,
  );

  const [
    roster,
    resultRows,
    selfDayStateRows,
    windowDayStateRows,
    selfEntries,
  ] = await Promise.all([
    queryClient.query({
      queryKey: challengeKeys.roster(challenge.id),
      queryFn: () => fetchChallengeRoster(challenge.id),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.results(challenge.id),
      queryFn: () => fetchChallengeResults(challenge.id),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.selfDayStates(challenge.id, userId),
      queryFn: () => fetchDayStatesForUser(challenge.id, userId),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.recentDayStates(challenge.id, today),
      queryFn: () => fetchDayStatesOnDates(challenge.id, windowDates),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.selfEntries(challenge.id, userId),
      queryFn: () => fetchSelfEntries(challenge.id, userId),
      staleTime: 30_000,
    }),
  ]);

  // Invariant: every date the signed-in user is *eligible* for must have a
  // row in their own full-history fetch. A missing eligible-day row here
  // (historically caused by PostgREST truncating an un-paginated response at
  // its row cap) would silently render as `not_participating` ("—") on the
  // user's own calendar. This only checks the signed-in user — the full
  // per-participant check for the complete matrix lives in
  // `useChallengeMatrix.ts`, the only place that still fetches it.
  const selfEligible = eligibleDates(challenge, {
    userId,
    participationStartDate: primary.membership.participationStartDate,
    participationEndDate: primary.membership.participationEndDate,
    active: primary.membership.active,
  });
  const selfPresent = new Set(selfDayStateRows.map((r) => r.challengeDate));
  const selfMissing = selfEligible.filter((d) => !selfPresent.has(d));
  if (selfMissing.length > 0) {
    console.error(
      `[useChallengeData] challenge_day_states is missing eligible-day rows for ` +
        `the signed-in user in challenge ${challenge.id} — their own calendar would ` +
        `show these as "—". Missing ${String(selfMissing.length)} days, first ${String(selfMissing[0])}.`,
    );
  }

  const resultsByUser = new Map(resultRows.map((r) => [r.userId, r]));

  const windowRowsByUser = new Map<string, DayStateRow[]>();
  for (const row of windowDayStateRows) {
    const list = windowRowsByUser.get(row.userId) ?? [];
    list.push(row);
    windowRowsByUser.set(row.userId, list);
  }
  // The signed-in user gets their full history, a strict superset of the
  // recent window fetched for everyone else.
  windowRowsByUser.set(userId, selfDayStateRows);

  const participants = roster
    .map((member) =>
      buildParticipant(
        member,
        today,
        challenge.missedDayCost,
        windowRowsByUser.get(member.userId),
        resultsByUser.get(member.userId),
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
    queryKey: challengeKeys.selfDayStates(challengeId, userId),
  });
  // Partial key: invalidates every cached `today` variant for this challenge.
  void queryClient.invalidateQueries({
    queryKey: ['challenge', 'recent-day-states', challengeId],
  });
  void queryClient.invalidateQueries({
    queryKey: challengeKeys.results(challengeId),
  });
  void queryClient.invalidateQueries({
    queryKey: challengeKeys.selfEntries(challengeId, userId),
  });
  void queryClient.invalidateQueries({ queryKey: ['challenge-data', userId] });
  // Översikt's full matrix, only if it happens to be mounted/cached.
  void queryClient.invalidateQueries({
    queryKey: challengeKeys.fullDayStates(challengeId),
  });
  void queryClient.invalidateQueries({
    queryKey: ['challenge-matrix', challengeId],
  });
}
