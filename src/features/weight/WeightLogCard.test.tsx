import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WeightEntry } from './types';

const { useMyWeightEntriesMock, useLogWeightEntryMock } = vi.hoisted(() => ({
  useMyWeightEntriesMock: vi.fn<() => Record<string, unknown>>(),
  useLogWeightEntryMock: vi.fn<() => Record<string, unknown>>(),
}));
vi.mock('./useWeight', () => ({
  useMyWeightEntries: () => useMyWeightEntriesMock(),
  useLogWeightEntry: () => useLogWeightEntryMock(),
}));

import { WeightLogCard } from './WeightLogCard';

function entry(date: string, kg: number): WeightEntry {
  return {
    id: `e-${date}`,
    challengeId: 'c1',
    userId: 'u1',
    entryDate: date,
    weightKg: kg,
  };
}

function prime(entries: WeightEntry[]) {
  useMyWeightEntriesMock.mockReturnValue({
    data: entries,
    isLoading: false,
    isError: false,
  });
  useLogWeightEntryMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

afterEach(() => vi.clearAllMocks());

describe('WeightLogCard', () => {
  it("renders today's value as an editable numeric field and a history list", () => {
    prime([entry('2026-09-06', 79.1), entry('2026-09-05', 79.8)]);
    const { container } = render(
      <WeightLogCard challengeId="c1" userId="u1" today="2026-09-06" />,
    );
    expect(screen.getByRole('spinbutton')).toBeEnabled();
    expect(screen.getByText(/79\.8/)).toBeInTheDocument();
    // history rows present
    expect(
      container.querySelectorAll('[data-testid="weight-history-row"]').length,
    ).toBeGreaterThan(0);
  });

  it('NEVER renders a date input — backdating is not even offered', () => {
    prime([entry('2026-09-06', 79.1)]);
    const { container } = render(
      <WeightLogCard challengeId="c1" userId="u1" today="2026-09-06" />,
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector('input[type="month"]')).toBeNull();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('submitting calls useLogWeightEntry with only a weight value', async () => {
    const mutate = vi.fn();
    useMyWeightEntriesMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    useLogWeightEntryMock.mockReturnValue({ mutate, isPending: false });
    const user = userEvent.setup();
    render(<WeightLogCard challengeId="c1" userId="u1" today="2026-09-06" />);
    await user.type(screen.getByRole('spinbutton'), '78.4');
    await user.click(screen.getByRole('button', { name: /logga|spara/i }));
    expect(mutate).toHaveBeenCalledWith({ challengeId: 'c1', weightKg: 78.4 });
  });
});
