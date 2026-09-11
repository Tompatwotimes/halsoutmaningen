import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './useTheme';
import { THEME_STORAGE_KEY } from './theme';

/** A controllable `matchMedia` mock that supports the `change` listener the
 * provider attaches only while preference === "system". */
function installMatchMediaMock(initialPrefersDark: boolean) {
  let matches = initialPrefersDark;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, cb: () => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_event: string, cb: () => void) => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    setPrefersDark(next: boolean) {
      matches = next;
      for (const cb of listeners) cb();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function Consumer() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference('light')}>light</button>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('system')}>system</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('changing selection updates document.documentElement data-theme', async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByText('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    await user.click(screen.getByText('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('persists the selection to localStorage', async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByText('dark'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('the system listener only affects the theme while preference is "system"', async () => {
    const mm = installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    // Start on an explicit "dark" — an OS flip must not move it.
    await user.click(screen.getByText('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => mm.setPrefersDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');

    // Switch to "system" — now the OS should drive it live.
    await user.click(screen.getByText('system'));
    expect(document.documentElement.dataset.theme).toBe('dark'); // OS is dark

    act(() => mm.setPrefersDark(false));
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => mm.setPrefersDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('switching away from "system" stops the OS from altering the theme', async () => {
    const mm = installMatchMediaMock(true);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByText('system'));
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByText('light'));
    expect(document.documentElement.dataset.theme).toBe('light');

    // The OS "changing" now must not move the (explicit) resolved theme.
    act(() => mm.setPrefersDark(false));
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => mm.setPrefersDark(true));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('cleans up the media-query listener on unmount', () => {
    const mm = installMatchMediaMock(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const { unmount } = render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    expect(mm.listenerCount).toBe(1);
    unmount();
    expect(mm.listenerCount).toBe(0);
  });
});
