import { useEffect, useState, type ReactNode } from 'react';
import {
  applyResolvedTheme,
  applyThemeColorMeta,
  getSystemPrefersDark,
  readStoredPreference,
  resolveTheme,
  storePreference,
  type ThemePreference,
} from './theme';
import { ThemeContext } from './theme-context';

/**
 * Mounted once, high in the tree (see `Providers.tsx`) — has no dependency on
 * routing/auth/data, only on the DOM and `localStorage`.
 *
 * The initial `resolved` value is computed the same way, and normally lands
 * on the same result, as the inline `#theme-init` script in `index.html`
 * already applied before React ever mounted — this provider's first apply is
 * therefore a no-op paint-wise in the common case; it only visibly changes
 * anything if something raced between that script and now (never observed,
 * cheap to be correct about regardless).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState(() =>
    resolveTheme(preference, getSystemPrefersDark()),
  );

  useEffect(() => {
    applyResolvedTheme(resolved);
    applyThemeColorMeta(resolved);
  }, [resolved]);

  // Live-updates ONLY while the preference is explicitly "system" — an
  // explicit light/dark choice must never be overridden by an OS change.
  // Switching away from "system" tears this listener down (the effect
  // cleanup, re-run whenever `preference` changes), so a later OS flip can
  // no longer reach `resolved`.
  useEffect(() => {
    if (preference !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setResolved(resolveTheme('system', mql.matches));
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [preference]);

  const setPreference = (next: ThemePreference): void => {
    setPreferenceState(next);
    storePreference(next);
    setResolved(resolveTheme(next, getSystemPrefersDark()));
  };

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}
