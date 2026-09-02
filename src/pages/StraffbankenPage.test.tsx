import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChallengeStatus } from '@/domain/challenge';
import { PenaltyType } from '@/domain/penalties';

const { useChallengeDataMock, apiMock } = vi.hoisted(() => ({
  useChallengeDataMock: vi.fn<() => Record<string, unknown>>(),
  apiMock: {
    fetchEarnedPenalties: vi.fn(),
    fetchPenaltyDefinitions: vi.fn(),
    fetchPenaltyAssignments: vi.fn(),
    previewPenaltyTarget: vi.fn(),
    assignPenalty: vi.fn(),
    cancelPenaltyAssignment: vi.fn(),
  },
}));

vi.mock('@/features/challenge/useChallengeData', () => ({
  useChallengeData: () => useChallengeDataMock(),
  invalidateChallengeData: vi.fn(),
}));
vi.mock('@/features/straffbanken/straffbank-api', () => apiMock);

import { StraffbankenPage } from './StraffbankenPage';

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
  status: ChallengeStatus.Active,
};

function participant(over: Record<string, unknown>) {
  return {
    userId: 'x',
    displayName: 'X',
    role: 'participant',
    isSelf: false,
    profileActive: true,
    membership: {
      userId: 'x',
      participationStartDate: '2026-08-01',
      participationEndDate: null,
      active: true,
    },
    membershipDisplay: {
      state: 'active',
      label: 'Aktiv',
      effectiveStart: '',
      effectiveEnd: '',
    },
    days: [],
    statesByDate: new Map(),
    requirementByDate: new Map(),
    todayState: 'pending',
    todayRequirement: null,
    activeToday: true,
    currentStreak: 22,
    longestStreak: 30,
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
    ...over,
  };
}

function dataset() {
  const self = participant({ userId: 'self', displayName: 'Du', isSelf: true });
  const other = participant({ userId: 'erik', displayName: 'Erik' });
  return {
    challenge: CHALLENGE,
    today: '2026-09-01',
    self,
    participants: [self, other],
    rosterToday: [self, other],
    selfEntries: [],
    getSelfEntry: () => null,
    getSelfSessions: () => [],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StraffbankenPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('StraffbankenPage', () => {
  it('shows the inventory grouped by kind with a "Jävlas" action', async () => {
    useChallengeDataMock.mockReturnValue({
      data: dataset(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMock.fetchEarnedPenalties.mockResolvedValue([
      {
        id: 'e1',
        challengeId: 'c1',
        penaltyDefinitionId: 'd',
        streakRunStart: '2026-08-01',
        penaltyType: PenaltyType.MinimumMinutes,
        value: 45,
        displayName: '45-minutaren',
        earnedOnDate: '2026-08-20',
        status: 'available',
        spentAssignmentId: null,
      },
      {
        id: 'e2',
        challengeId: 'c1',
        penaltyDefinitionId: 'd',
        streakRunStart: '2026-08-01',
        penaltyType: PenaltyType.MinimumMinutes,
        value: 45,
        displayName: '45-minutaren',
        earnedOnDate: '2026-08-21',
        status: 'available',
        spentAssignmentId: null,
      },
    ]);
    apiMock.fetchPenaltyDefinitions.mockResolvedValue([]);
    apiMock.fetchPenaltyAssignments.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('45-minutaren')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jävlas/i })).toBeInTheDocument();
  });

  it('surfaces a received penalty as "Du har blivit straffad"', async () => {
    useChallengeDataMock.mockReturnValue({
      data: dataset(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMock.fetchEarnedPenalties.mockResolvedValue([]);
    apiMock.fetchPenaltyDefinitions.mockResolvedValue([]);
    apiMock.fetchPenaltyAssignments.mockResolvedValue([
      {
        id: 'a1',
        challengeId: 'c1',
        earnedPenaltyId: 'e',
        fromUserId: 'erik',
        toUserId: 'self',
        targetDate: '2026-09-05',
        penaltyType: PenaltyType.MinimumMinutes,
        value: 60,
        displayName: '60-minutaren',
        status: 'active',
        cancelledReason: null,
        cancelledAt: null,
        createdAt: '',
      },
    ]);

    renderPage();

    expect(
      await screen.findByText('Du har blivit straffad'),
    ).toBeInTheDocument();
    expect(screen.getByText('60-minutaren')).toBeInTheDocument();
  });

  it('runs the assignment flow: pick target -> preview date -> confirm', async () => {
    useChallengeDataMock.mockReturnValue({
      data: dataset(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMock.fetchEarnedPenalties.mockResolvedValue([
      {
        id: 'e1',
        challengeId: 'c1',
        penaltyDefinitionId: 'd',
        streakRunStart: '2026-08-01',
        penaltyType: PenaltyType.MinimumMinutes,
        value: 60,
        displayName: '60-minutaren',
        earnedOnDate: '2026-08-20',
        status: 'available',
        spentAssignmentId: null,
      },
    ]);
    apiMock.fetchPenaltyDefinitions.mockResolvedValue([]);
    apiMock.fetchPenaltyAssignments.mockResolvedValue([]);
    apiMock.previewPenaltyTarget.mockResolvedValue({
      ok: true,
      targetDate: '2026-09-03',
      displayName: '60-minutaren',
      reason: null,
    });
    apiMock.assignPenalty.mockResolvedValue({
      assignmentId: 'a1',
      toUserId: 'erik',
      targetDate: '2026-09-03',
      displayName: '60-minutaren',
    });

    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jävlas/i }));
    await user.click(await screen.findByRole('button', { name: /^Erik/i }));
    expect(await screen.findByText(/Slår till/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dela ut straffet' }));

    expect(
      await screen.findByText('Erik har fått 60-minutaren'),
    ).toBeInTheDocument();
    expect(apiMock.assignPenalty).toHaveBeenCalledWith('e1', 'erik');
  });
});
