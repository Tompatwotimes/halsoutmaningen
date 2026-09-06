import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WeightProfile } from './types';

const { useMyWeightProfileMock, useSetStartWeightMock } = vi.hoisted(() => ({
  useMyWeightProfileMock: vi.fn<() => Record<string, unknown>>(),
  useSetStartWeightMock: vi.fn<() => Record<string, unknown>>(),
}));
vi.mock('./useWeight', () => ({
  useMyWeightProfile: () => useMyWeightProfileMock(),
  useSetStartWeight: () => useSetStartWeightMock(),
}));

import { StartWeightCard } from './StartWeightCard';

function profile(over: Partial<WeightProfile> = {}): WeightProfile {
  return {
    challengeId: 'c1',
    userId: 'u1',
    startWeightKg: null,
    startWeightFirstSavedAt: null,
    startWeightLockedAt: null,
    isWeightHidden: false,
    officialFinalWeightKg: null,
    officialFinalRecordedAt: null,
    ...over,
  };
}

function prime(data: WeightProfile | null) {
  useMyWeightProfileMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  });
  useSetStartWeightMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('StartWeightCard', () => {
  it('before any start weight: shows an editable input + save, no lock/countdown', () => {
    prime(null);
    render(<StartWeightCard challengeId="c1" userId="u1" />);
    expect(screen.getByRole('spinbutton')).toBeEnabled();
    expect(screen.getByRole('button', { name: /spara/i })).toBeInTheDocument();
    expect(screen.queryByText(/låst/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/låses om/i)).not.toBeInTheDocument();
  });

  it('within the 24h window: input stays editable and a countdown is shown', () => {
    // now = 12:00; lock = 18:00 -> 6h left
    prime(
      profile({
        startWeightKg: 80,
        startWeightFirstSavedAt: '2026-09-05T18:00:00Z',
        startWeightLockedAt: '2026-09-06T18:00:00Z',
      }),
    );
    render(<StartWeightCard challengeId="c1" userId="u1" />);
    expect(screen.getByRole('spinbutton')).toBeEnabled();
    expect(screen.getByText(/låses om\s*6\s*h/i)).toBeInTheDocument();
  });

  it('after the lock: no editable input, a "låst" state is shown with the value', () => {
    prime(
      profile({
        startWeightKg: 80,
        startWeightFirstSavedAt: '2026-09-04T18:00:00Z',
        startWeightLockedAt: '2026-09-05T18:00:00Z',
      }),
    );
    render(<StartWeightCard challengeId="c1" userId="u1" />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText(/låst/i)).toBeInTheDocument();
    expect(screen.getByText(/80/)).toBeInTheDocument();
  });

  it('submitting a first start weight calls useSetStartWeight with the number', async () => {
    const mutate = vi.fn();
    useMyWeightProfileMock.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    useSetStartWeightMock.mockReturnValue({ mutate, isPending: false });
    const user = userEvent.setup();
    render(<StartWeightCard challengeId="c1" userId="u1" />);
    await user.type(screen.getByRole('spinbutton'), '82.5');
    await user.click(screen.getByRole('button', { name: /spara/i }));
    expect(mutate).toHaveBeenCalledWith({ challengeId: 'c1', weightKg: 82.5 });
  });
});
