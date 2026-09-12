import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  challengeDurationDays,
  type ChallengeConfig,
} from '@/domain/challenge';
import { eligibleDates } from '@/domain/membership';
import { liabilityFromTotals } from '@/domain/liability';
import { DayState } from '@/domain/dayState';
import { membershipDisplayState } from '@/features/admin/membershipState';
import {
  fetchChallengeResults,
  fetchDayStates,
  type ChallengeResultRow,
  type DayStateRow,
} from './challenge-api';
import { fetchChallengeRoster, type RosterMember } from './roster-api';
import { challengeKeys } from './useChallengeData';
import type { DayRequirement, ParticipantView } from './types';

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

function buildFullParticipant(
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

export interface ChallengeMatrix {
  participants: ParticipantView[];
}

async function loadChallengeMatrix(
  challengeId: string,
  challenge: ChallengeConfig,
  today: string,
  selfUserId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<ChallengeMatrix> {
  const [roster, resultRows, dayStateRows] = await Promise.all([
    queryClient.query({
      queryKey: challengeKeys.roster(challengeId),
      queryFn: () => fetchChallengeRoster(challengeId),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.results(challengeId),
      queryFn: () => fetchChallengeResults(challengeId),
      staleTime: 30_000,
    }),
    queryClient.query({
      queryKey: challengeKeys.fullDayStates(challengeId),
      queryFn: () => fetchDayStates(challengeId),
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
  // `challenge_day_states` row — see `useChallengeData.ts`'s self-only
  // equivalent. This is the one remaining place the full matrix is fetched,
  // so this is the one remaining place that can catch a PostgREST row-cap
  // truncation regression across every participant, not just the self.
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
      `[useChallengeMatrix] challenge_day_states is missing eligible-day rows for ` +
        `challenge ${challenge.id} — Översikt would show these as "—". ` +
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

  const resultsByUser = new Map(resultRows.map((r) => [r.userId, r]));

  const participants = roster
    .map((member) =>
      buildFullParticipant(
        member,
        today,
        challenge.missedDayCost,
        dayStatesByUser.get(member.userId),
        resultsByUser.get(member.userId),
        member.userId === selfUserId,
        challenge,
      ),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'));

  return { participants };
}

/**
 * The complete participant × challenge-day matrix — deliberately separate
 * from `useChallengeData()`. Reserved for Översikt's full grid, the one
 * screen CLAUDE.md §5.4 requires to show every day for every participant;
 * every other screen must keep using the lighter base hook (egress
 * forensics, 2026-09 — see `useChallengeData.ts`).
 */
export function useChallengeMatrix(
  challengeId: string | null,
  challenge: ChallengeConfig | null,
  today: string | null,
  selfUserId: string | null,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['challenge-matrix', challengeId],
    queryFn: () => {
      if (
        challengeId === null ||
        challenge === null ||
        today === null ||
        selfUserId === null
      ) {
        throw new Error('Ingen aktiv utmaning.');
      }
      return loadChallengeMatrix(
        challengeId,
        challenge,
        today,
        selfUserId,
        queryClient,
      );
    },
    enabled:
      challengeId !== null &&
      challenge !== null &&
      today !== null &&
      selfUserId !== null,
    staleTime: 30_000,
  });
}
