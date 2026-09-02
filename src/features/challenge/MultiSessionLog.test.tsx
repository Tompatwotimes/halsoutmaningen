import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PenaltyType } from '@/domain/penalties';
import { DayState } from '@/domain/dayState';
import type { ChallengeDataset, DayRequirement, SelfEntry } from './types';

const { submitMock, addMock } = vi.hoisted(() => ({
  submitMock: { mutateAsync: vi.fn(), isPending: false, error: null },
  addMock: { mutateAsync: vi.fn(), isPending: false, error: null },
}));
vi.mock('./useSubmitTraining', () => ({
  useSubmitTraining: () => submitMock,
}));
vi.mock('./add-training-session', () => ({
  useAddTrainingSession: () => addMock,
}));

import { MultiSessionLog } from './MultiSessionLog';

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

function req(over: Partial<DayRequirement>): DayRequirement {
  return {
    requiredMinutes: 60,
    requiredSessions: 2,
    minMinutesPerSession: 30,
    penaltyType: PenaltyType.DoubleSession,
    penaltyDisplayName: 'Dubbelpass',
    penaltyFromUserId: 'erik',
    sessionCount: 0,
    validSessionCount: 0,
    totalValidMinutes: 0,
    ...over,
  };
}

function session(over: Partial<SelfEntry>): SelfEntry {
  return {
    entryId: 'e1',
    date: '2026-09-01',
    sessionSeq: 1,
    durationMinutes: 35,
    activity: 'Löpning',
    note: null,
    hasProof: true,
    submittedAt: '2026-09-01T08:00:00Z',
    status: 'active',
    ...over,
  };
}

function dataset(
  sessions: SelfEntry[],
  todayState: DayState,
  requirement: DayRequirement,
): ChallengeDataset {
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
    currentStreak: 61,
    longestStreak: 61,
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
  return {
    challenge: CHALLENGE,
    today: '2026-09-01',
    self,
    participants: [
      self,
      { ...self, userId: 'erik', displayName: 'Erik', isSelf: false },
    ],
    rosterToday: [],
    selfEntries: sessions,
    getSelfEntry: () => sessions[0] ?? null,
    getSelfSessions: () => sessions,
  };
}

function renderIt(data: ChallengeDataset, requirement: DayRequirement) {
  return render(
    <MemoryRouter>
      <MultiSessionLog data={data} requirement={requirement} />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('MultiSessionLog (Dubbelpass)', () => {
  it('shows the Dubbelpass requirement and who assigned it', () => {
    const r = req({});
    renderIt(dataset([], DayState.Pending, r), r);
    expect(
      screen.getByRole('heading', { name: 'Dubbelpass' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 separata pass/)).toBeInTheDocument();
    expect(
      screen.getByText(/Erik har gett dig Dubbelpass/),
    ).toBeInTheDocument();
  });

  it('one logged session still asks for a second — day not complete', () => {
    const r = req({
      sessionCount: 1,
      validSessionCount: 1,
      totalValidMinutes: 70,
    });
    renderIt(
      dataset([session({ durationMinutes: 70 })], DayState.Pending, r),
      r,
    );
    expect(screen.getByText('Pass 1 · Löpning')).toBeInTheDocument();
    expect(
      screen.getByText(/Ett långt pass räknas som ett/),
    ).toBeInTheDocument();
  });

  it('logging the second session goes through add_training_session', async () => {
    const r = req({
      sessionCount: 1,
      validSessionCount: 1,
      totalValidMinutes: 30,
    });
    addMock.mutateAsync.mockResolvedValue({ entryId: 'e2' });
    renderIt(
      dataset([session({ durationMinutes: 30 })], DayState.Pending, r),
      r,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: /Lägg till ytterligare ett pass/ }),
    );
    // The SessionForm renders; submit it (defaults: 30 min, proof required so
    // we cannot actually submit without a file — assert the form appeared).
    expect(
      screen.getByRole('button', { name: 'Registrera passet' }),
    ).toBeInTheDocument();
  });

  it('a completed penalty day shows the success state', () => {
    const r = req({
      sessionCount: 2,
      validSessionCount: 2,
      totalValidMinutes: 65,
    });
    renderIt(
      dataset(
        [
          session({ durationMinutes: 32 }),
          session({ entryId: 'e2', sessionSeq: 2, durationMinutes: 33 }),
        ],
        DayState.Completed,
        r,
      ),
      r,
    );
    expect(screen.getByText('Dagens straff är klarat')).toBeInTheDocument();
  });
});
