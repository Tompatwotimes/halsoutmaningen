import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useSetWeightHiddenMock } = vi.hoisted(() => ({
  useSetWeightHiddenMock: vi.fn<() => Record<string, unknown>>(),
}));
vi.mock('./useWeight', () => ({
  useSetWeightHidden: () => useSetWeightHiddenMock(),
}));

import { WeightPrivacyToggle } from './WeightPrivacyToggle';

afterEach(() => vi.clearAllMocks());

describe('WeightPrivacyToggle', () => {
  it('renders a role=switch and reflects the current hidden state', () => {
    useSetWeightHiddenMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    render(<WeightPrivacyToggle challengeId="c1" isHidden={false} />);
    const sw = screen.getByRole('switch', { name: /dölj min vikt/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles on: calls useSetWeightHidden with hidden=true', async () => {
    const mutate = vi.fn();
    useSetWeightHiddenMock.mockReturnValue({ mutate, isPending: false });
    const user = userEvent.setup();
    render(<WeightPrivacyToggle challengeId="c1" isHidden={false} />);
    await user.click(screen.getByRole('switch', { name: /dölj min vikt/i }));
    expect(mutate).toHaveBeenCalledWith({ challengeId: 'c1', hidden: true });
  });

  it('toggles off: calls with hidden=false (works with no start weight)', async () => {
    const mutate = vi.fn();
    useSetWeightHiddenMock.mockReturnValue({ mutate, isPending: false });
    const user = userEvent.setup();
    render(<WeightPrivacyToggle challengeId="c1" isHidden={true} />);
    const sw = screen.getByRole('switch', { name: /dölj min vikt/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    expect(mutate).toHaveBeenCalledWith({ challengeId: 'c1', hidden: false });
  });
});
