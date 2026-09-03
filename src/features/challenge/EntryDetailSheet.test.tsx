import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PenaltyType } from '@/domain/penalties';
import type { DayDetail } from './useEntryDetail';
import type { DayRequirement } from './types';

const { entryDetailMock, profileMock, correctionMock } = vi.hoisted(() => ({
  entryDetailMock: vi.fn<() => Record<string, unknown>>(),
  profileMock: vi.fn<() => { isAdmin: boolean }>(),
  correctionMock: {
    invalidate: { mutateAsync: vi.fn(), isPending: false, error: null },
    revalidate: { mutateAsync: vi.fn(), isPending: false, error: null },
  },
}));

vi.mock('./useEntryDetail', () => ({
  useEntryDetail: () => entryDetailMock(),
}));
vi.mock('@/features/profile/useProfile', () => ({
  useProfile: () => profileMock(),
}));
vi.mock('@/features/admin/corrections-api', () => ({
  INVALIDATION_REASONS: [
    { code: 'felregistrerad', label: 'Felaktigt registrerat' },
    { code: 'annat', label: 'Annat' },
  ],
  useTrainingCorrection: () => correctionMock,
}));
vi.mock('@/components/proof/SignedProofImage', () => ({
  SignedProofImage: () => <div data-testid="proof" />,
}));

import { EntryDetailSheet, type RetroactivePrompt } from './EntryDetailSheet';

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

const min60: DayRequirement = {
  requiredMinutes: 60,
  requiredSessions: 1,
  minMinutesPerSession: 0,
  penaltyType: PenaltyType.MinimumMinutes,
  penaltyDisplayName: '60-minutaren',
  penaltyFromUserId: null,
  sessionCount: 1,
  validSessionCount: 0,
  totalValidMinutes: 35,
};

function detail(over: Partial<DayDetail['sessions'][number]> = {}): DayDetail {
  return {
    sessions: [
      {
        entryId: 'e1',
        date: '2026-08-15',
        sessionSeq: 1,
        durationMinutes: 35,
        activity: 'Löpning',
        note: null,
        submittedAt: '2026-08-15T08:00:00Z',
        status: 'active',
        invalidatedReason: null,
        proofSignedUrl: 'blob:x',
        ...over,
      },
    ],
  };
}

function renderSheet(requirement: DayRequirement | null, isAdmin = false) {
  entryDetailMock.mockReturnValue({
    data: detail(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  profileMock.mockReturnValue({ isAdmin });
  return render(
    <EntryDetailSheet
      open
      onClose={vi.fn()}
      challenge={CHALLENGE}
      participantName="Anna"
      isSelf={false}
      userId="anna"
      date="2026-08-15"
      requirement={requirement}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('EntryDetailSheet requirement agreement', () => {
  it('a 60-minute penalty day shows the day is short of the requirement', () => {
    renderSheet(min60);
    // the day still needs 60 total; only 35 valid so far
    expect(screen.getByText(/35\/60 giltiga/)).toBeInTheDocument();
    expect(screen.getByText(/60-minutaren/)).toBeInTheDocument();
  });

  it('the session itself counts on a normal day', () => {
    renderSheet(null);
    expect(screen.getByText('Räknas')).toBeInTheDocument();
  });

  it('an admin can start an invalidation and it requires a reason', async () => {
    renderSheet(null, true);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Ogiltigförklara passet' }),
    );
    const confirm = screen.getByRole('button', { name: 'Bekräfta' });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByPlaceholderText('Anledning (obligatorisk)'),
      'dubbelregistrerat',
    );
    expect(screen.getByRole('button', { name: 'Bekräfta' })).toBeEnabled();
  });

  it('a participant sees no correction controls', () => {
    renderSheet(null, false);
    expect(
      screen.queryByRole('button', { name: 'Ogiltigförklara passet' }),
    ).not.toBeInTheDocument();
  });
});

describe('EntryDetailSheet — efterregistrering affordance', () => {
  function renderWithRetro(retro: RetroactivePrompt) {
    entryDetailMock.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    profileMock.mockReturnValue({ isAdmin: false });
    return render(
      <EntryDetailSheet
        open
        onClose={vi.fn()}
        challenge={CHALLENGE}
        participantName="Du"
        isSelf
        userId="self"
        date="2026-08-15"
        requirement={null}
        retroactive={retro}
      />,
    );
  }

  it('offers "Begär efterregistrering" on a self past missed day', async () => {
    const onRequest = vi.fn();
    renderWithRetro({ canRequest: true, existing: null, onRequest });
    const btn = screen.getByRole('button', {
      name: 'Begär efterregistrering',
    });
    await userEvent.setup().click(btn);
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('shows a pending status instead of the request button', () => {
    renderWithRetro({
      canRequest: true,
      existing: {
        id: 'r1',
        userId: 'self',
        challengeDate: '2026-08-15',
        participantReason: 'x',
        status: 'pending',
        submittedAt: '2026-08-16T00:00:00Z',
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
        sessionCount: 1,
      },
      onRequest: vi.fn(),
    });
    expect(
      screen.getByText('Efterregistrering väntar på godkännande.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Begär efterregistrering' }),
    ).not.toBeInTheDocument();
  });

  it('shows nothing when the day is not eligible for a request', () => {
    renderWithRetro({ canRequest: false, existing: null, onRequest: vi.fn() });
    expect(
      screen.queryByRole('button', { name: 'Begär efterregistrering' }),
    ).not.toBeInTheDocument();
  });
});
