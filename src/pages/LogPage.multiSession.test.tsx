import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { evaluateDayState } from '@/domain/dayState';
import type { ChallengeConfig } from '@/domain/challenge';
import type { ChallengeDataset, SelfEntry } from '@/features/challenge/types';

/**
 * v1.10.1 regression: completion must NEVER be a dead end for logging more
 * sessions the same day — there is no maximum, and an ordinary day's
 * "Logga ytterligare pass" affordance must survive across the FIRST session
 * (submitted via the plain LogForm) and every session after (via
 * MultiSessionLog). This file deliberately does NOT stub MultiSessionLog —
 * unlike LogPage.test.tsx's routing-only tests — so the real session list,
 * totals and "add another" flow are exercised end to end.
 */

const { useChallengeDataMock, useProfileMock, submitMock, addMock } =
  vi.hoisted(() => ({
    useChallengeDataMock: vi.fn(),
    useProfileMock: vi.fn(() => ({ isAdmin: false })),
    submitMock: { mutateAsync: vi.fn(), isPending: false, error: null },
    addMock: { mutateAsync: vi.fn(), isPending: false, error: null },
  }));
vi.mock('@/features/challenge/useChallengeData', () => ({
  useChallengeData: useChallengeDataMock,
}));
vi.mock('@/features/profile/useProfile', () => ({
  useProfile: useProfileMock,
}));
vi.mock('@/features/challenge/useSubmitTraining', () => ({
  useSubmitTraining: () => submitMock,
}));
vi.mock('@/features/challenge/add-training-session', () => ({
  useAddTrainingSession: () => addMock,
}));
vi.mock('@/features/challenge/useEntryDetail', () => ({
  useEntryDetail: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/features/retroactive/useRetroactive', () => ({
  useMyRetroactiveRequests: () => ({ data: [], refetch: vi.fn() }),
}));

import { LogPage } from './LogPage';

const CHALLENGE: ChallengeConfig = {
  id: 'c1',
  name: 'Test',
  description: null,
  startDate: '2026-08-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: false,
  missedDayCost: 50,
  status: 'active' as const,
};
const MEMBERSHIP = {
  userId: 'self',
  participationStartDate: '2026-08-01',
  participationEndDate: null,
  active: true,
};
const TODAY = '2026-09-01';

function makeSession(
  seq: number,
  durationMinutes: number,
  activity: string,
): SelfEntry {
  return {
    entryId: `e${String(seq)}`,
    date: TODAY,
    sessionSeq: seq,
    durationMinutes,
    activity,
    note: null,
    hasProof: true,
    submittedAt: `${TODAY}T08:00:00Z`,
    status: 'active',
  };
}

/** Builds a ChallengeDataset from a live session list, using the REAL
 * domain rule (never a hand-rolled completion check) so this test would
 * fail honestly if the canonical rule itself ever regressed. */
function buildData(sessions: SelfEntry[]): ChallengeDataset {
  const { state, requirement } = evaluateDayState({
    challenge: CHALLENGE,
    membership: MEMBERSHIP,
    date: TODAY,
    currentDate: TODAY,
    sessions,
  });
  const statesByDate = new Map([[TODAY, state]]);
  const requirementByDate = new Map([
    [
      TODAY,
      {
        requiredMinutes: requirement.requiredTotalMinutes,
        requiredSessions: requirement.requiredSessions,
        minMinutesPerSession: requirement.minMinutesPerSession,
        penaltyType: null,
        penaltyDisplayName: null,
        penaltyFromUserId: null,
        sessionCount: sessions.length,
        validSessionCount: sessions.length,
        totalValidMinutes: sessions.reduce(
          (sum, s) => sum + s.durationMinutes,
          0,
        ),
        qualifyingSessionCount: sessions.filter(
          (s) => s.durationMinutes >= requirement.minMinutesPerSession,
        ).length,
        qualifyingMinutes: sessions
          .filter((s) => s.durationMinutes >= requirement.minMinutesPerSession)
          .reduce((sum, s) => sum + s.durationMinutes, 0),
      },
    ],
  ]);
  const self = {
    userId: 'self',
    displayName: 'Du',
    role: 'participant' as const,
    isSelf: true,
    profileActive: true,
    membership: MEMBERSHIP,
    membershipDisplay: {
      state: 'active' as const,
      label: 'Aktiv',
      effectiveStart: '',
      effectiveEnd: '',
    },
    days: [{ date: TODAY, state }],
    statesByDate,
    requirementByDate,
    todayState: state,
    todayRequirement: requirementByDate.get(TODAY) ?? null,
    activeToday: true,
    currentStreak: sessions.length > 0 ? 1 : 0,
    longestStreak: 1,
    liability: {
      eligibleDays: 1,
      completedDays: state === 'completed' ? 1 : 0,
      missedDays: 0,
      pendingDays: state === 'completed' ? 0 : 1,
      futureDays: 0,
      maxApplicableLiability: 50,
      clearedAmount: state === 'completed' ? 50 : 0,
      confirmedDebt: 0,
      remainingExposure: state === 'completed' ? 0 : 50,
    },
    completionRate: state === 'completed' ? 1 : 0,
    decidedDays: state === 'completed' ? 1 : 0,
  };
  return {
    challenge: CHALLENGE,
    today: TODAY,
    self,
    participants: [self],
    rosterToday: [self],
    selfEntries: sessions,
    getSelfEntry: () => sessions[0] ?? null,
    getSelfSessions: () => sessions,
  };
}

afterEach(() => vi.clearAllMocks());

describe('LogPage + MultiSessionLog — completion never blocks further logging (v1.10.1)', () => {
  it('30 -> complete -> "Logga ytterligare pass" available -> +20 -> still one completed day, 50 min total -> a third session can still be started', async () => {
    let sessions: SelfEntry[] = [];
    useChallengeDataMock.mockImplementation(() => ({
      data: buildData(sessions),
      isLoading: false,
      isError: false,
      refetch: refetchImpl,
    }));

    let doRerender: (() => void) | null = null;
    const refetchImpl = vi.fn(() => {
      doRerender?.();
      return Promise.resolve();
    });

    submitMock.mutateAsync.mockImplementation(
      (input: { durationMinutes: number; activity: string | null }) => {
        sessions = [
          ...sessions,
          makeSession(1, input.durationMinutes, input.activity ?? 'Pass 1'),
        ];
        return Promise.resolve({ entryId: 'e1' });
      },
    );
    addMock.mutateAsync.mockImplementation(
      (input: { durationMinutes: number; activity: string | null }) => {
        sessions = [
          ...sessions,
          makeSession(
            sessions.length + 1,
            input.durationMinutes,
            input.activity ?? `Pass ${String(sessions.length + 1)}`,
          ),
        ];
        // In production, useAddTrainingSession's onSuccess calls
        // invalidateChallengeData, and the REAL useChallengeData() query
        // refetches automatically, flowing fresh `data` straight down to
        // MultiSessionLog with no refetch() call of its own needed. Since
        // useChallengeData is mocked here, simulate that same
        // invalidation-triggered refresh explicitly.
        doRerender?.();
        return Promise.resolve({ entryId: `e${String(sessions.length)}` });
      },
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // A fresh element on every call — `rerender` with the SAME element
    // reference lets React bail out without re-invoking LogPage at all,
    // which would defeat the whole point of simulating a refetch here.
    function buildTree() {
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <LogPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(buildTree());
    doRerender = () => rerender(buildTree());

    // 1. Log a qualifying 30-minute session via the plain first-session form.
    fireEvent.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() =>
      expect(screen.getByText('Passet registrerat')).toBeInTheDocument(),
    );

    // 2 & 3. Day is complete, and "Logga ytterligare pass" is right there —
    // never a dead end.
    const logMore = screen.getByRole('button', {
      name: 'Logga ytterligare pass',
    });
    expect(logMore).toBeInTheDocument();

    // Pulls the now-invalidated dataset and switches into MultiSessionLog.
    fireEvent.click(logMore);
    await waitFor(() =>
      expect(screen.getByText('Dagens krav uppfyllt')).toBeInTheDocument(),
    );
    expect(screen.getByText('1 pass · 30 min totalt')).toBeInTheDocument();

    // 4. Submit a second, 20-minute session through MultiSessionLog — well
    // below the 30-min floor, and still accepted: there is no minimum
    // length to log a session at all (v1.10.1).
    fireEvent.click(
      screen.getByRole('button', { name: 'Logga ytterligare pass' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Minska med 5 minuter' }),
    ); // 30 -> 25
    fireEvent.click(
      screen.getByRole('button', { name: 'Minska med 5 minuter' }),
    ); // 25 -> 20
    fireEvent.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() =>
      expect(screen.getByText('Pass 2 · Pass 2')).toBeInTheDocument(),
    );

    // 5. Still one completed day (never double-counted).
    expect(screen.getByText('Dagens krav uppfyllt')).toBeInTheDocument();
    // 6. Total training minutes reflect BOTH sessions, not just the
    // qualifying one.
    expect(screen.getByText('2 pass · 50 min totalt')).toBeInTheDocument();

    // 7. A third session can still be started — completion never caps it.
    expect(
      screen.getByRole('button', { name: 'Logga ytterligare pass' }),
    ).toBeInTheDocument();
  });

  it('an incomplete multi-session day (15+15) also keeps "Logga ytterligare pass" available', async () => {
    let sessions: SelfEntry[] = [];
    useChallengeDataMock.mockImplementation(() => ({
      data: buildData(sessions),
      isLoading: false,
      isError: false,
      refetch: refetchImpl,
    }));
    let doRerender: (() => void) | null = null;
    const refetchImpl = vi.fn(() => {
      doRerender?.();
      return Promise.resolve();
    });
    submitMock.mutateAsync.mockImplementation(
      (input: { durationMinutes: number; activity: string | null }) => {
        sessions = [
          ...sessions,
          makeSession(1, input.durationMinutes, input.activity ?? 'Pass 1'),
        ];
        return Promise.resolve({ entryId: 'e1' });
      },
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // A fresh element on every call — `rerender` with the SAME element
    // reference lets React bail out without re-invoking LogPage at all,
    // which would defeat the whole point of simulating a refetch here.
    function buildTree() {
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <LogPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    const { rerender } = render(buildTree());
    doRerender = () => rerender(buildTree());

    // Log a 15-minute session — deliberately below the 30-min floor. Still
    // accepted: there is no minimum length to log a session at all
    // (v1.10.1). Drive the stepper down 30 -> 25 -> 20 -> 15.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(
        screen.getByRole('button', { name: 'Minska med 5 minuter' }),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() =>
      expect(screen.getByText('Passet registrerat')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/dagens krav är inte uppfyllt än/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Logga ytterligare pass' }),
    );
    await waitFor(() =>
      expect(screen.getByText('1 pass · 15 min totalt')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Logga ytterligare pass' }),
    ).toBeInTheDocument();
  });
});
