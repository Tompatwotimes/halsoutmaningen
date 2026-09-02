import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { addDays } from '@/domain/dates';
import { eligibleDates } from '@/domain/membership';
import {
  AuthContext,
  type AuthContextValue,
} from '@/features/auth/auth-context';
import type { DayStateRow } from './challenge-api';
import type { RosterMember } from './roster-api';

const mocks = vi.hoisted(() => ({
  fetchMyPrimaryChallenge: vi.fn(),
  fetchDayStates: vi.fn(),
  fetchChallengeRoster: vi.fn(),
  fetchSelfEntries: vi.fn(),
}));

vi.mock('./challenge-api', () => ({
  fetchMyPrimaryChallenge: mocks.fetchMyPrimaryChallenge,
  fetchDayStates: mocks.fetchDayStates,
}));
vi.mock('./roster-api', () => ({
  fetchChallengeRoster: mocks.fetchChallengeRoster,
}));
vi.mock('./entries-api', () => ({
  fetchSelfEntries: mocks.fetchSelfEntries,
}));

const { useChallengeData } = await import('./useChallengeData');

const TZ = 'Europe/Stockholm';
const today = currentPlainDateInTimeZone(TZ);

const CHALLENGE: ChallengeConfig = {
  id: 'c1',
  name: 'Test Challenge',
  description: null,
  // Bounded window anchored on "real now" so it always contains today, and
  // small enough that the mocked `fetchDayStates` can return a *complete*
  // eligible grid — exactly what the real RPC does. `useChallengeData` now
  // asserts that every eligible day has a row, so sparse mocks would trip it.
  startDate: addDays(today, -100),
  endDate: addDays(today, 20),
  timeZone: TZ,
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

function authValue(userId: string): AuthContextValue {
  return {
    initializing: false,
    session: { user: { id: userId } } as AuthContextValue['session'],
    user: { id: userId, email: 'x@example.se' } as AuthContextValue['user'],
    signInWithPassword: () => Promise.resolve({ error: null }),
    signOut: () => Promise.resolve(),
    requestPasswordReset: () => Promise.resolve({ error: null }),
    updatePassword: () => Promise.resolve({ error: null }),
  };
}

function wrapper(userId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authValue(userId)}>
          {children}
        </AuthContext.Provider>
      </QueryClientProvider>
    );
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

/**
 * A *complete* day-state grid: one row for every date each member is eligible
 * for — the guarantee the real `challenge_day_states` RPC provides. State is
 * taken from `overrides` (keyed `userId|date`), else defaulted by calendar
 * position relative to today.
 */
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

describe('useChallengeData', () => {
  it('resolves to null when the signed-in user has no membership anywhere', async () => {
    mocks.fetchMyPrimaryChallenge.mockResolvedValue(null);

    const { result } = renderHook(() => useChallengeData(), {
      wrapper: wrapper('user-with-no-membership'),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mocks.fetchChallengeRoster).not.toHaveBeenCalled();
  });

  it('derives a dynamic group denominator — never a hardcoded participant count', async () => {
    const roster: RosterMember[] = [
      member({ userId: 'self', displayName: 'Self' }),
      member({ userId: 'full', displayName: 'Full period' }),
      member({
        userId: 'late',
        displayName: 'Late joiner',
        participationStartDate: addDays(today, 5), // not eligible today
      }),
      member({
        userId: 'ended',
        displayName: 'Early leaver',
        participationEndDate: addDays(today, -5), // not eligible today
      }),
      member({
        userId: 'paused',
        displayName: 'Paused',
        membershipActive: false, // eligible window-wise, but hidden from "today"
      }),
    ];
    const rows = eligibleGrid(roster, {
      [`self|${today}`]: DayState.Completed,
    });

    mocks.fetchMyPrimaryChallenge.mockResolvedValue({
      challenge: CHALLENGE,
      membership: {
        userId: 'self',
        participationStartDate: CHALLENGE.startDate,
        participationEndDate: null,
        active: true,
      },
    });
    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchSelfEntries.mockResolvedValue([]);

    const { result } = renderHook(() => useChallengeData(), {
      wrapper: wrapper('self'),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data).not.toBeNull();
    // Total roster size is whatever the roster query returns — 5 here, never 21.
    expect(data?.participants.length).toBe(5);
    // Only self + full (eligible today AND membership.active) count toward "today".
    // late/ended are outside their window today; paused is eligible but inactive.
    expect(data?.rosterToday.map((p) => p.userId).sort()).toEqual([
      'full',
      'self',
    ]);
  });

  it('gives a late joiner a lower decided-day count than a full-period participant', async () => {
    const roster: RosterMember[] = [
      member({ userId: 'self', displayName: 'Self' }),
      member({
        userId: 'late',
        displayName: 'Late joiner',
        participationStartDate: today,
      }),
    ];
    // Full eligible grid. Self: every past day completed except one missed.
    // The late joiner is only eligible from today, so has no pre-start rows at
    // all — days before `participationStartDate` must never appear as "missed".
    const overrides: Record<string, DayState> = {};
    for (const d of eligibleDates(CHALLENGE, {
      userId: 'self',
      participationStartDate: CHALLENGE.startDate,
      participationEndDate: null,
      active: true,
    })) {
      if (d < today) overrides[`self|${d}`] = DayState.Completed;
    }
    overrides[`self|${addDays(today, -1)}`] = DayState.Missed;
    const rows = eligibleGrid(roster, overrides);

    mocks.fetchMyPrimaryChallenge.mockResolvedValue({
      challenge: CHALLENGE,
      membership: {
        userId: 'self',
        participationStartDate: CHALLENGE.startDate,
        participationEndDate: null,
        active: true,
      },
    });
    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchSelfEntries.mockResolvedValue([]);

    const { result } = renderHook(() => useChallengeData(), {
      wrapper: wrapper('self'),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const late = result.current.data?.participants.find(
      (p) => p.userId === 'late',
    );
    const self = result.current.data?.participants.find(
      (p) => p.userId === 'self',
    );
    // Late joiner: eligible only from today → no missed days, far fewer
    // decided days than the full-period participant.
    expect(late?.liability.missedDays).toBe(0);
    expect(late?.decidedDays).toBe(0);
    expect(self?.liability.missedDays).toBe(1);
    expect(self?.decidedDays).toBeGreaterThan(late?.decidedDays ?? 0);
    expect(late?.days.length).toBeLessThan(self?.days.length ?? 0);
  });

  it('maps a full 21×120 grid without any participant collapsing to not_participating', async () => {
    const roster = Array.from({ length: 21 }, (_, i) =>
      member({
        userId: `u${String(i).padStart(2, '0')}`,
        displayName: `Deltagare ${String(i)}`,
      }),
    );
    // u20 (last, ordered last — the first casualty of a row-cap cut) left the
    // challenge two days ago: that is a genuine not_participating window.
    roster[20] = member({
      userId: 'u20',
      displayName: 'Deltagare 20',
      participationEndDate: addDays(today, -2),
    });

    const rows = eligibleGrid(roster, { [`u00|${today}`]: DayState.Completed });

    mocks.fetchMyPrimaryChallenge.mockResolvedValue({
      challenge: CHALLENGE,
      membership: {
        userId: 'u00',
        participationStartDate: CHALLENGE.startDate,
        participationEndDate: null,
        active: true,
      },
    });
    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchSelfEntries.mockResolvedValue([]);
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { result } = renderHook(() => useChallengeData(), {
      wrapper: wrapper('u00'),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const parts = result.current.data?.participants ?? [];

    expect(parts).toHaveLength(21);
    // First, middle and last participant each keep a real state for today's
    // predecessor — none of them silently became not_participating.
    for (const uid of ['u00', 'u10', 'u20']) {
      const p = parts.find((x) => x.userId === uid);
      expect(p, uid).toBeDefined();
      expect(p?.statesByDate.get(addDays(today, -3))).toBe(DayState.Missed);
    }
    // u20's genuine post-membership day is absent from the grid and therefore
    // renders as not_participating — the correct outcome, and the invariant
    // stays quiet because no *eligible* row is missing.
    const u20 = parts.find((x) => x.userId === 'u20');
    expect(u20?.statesByDate.get(today)).toBeUndefined();
    expect(u20?.todayState).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs an invariant error when eligible day-state rows are missing (truncation regression)', async () => {
    const roster = [
      member({ userId: 'u00', displayName: 'Self' }),
      member({ userId: 'u01', displayName: 'Truncated Away' }),
    ];
    // u01's rows never arrived — the exact shape of a PostgREST row-cap cut.
    const rows = eligibleGrid([roster[0]!]);

    mocks.fetchMyPrimaryChallenge.mockResolvedValue({
      challenge: CHALLENGE,
      membership: {
        userId: 'u00',
        participationStartDate: CHALLENGE.startDate,
        participationEndDate: null,
        active: true,
      },
    });
    mocks.fetchChallengeRoster.mockResolvedValue(roster);
    mocks.fetchDayStates.mockResolvedValue(rows);
    mocks.fetchSelfEntries.mockResolvedValue([]);
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { result } = renderHook(() => useChallengeData(), {
      wrapper: wrapper('u00'),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('missing eligible-day rows');
    expect(errSpy.mock.calls[0]?.[0]).toContain('Truncated Away');
    errSpy.mockRestore();
  });
});
