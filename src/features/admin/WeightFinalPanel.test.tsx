import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  useParticipantsMock,
  useAdminWeightProfilesMock,
  setFinalMock,
  finalizeMock,
  discloseMock,
} = vi.hoisted(() => ({
  useParticipantsMock: vi.fn<() => Record<string, unknown>>(),
  useAdminWeightProfilesMock: vi.fn<() => Record<string, unknown>>(),
  setFinalMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
  finalizeMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    data: null as {
      winnerUserId: string;
      winnerPercentageChange: number;
    } | null,
  },
  discloseMock: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@/features/admin/participants-api', () => ({
  useParticipants: () => useParticipantsMock(),
}));
vi.mock('./weight-admin-api', () => ({
  useAdminWeightProfiles: () => useAdminWeightProfilesMock(),
  useSetOfficialFinalWeight: () => setFinalMock,
  useFinalizeWeightCompetition: () => finalizeMock,
  useDiscloseWeightWinner: () => discloseMock,
}));

import { WeightFinalPanel } from './WeightFinalPanel';

afterEach(() => {
  vi.clearAllMocks();
  finalizeMock.data = null;
});

function prime() {
  useParticipantsMock.mockReturnValue({
    data: [
      { userId: 'u1', displayName: 'Pia' },
      { userId: 'u2', displayName: 'Rex' },
    ],
    isLoading: false,
    isError: false,
  });
  useAdminWeightProfilesMock.mockReturnValue({
    data: [
      {
        userId: 'u1',
        startWeightKg: 80,
        officialFinalWeightKg: null,
        isWeightHidden: false,
      },
      {
        userId: 'u2',
        startWeightKg: 100,
        officialFinalWeightKg: null,
        isWeightHidden: true,
      },
    ],
    isLoading: false,
    isError: false,
  });
}

describe('WeightFinalPanel', () => {
  it('records an official final weight through a mandatory-reason confirm', async () => {
    prime();
    const user = userEvent.setup({ delay: null });
    render(<WeightFinalPanel challengeId="c1" />);

    const piaRow = screen.getByText('Pia').closest('li')!;
    await user.type(within(piaRow).getByRole('spinbutton'), '78.2');
    await user.click(
      within(piaRow).getByRole('button', { name: /registrera/i }),
    );

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /registrera/i });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'Officiell invägning');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(setFinalMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        weightKg: 78.2,
        reason: 'Officiell invägning',
      }),
      expect.anything(),
    );
  });

  it('finalises the competition and shows the computed winner', async () => {
    prime();
    finalizeMock.data = { winnerUserId: 'u2', winnerPercentageChange: -8 };
    const user = userEvent.setup({ delay: null });
    render(<WeightFinalPanel challengeId="c1" />);

    await user.click(
      screen.getByRole('button', { name: /fastställ vinnare/i }),
    );
    expect(finalizeMock.mutate).toHaveBeenCalled();
    // winner shown from the mutation's returned data
    const winnerBox = screen.getByTestId('weight-winner');
    expect(within(winnerBox).getByText(/Rex/)).toBeInTheDocument();
    expect(within(winnerBox).getByText(/-8\s*%/)).toBeInTheDocument();
  });

  it('shows "Publicera vinnare" only after a winner has been finalised', async () => {
    prime();
    const { rerender } = render(<WeightFinalPanel challengeId="c1" />);
    expect(
      screen.queryByRole('button', { name: /publicera vinnare/i }),
    ).not.toBeInTheDocument();

    finalizeMock.data = { winnerUserId: 'u2', winnerPercentageChange: -8 };
    rerender(<WeightFinalPanel challengeId="c1" />);
    const user = userEvent.setup({ delay: null });
    await user.click(
      screen.getByRole('button', { name: /publicera vinnare/i }),
    );
    expect(discloseMock.mutate).toHaveBeenCalled();
  });

  it('offers NO control to hide a participant or view hidden history', () => {
    prime();
    render(<WeightFinalPanel challengeId="c1" />);
    // Rex is hidden — the panel shows a marker but no toggle, and never his
    // weight entries / chart.
    expect(
      screen.queryByRole('switch', { name: /dölj|hide/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /visa historik|dölj vikt/i }),
    ).not.toBeInTheDocument();
  });
});
