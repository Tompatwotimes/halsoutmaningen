import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { addDays } from '@/domain/dates';
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

const CHALLENGE: ChallengeConfig = {
  id: 'c1',
  name: 'Test Challenge',
  description: null,
  // Wide range so "real now" always falls inside — the test controls state
  // values directly via the mocked day-states rows, not via calendar math.
  startDate: '2000-01-01',
  endDate: '2100-12-31',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

const today = currentPlainDateInTimeZone(CHALLENGE.timeZone);

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
    const rows: DayStateRow[] = [
      dsRow({
        userId: 'self',
        challengeDate: today,
        state: DayState.Completed,
        sessionCount: 1,
        validSessionCount: 1,
        totalValidMinutes: 40,
      }),
      dsRow({ userId: 'full', challengeDate: today, state: DayState.Pending }),
      dsRow({
        userId: 'paused',
        challengeDate: today,
        state: DayState.Pending,
      }),
    ];

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
    const rows: DayStateRow[] = [
      dsRow({
        userId: 'self',
        challengeDate: addDays(today, -2),
        state: DayState.Completed,
        sessionCount: 1,
        validSessionCount: 1,
        totalValidMinutes: 40,
      }),
      dsRow({
        userId: 'self',
        challengeDate: addDays(today, -1),
        state: DayState.Missed,
      }),
      dsRow({ userId: 'self', challengeDate: today, state: DayState.Pending }),
      // The late joiner has no eligible rows before their start date at all —
      // days before `participationStartDate` must never appear as "missed".
      dsRow({ userId: 'late', challengeDate: today, state: DayState.Pending }),
    ];

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
    expect(late?.liability.missedDays).toBe(0);
    expect(late?.days.length).toBe(1);
    expect(self?.liability.missedDays).toBe(1);
    expect(self?.days.length).toBe(3);
  });
});
