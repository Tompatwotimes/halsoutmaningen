import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeSwitch } from './ThemeSwitch';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeSwitch', () => {
  it('exposes an accessible radiogroup with the three options', () => {
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Utseende' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ljus/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Mörk/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /System/ })).toBeInTheDocument();
  });

  it('marks "Ljus" checked by default (no stored preference)', () => {
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radio', { name: /Ljus/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('clicking "Mörk" applies the dark theme and updates checked state', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('radio', { name: /Mörk/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: /Mörk/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Ljus/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('is keyboard-operable (focusable, activated with Enter)', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    const darkOption = screen.getByRole('radio', { name: /Mörk/ });
    darkOption.focus();
    expect(darkOption).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
