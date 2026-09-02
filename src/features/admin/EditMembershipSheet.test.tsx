import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChallengeStatus } from '@/domain/challenge';
import type { RosterMember } from '@/features/challenge/roster-api';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));
vi.mock('./membership-api', () => ({
  useUpdateMembership: () => ({
    mutateAsync: updateMock,
    isPending: false,
    error: null,
  }),
}));

import { EditMembershipSheet } from './EditMembershipSheet';

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

function member(over: Partial<RosterMember> = {}): RosterMember {
  return {
    membershipId: 'm1',
    userId: 'anna',
    displayName: 'Anna Berg',
    avatarPath: null,
    role: 'participant',
    profileActive: true,
    participationStartDate: '2026-08-01',
    participationEndDate: null,
    membershipActive: true,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  };
}

function renderIt(m: RosterMember) {
  return render(
    <EditMembershipSheet
      open
      onClose={vi.fn()}
      challenge={CHALLENGE}
      today="2026-09-15"
      member={m}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('EditMembershipSheet', () => {
  it('save is disabled until something changes', () => {
    renderIt(member());
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled();
  });

  it('"Avsluta idag" sets the end date to today and enables save', async () => {
    renderIt(member());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Avsluta idag' }));
    await user.click(screen.getByRole('button', { name: 'Spara' }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: 'm1',
        participationEndDate: '2026-09-15',
        active: true,
      }),
    );
  });

  it('deactivating preserves the window (active flag only)', async () => {
    renderIt(member());
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Spara' }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        participationStartDate: '2026-08-01',
        participationEndDate: null,
      }),
    );
  });

  it('rejects an end date before the start date', () => {
    renderIt(member({ participationStartDate: '2026-09-01' }));
    fireEvent.change(screen.getByLabelText(/Deltagande till/), {
      target: { value: '2026-08-15' },
    });
    expect(
      screen.getByText('Slutdatum kan inte vara före startdatum.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled();
  });
});
