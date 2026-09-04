import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PenaltyType } from '@/domain/penalties';

const { fetchMock, cancelMutateMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<(challengeId: string) => Promise<unknown[]>>(),
  cancelMutateMock: vi.fn(),
}));

vi.mock('@/features/straffbanken/straffbank-api', () => ({
  fetchPenaltyAssignments: fetchMock,
}));
vi.mock('@/features/straffbanken/useStraffbank', () => ({
  useCancelPenaltyAssignment: () => ({
    mutateAsync: cancelMutateMock,
    isPending: false,
    error: null,
  }),
}));

import { AdminPenaltyAssignments } from './AdminPenaltyAssignments';

const NAMES: Record<string, string> = { erik: 'Erik Ek', anna: 'Anna Berg' };
const nameOf = (id: string) => NAMES[id] ?? id;

function assignment(over: Record<string, unknown>) {
  return {
    id: 'a1',
    challengeId: 'c1',
    earnedPenaltyId: 'e1',
    fromUserId: 'erik',
    toUserId: 'anna',
    targetDate: '2026-09-10',
    penaltyType: PenaltyType.MinimumMinutes,
    value: 60,
    displayName: '60-minutaren',
    status: 'active',
    cancelledReason: null,
    cancelledAt: null,
    createdAt: '',
    ...over,
  };
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminPenaltyAssignments
        challengeId="c1"
        today="2026-09-01"
        nameOf={nameOf}
        adminUserId="admin"
      />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('AdminPenaltyAssignments', () => {
  it('lists only active assignments with a future target date, sender → recipient', async () => {
    fetchMock.mockResolvedValue([
      assignment({ id: 'future', targetDate: '2026-09-10' }),
      assignment({ id: 'past', targetDate: '2026-08-20' }),
      assignment({
        id: 'cancelled',
        targetDate: '2026-09-15',
        status: 'cancelled',
      }),
    ]);
    renderIt();
    expect(await screen.findByText(/Erik Ek/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ångra' })).toHaveLength(1);
  });

  it('cancellation requires a reason and calls cancel_penalty_assignment', async () => {
    fetchMock.mockResolvedValue([assignment({})]);
    cancelMutateMock.mockResolvedValue(undefined);
    renderIt();
    // delay: null — Sheet's open effect schedules a requestAnimationFrame
    // that autofocuses the panel's first focusable element (the Cancel
    // button, before this textarea in DOM order); under jsdom that rAF can
    // land mid-`type()` with the default per-keystroke delay and steal focus
    // away, truncating the typed reason (root-caused and reproduced against
    // AdminRetroactiveReview.test.tsx's identical pattern: ~80-93% failure
    // over 15 isolated reps with the default delay, 0% with delay: null).
    // Never manifests in a real browser (rAF resolves well before any human
    // keystroke) — a jsdom/test-timing artifact, not a product bug.
    const user = userEvent.setup({ delay: null });

    await user.click(await screen.findByRole('button', { name: 'Ångra' }));
    const confirm = screen.getByRole('button', { name: 'Ja, ångra straffet' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/fel person/), 'fel person');
    await user.click(
      screen.getByRole('button', { name: 'Ja, ångra straffet' }),
    );

    expect(cancelMutateMock).toHaveBeenCalledWith({
      assignmentId: 'a1',
      reason: 'fel person',
    });
  });

  it('shows an empty state when nothing is pending', async () => {
    fetchMock.mockResolvedValue([]);
    renderIt();
    expect(
      await screen.findByText('Inga aktiva straff framåt'),
    ).toBeInTheDocument();
  });
});
