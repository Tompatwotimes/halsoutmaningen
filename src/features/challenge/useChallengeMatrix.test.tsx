import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { currentStreak, longestStreak } from '@/domain/streaks';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { addDays } from '@/domain/dates';
import { eligibleDates } from '@/domain/membership';
import type { ChallengeResultRow, DayStateRow } from './challenge-api';
import type { RosterMember } from './roster-api';

const mocks = vi.hoisted(() => ({
  fetchDayStates: vi.fn(),
  fetchChallengeResults: vi.fn(),
  fetchChallengeRoster: vi.fn(),
}));

vi.mock('./challenge-api', () => ({
  fetchDayStates: mocks.fetchDayStates,
  fetchChallengeResults: mocks.fetchChallengeResults,
}));
vi.mock('./roster-api', () => ({
  fetchChallengeRoster: mocks.fetchChallengeRoster,
}));

const { useChallengeMatrix } = await import('./useChallengeMatrix');

const TZ = 'Europe/Stockholm';
const today = currentPlainDateInTimeZone(TZ);

const CHALLENGE: ChallengeConfig = {
  id: 'c1',
  name: 'Test Challenge',
  description: null,
  startDate: addDays(today, -100),
  endDate: addDays(today, 20),
  timeZone: TZ,
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function dsRow(
  over: Partial<DayStateRow> &
    Pick<DayStateRow, 'userId' | 'challengeDate' | 'state'>,
): DayStateRow {
  return {
    sessionCount: 0,
    validSessionCount: 0,
    totalValidMinutes: 0,
    requiredMinutes: 30,
    requiredSessions: 1,
    minMinutesPerSession: 0,
    penaltyType: null,
    penaltyDisplayName: null,
    penaltyFromUserId: null,
    ...over,
  };
}

function member(over: Partial<RosterMember>): RosterMember {
  return {
    membershipId: `m-${over.userId ?? 'x'}`,
    userId: 'x',
    displayName: 'X',
    avatarPath: null,
    role: 'participant',
    profileActive: true,
    participationStartDate: CHALLENGE.startDate,
    participationEndDate: null,
    membershipActive: true,
    createdAt: '2000-01-01T00:00:00Z',
    ...over,
  };
}

/** Same shape the real `challenge_day_states` RPC guarantees: one row for
 * every date each member is eligible for. */
function eligibleGrid(
  roster: RosterMember[],
  overrides: Record<string, DayState> = {},
): DayStateRow[] {
  const rows: DayStateRow[] = [];
  for (const m of roster) {
    const dates = eligibleDates(CHALLENGE, {
      userId: m.userId,
      participationStartDate: m.participationStartDate,
      participationEndDate: m.participationEndDate,
      active: m.membershipActive,
    });
    for (const date of dates) {
      const fallback =
        date > today
          ? DayState.Future
          : date === today
            ? DayState.Pending
            : DayState.Missed;
      rows.push(
        dsRow({
          userId: m.userId,
          challengeDate: date,
          state: overrides[`${m.userId}|${date}`] ?? fallback,
        }),
      );
    }
  }
  return rows;
}

function resultRowsFrom(
  roster: RosterMember[],
  rows: DayStateRow[],
): ChallengeResultRow[] {
  return roster.map((m) => {
    const own = rows
      .filter((r) => r.userId === m.userId)
      .sort((a, b) => (a.challengeDate < b.challengeDate ? -1 : 1));
    const states = own.map((r) => r.state);
    const completedDays = states.filter((s) => s === DayState.Completed).length;
    const missedDays = states.filter((s) => s === DayState.Missed).length;
    const decided = completedDays + missedDays;
    return {
      userId: m.userId,
      participationStartDate: m.participationStartDate,
      participationEndDate: m.participationEndDate,
      membershipActive: m.membershipActive,
      eligibleDays: states.length,
      completedDays,
      missedDays,
      pendingDays: states.filter((s) => s === DayState.Pending).length,
      futureDays: states.filter((s) => s === DayState.Future).length,
      completionRate: decided === 0 ? 0 : completedDays / decided,
      currentStreak: currentStreak(states),
      longestStreak: longestStreak(states),
      totalValidMinutes: 0,
      liabilitySek: missedDays * CHALLENGE.missedDayCost,
      penaltiesEarned: 0,
      penaltiesAssigned: 0,
      penaltiesReceived: 0,
    };
  });
}

describe('useChallengeMatrix', () => {
  it('builds the full historical grid for every participant, not just the signed-in user', async () => {
    const roster = [
      member({ userId: 'u00', displayName: 'Self' }),
      member({ userId: 'u01', displayName: 'Other' }),
    ];
    const rows = eligibleGrid(roster, {
      [`u01|${addDays(today, -50)}`]: DayState.Completed,
    });

    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchChallengeResults.mockResolvedValue(resultRowsFrom(roster, rows));

    const { result } = renderHook(
      () => useChallengeMatrix(CHALLENGE.id, CHALLENGE, today, 'u00'),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const other = result.current.data?.participants.find(
      (p) => p.userId === 'u01',
    );
    expect(other?.statesByDate.get(addDays(today, -50))).toBe(
      DayState.Completed,
    );
    // A date far outside any "recent window" — only the full matrix hook
    // (not the base `useChallengeData`) can see this far back for a
    // non-self participant.
    expect(other?.statesByDate.get(addDays(today, -80))).toBe(DayState.Missed);
  });

  it('logs an invariant error when ANY participant is missing eligible-day rows (truncation regression)', async () => {
    const roster = [
      member({ userId: 'u00', displayName: 'Self' }),
      member({ userId: 'u01', displayName: 'Truncated Away' }),
    ];
    // u01's rows never arrived — the exact shape of a PostgREST row-cap cut.
    const rows = eligibleGrid([roster[0]!]);

    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchChallengeResults.mockResolvedValue(resultRowsFrom(roster, rows));
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { result } = renderHook(
      () => useChallengeMatrix(CHALLENGE.id, CHALLENGE, today, 'u00'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('missing eligible-day rows');
    expect(errSpy.mock.calls[0]?.[0]).toContain('Truncated Away');
    errSpy.mockRestore();
  });
});
