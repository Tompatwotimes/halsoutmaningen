import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PenaltyType } from '@/domain/penalties';
import type { DayRequirement } from '@/features/challenge/types';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const { submitMock, uploadMock } = vi.hoisted(() => ({
  submitMock: {
    mutateAsync: vi.fn<(...a: unknown[]) => Promise<{ requestId: string }>>(),
    isPending: false,
  },
  uploadMock: vi.fn<
    (...a: unknown[]) => Promise<{
      storagePath: string;
      mimeType: string;
      sizeBytes: number;
      width: number;
      height: number;
    }>
  >(),
}));

vi.mock('./useRetroactive', () => ({
  useSubmitRetroactive: () => submitMock,
}));
vi.mock('./retroactive-api', () => ({
  RetroactiveError: class RetroactiveError extends Error {},
  uploadRetroactiveProof: (...a: unknown[]) => uploadMock(...a),
  removeRetroactiveProofs: vi.fn(),
}));

import { RetroactiveRequestSheet } from './RetroactiveRequestSheet';

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

function normalReq(): DayRequirement {
  return {
    requiredMinutes: 30,
    requiredSessions: 1,
    minMinutesPerSession: 0,
    penaltyType: null,
    penaltyDisplayName: null,
    penaltyFromUserId: null,
    sessionCount: 0,
    validSessionCount: 0,
    totalValidMinutes: 0,
  };
}

function render_(requirement: DayRequirement) {
  return render(
    <RetroactiveRequestSheet
      open
      onClose={() => undefined}
      challenge={CHALLENGE}
      userId="u1"
      challengeDate="2026-09-10"
      requirement={requirement}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  submitMock.isPending = false;
});

describe('RetroactiveRequestSheet', () => {
  it('shows the historical day requirement', () => {
    render_(normalReq());
    expect(
      screen.getByText(/Dagens krav var 30 min \+ bildbevis/),
    ).toBeInTheDocument();
  });

  it('shows the Dubbelpass requirement clearly', () => {
    render_({
      ...normalReq(),
      requiredMinutes: 60,
      requiredSessions: 2,
      minMinutesPerSession: 30,
      penaltyType: PenaltyType.DoubleSession,
      penaltyDisplayName: 'Dubbelpass',
    });
    expect(
      screen.getByText(/Dagens krav var Dubbelpass · 2 × minst 30 min/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ett långt pass räknas som ett/),
    ).toBeInTheDocument();
  });

  it('requires a reason before submitting', async () => {
    const user = userEvent.setup();
    render_(normalReq());
    // No session, no reason yet.
    await user.click(
      screen.getByRole('button', { name: 'Skicka efterregistrering' }),
    );
    expect(screen.getByText('En kort motivering krävs.')).toBeInTheDocument();
    expect(screen.getByText('Lägg till minst ett pass.')).toBeInTheDocument();
    expect(submitMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('submits a proposed session with proof + reason', async () => {
    const user = userEvent.setup();
    submitMock.mutateAsync.mockResolvedValue({ requestId: 'r1' });
    uploadMock.mockResolvedValue({
      storagePath: 'c1/u1/2026-09-10/x.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      width: 10,
      height: 10,
    });
    render_(normalReq());

    await user.click(screen.getByLabelText('Öka med 5 minuter')); // 35 min
    await user.upload(
      screen.getByLabelText('Välj bild från galleriet'),
      new File(['x'], 'p.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: 'Lägg till passet' }));

    expect(screen.getByText(/Pass 1 · Träning/)).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/Ingen täckning/),
      'Var utan uppkoppling',
    );
    await user.click(
      screen.getByRole('button', { name: 'Skicka efterregistrering' }),
    );

    expect(uploadMock).toHaveBeenCalledOnce();
    expect(submitMock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'c1',
        challengeDate: '2026-09-10',
        reason: 'Var utan uppkoppling',
        sessions: [
          expect.objectContaining({
            durationMinutes: 35,
            proof: expect.objectContaining({
              storagePath: 'c1/u1/2026-09-10/x.jpg',
            }),
          }),
        ],
      }),
    );
    expect(
      await screen.findByText('Efterregistreringen är inskickad'),
    ).toBeInTheDocument();
  });
});
