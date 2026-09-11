import { createContext } from 'react';
import type { ThemePreference, ResolvedTheme } from './theme';

export interface ThemeContextValue {
  /** What the user chose (or the default) — "light" | "dark" | "system". */
  preference: ThemePreference;
  /** What actually renders — "system" already resolved to one of these. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);
