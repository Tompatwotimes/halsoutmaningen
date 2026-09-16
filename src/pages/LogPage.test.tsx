import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DayState } from '@/domain/dayState';
import { PenaltyType } from '@/domain/penalties';
import type {
  ChallengeDataset,
  DayRequirement,
  SelfEntry,
} from '@/features/challenge/types';

const { useChallengeDataMock, useProfileMock } = vi.hoisted(() => ({
  useChallengeDataMock: vi.fn(),
  useProfileMock: vi.fn(() => ({ isAdmin: false })),
}));
vi.mock('@/features/challenge/useChallengeData', () => ({
  useChallengeData: useChallengeDataMock,
}));
vi.mock('@/features/profile/useProfile', () => ({
  useProfile: useProfileMock,
}));
vi.mock('@/features/challenge/MultiSessionLog', () => ({
  MultiSessionLog: ({ requirement }: { requirement: DayRequirement }) => (
    <div data-testid="multi-session-log">
      multi-session-log penalty={String(requirement.penaltyType)}
    </div>
  ),
}));
vi.mock('@/features/challenge/useSubmitTraining', () => ({
  useSubmitTraining: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/features/challenge/useEntryDetail', () => ({
  useEntryDetail: () => ({ data: undefined, isLoading: false }),
}));

import { LogPage } from './LogPage';

const CHALLENGE = {
  id: 'c1',
  name: 'Test',
  description: null,
  startDate: '2026-08-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: 'active' as const,
};

function normalReq(over: Partial<DayRequirement> = {}): DayRequirement {
  return {
    requiredMinutes: 30,
    requiredSessions: 1,
    minMinutesPerSession: 30,
    penaltyType: null,
    penaltyDisplayName: null,
    penaltyFromUserId: null,
    sessionCount: 0,
    validSessionCount: 0,
    totalValidMinutes: 0,
    qualifyingSessionCount: 0,
    qualifyingMinutes: 0,
    doublePassAchieved: false,
    ...over,
  };
}

function session(over: Partial<SelfEntry> = {}): SelfEntry {
  return {
    entryId: 'e1',
    date: '2026-09-01',
    sessionSeq: 1,
    durationMinutes: 15,
    activity: 'Löpning',
    note: null,
    hasProof: true,
    submittedAt: '2026-09-01T08:00:00Z',
    status: 'active',
    ...over,
  };
}

function mockData(
  sessions: SelfEntry[],
  todayState: DayState | null,
  requirement: DayRequirement | null,
) {
  const self = {
    userId: 'self',
    displayName: 'Du',
    role: 'participant' as const,
    isSelf: true,
    profileActive: true,
    membership: {
      userId: 'self',
      participationStartDate: '2026-08-01',
      participationEndDate: null,
      active: true,
    },
    membershipDisplay: {
      state: 'active' as const,
      label: 'Aktiv',
      effectiveStart: '',
      effectiveEnd: '',
    },
    days: [],
    statesByDate: new Map(),
    requirementByDate: new Map(),
    todayState,
    todayRequirement: requirement,
    activeToday: true,
    currentStreak: 3,
    longestStreak: 3,
    liability: {
      eligibleDays: 0,
      completedDays: 0,
      missedDays: 0,
      pendingDays: 0,
      futureDays: 0,
      maxApplicableLiability: 0,
      clearedAmount: 0,
      confirmedDebt: 0,
      remainingExposure: 0,
    },
    completionRate: 0,
    decidedDays: 0,
  };
  const data: ChallengeDataset = {
    challenge: CHALLENGE,
    today: '2026-09-01',
    self,
    participants: [self],
    rosterToday: [],
    selfEntries: sessions,
    getSelfEntry: () => sessions[0] ?? null,
    getSelfSessions: () => sessions,
  };
  useChallengeDataMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('LogPage routing (voluntary multi-session days)', () => {
  it('uses the simple LogForm for the FIRST session of an ordinary day', () => {
    mockData([], DayState.Pending, normalReq());
    renderPage();
    expect(screen.queryByTestId('multi-session-log')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Registrera passet' }),
    ).toBeInTheDocument();
  });

  it('switches to MultiSessionLog once a session already exists today, even with no penalty', () => {
    mockData([session({ durationMinutes: 15 })], DayState.Pending, normalReq());
    renderPage();
    expect(screen.getByTestId('multi-session-log')).toHaveTextContent(
      'penalty=null',
    );
  });

  it('switches to MultiSessionLog even before any session exists when a penalty is active', () => {
    mockData(
      [],
      DayState.Pending,
      normalReq({
        penaltyType: PenaltyType.MinimumMinutes,
        penaltyDisplayName: '45-minutaren',
        requiredMinutes: 45,
        minMinutesPerSession: 45,
      }),
    );
    renderPage();
    expect(screen.getByTestId('multi-session-log')).toHaveTextContent(
      'penalty=minimum_minutes',
    );
  });

  it('stays on MultiSessionLog once the day is already complete, so a participant can still log more', () => {
    mockData(
      [session({ durationMinutes: 30 })],
      DayState.Completed,
      normalReq({ qualifyingSessionCount: 1, qualifyingMinutes: 30 }),
    );
    renderPage();
    expect(screen.getByTestId('multi-session-log')).toBeInTheDocument();
  });
});
