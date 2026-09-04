import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameMasterSettings } from '@/features/game-master/types';

/**
 * The admin Game Master panel is an emergency brake, not a control room
 * (spec §16). These tests pin that: the only controls are enable/disable,
 * intensity and the three content toggles; "Spara" is one server call with the
 * whole form; and there is no affordance anywhere to pick a participant, pick a
 * template, or manually emit a roast.
 */

const { settingsMock, updateMock } = vi.hoisted(() => ({
  settingsMock: vi.fn<() => Record<string, unknown>>(),
  updateMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('./game-master-admin-api', () => ({
  useGameMasterSettings: () => settingsMock(),
  useUpdateGameMasterSettings: () => updateMock,
}));

import { GameMasterSettingsPanel } from './GameMasterSettingsPanel';

function setSettings(data: GameMasterSettings | null) {
  settingsMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  updateMock.isPending = false;
  updateMock.isSuccess = false;
  updateMock.isError = false;
  updateMock.error = null;
});

describe('GameMasterSettingsPanel', () => {
  it('seeds all defaults when no settings row exists', () => {
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);

    expect(screen.getByRole('switch', { name: 'Aktiverat' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Privata roasts' }),
    ).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Normal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('renders the master on/off switch and toggles local state', async () => {
    const user = userEvent.setup();
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);

    const master = screen.getByRole('switch', { name: 'Aktiverat' });
    expect(master).toBeChecked();
    await user.click(master);
    expect(master).not.toBeChecked();
  });

  it('has a low/normal/high intensity control that changes', async () => {
    const user = userEvent.setup();
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);

    const group = screen.getByRole('radiogroup', { name: 'Intensitet' });
    expect(group).toBeInTheDocument();
    for (const label of ['Låg', 'Normal', 'Hög']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('radio', { name: 'Hög' }));
    expect(screen.getByRole('radio', { name: 'Hög' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('has private / public / archive content toggles', () => {
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);

    expect(
      screen.getByRole('switch', { name: 'Privata roasts' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Publika roasts' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Arkivet' })).toBeInTheDocument();
  });

  it('Spara sends the whole current form in exactly one call', async () => {
    const user = userEvent.setup();
    setSettings({
      challengeId: 'c1',
      enabled: true,
      privateRoastsEnabled: true,
      publicRoastsEnabled: true,
      archiveEnabled: true,
      intensity: 'normal',
    });
    render(<GameMasterSettingsPanel challengeId="c1" />);

    await user.click(screen.getByRole('switch', { name: 'Publika roasts' }));
    await user.click(screen.getByRole('radio', { name: 'Låg' }));
    await user.click(screen.getByRole('button', { name: 'Spara' }));

    expect(updateMock.mutate).toHaveBeenCalledTimes(1);
    expect(updateMock.mutate).toHaveBeenCalledWith({
      challengeId: 'c1',
      enabled: true,
      privateRoastsEnabled: true,
      publicRoastsEnabled: false,
      archiveEnabled: true,
      intensity: 'low',
    });
  });

  it('shows a saved confirmation after a successful save', () => {
    updateMock.isSuccess = true;
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);
    expect(screen.getByText('Sparat')).toBeInTheDocument();
  });

  it('has no participant picker, template picker or manual-emit control', () => {
    setSettings(null);
    render(<GameMasterSettingsPanel challengeId="c1" />);

    // No <select> / listbox for choosing a victim or template.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // The only real button is "Spara" — nothing that emits/triggers a roast.
    expect(
      screen.queryByRole('button', {
        name: /roasta|kör puls|testa|skapa händelse|välj/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveTextContent('Spara');
  });
});
