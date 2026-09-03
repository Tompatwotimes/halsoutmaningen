import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RetroactiveRequestRow } from './retroactive-api';

const { sessionsMock, previewMock, reviewMock } = vi.hoisted(() => ({
  sessionsMock: vi.fn<() => Record<string, unknown>>(),
  previewMock: vi.fn<() => Record<string, unknown>>(),
  reviewMock: {
    approve: { mutate: vi.fn(), isPending: false, error: null },
    reject: { mutate: vi.fn(), isPending: false, error: null },
  },
}));

vi.mock('./useRetroactive', () => ({
  useRetroactiveSessions: () => sessionsMock(),
  useApprovalPreview: () => previewMock(),
  useReviewRetroactive: () => reviewMock,
}));
vi.mock('./RetroactiveProofThumb', () => ({
  RetroactiveProofThumb: ({ path }: { path: string | null }) =>
    path ? <div data-testid="proof" /> : null,
}));

import { AdminRetroactiveReview } from './AdminRetroactiveReview';

const REQUEST: RetroactiveRequestRow = {
  id: 'r1',
  userId: 'u-robin',
  challengeDate: '2026-09-03',
  participantReason: 'Ingen täckning under kvällen.',
  status: 'pending',
  submittedAt: '2026-09-04T20:00:00Z',
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
  sessionCount: 1,
};

function setup() {
  sessionsMock.mockReturnValue({
    isLoading: false,
    data: [
      {
        durationMinutes: 42,
        activity: 'Löpning',
        note: null,
        proofStoragePath: 'c1/u-robin/2026-09-03/x.jpg',
      },
    ],
  });
  previewMock.mockReturnValue({
    isLoading: false,
    data: {
      requiredMinutes: 30,
      requiredSessions: 1,
      minMinutesPerSession: 0,
      existingValidSessions: 0,
      existingValidMinutes: 0,
      wouldComplete: true,
      debtDeltaSek: -50,
    },
  });
  return render(
    <AdminRetroactiveReview
      challengeId="c1"
      request={REQUEST}
      participantName="Robin J"
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('AdminRetroactiveReview', () => {
  it('renders the participant, date, reason, proposed session and proof', () => {
    setup();
    expect(screen.getByText('Robin J')).toBeInTheDocument();
    expect(
      screen.getByText(/Ingen täckning under kvällen/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Löpning · 42 min/)).toBeInTheDocument();
    expect(screen.getByTestId('proof')).toBeInTheDocument();
  });

  it('shows the debt-impact preview line', () => {
    setup();
    expect(
      screen.getByText(
        /Vid godkännande blir dagen genomförd och skulden minskar med 50 kr/,
      ),
    ).toBeInTheDocument();
  });

  it('confirms before approving', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Godkänn' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Godkänn' }));
    expect(reviewMock.approve.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r1', targetUserId: 'u-robin' }),
      expect.anything(),
    );
  });

  it('requires a reason to reject', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Avslå' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Avslå' });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByPlaceholderText(/Bilden matchar inte/),
      'Fel datum',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(reviewMock.reject.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Fel datum' }),
      expect.anything(),
    );
  });
});
