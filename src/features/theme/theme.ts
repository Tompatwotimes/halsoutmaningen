/**
 * Appearance (theme) resolution — the canonical implementation.
 *
 * The same algorithm also lives, deliberately duplicated in plain JS, as the
 * inline `#theme-init` script in `index.html`: an inline script cannot import
 * a module and still run synchronously before first paint, which is the
 * entire point of that copy (no light→dark flash on load). Kept in sync by
 * `theme-init.test.ts`, which exercises those exact inline-script bytes
 * against the same scenarios as `theme.test.ts` below.
 *
 * Two concepts, never conflated:
 * - `ThemePreference` — what the user chose (or the default): "light",
 *   "dark", or "system". This is what gets persisted.
 * - `ResolvedTheme` — what actually renders: "light" or "dark". "system"
 *   resolves to one of these via the OS media query; it is never itself a
 *   resolved value or a token-selector value.
 */

export const THEME_STORAGE_KEY = 'halsoutmaningen-theme';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const VALID_PREFERENCES: readonly ThemePreference[] = [
  'light',
  'dark',
  'system',
];

function isThemePreference(value: string): value is ThemePreference {
  return (VALID_PREFERENCES as readonly string[]).includes(value);
}

/** `localStorage`, tolerant of it being unavailable (private mode, disabled
 * storage) — reads/writes then silently no-op instead of throwing. */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    // Accessing the property itself can throw in some locked-down browsers.
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/**
 * The user's stored preference, or "light" if there is none — including for
 * a missing key, an inaccessible store, or any value that isn't exactly
 * "light" | "dark" | "system" (e.g. a stale value from a future version of
 * this key). Never "system" as an implicit default: that is a deliberate
 * product decision (Hälsoutmaningen's primary identity is light), not an
 * OS-preference passthrough.
 */
export function readStoredPreference(
  storage: Pick<Storage, 'getItem'> = safeStorage(),
): ThemePreference {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    if (raw !== null && isThemePreference(raw)) return raw;
  } catch {
    // fall through to the default
  }
  return 'light';
}

/** Best-effort persistence — a failed write just means the choice won't
 * survive a reload, never a thrown error the caller has to handle. */
export function storePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> = safeStorage(),
): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // best-effort
  }
}

/** "system" resolves via the OS preference; "light"/"dark" pass through
 * unchanged regardless of what the OS prefers. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** `false` (light) when `matchMedia` is unavailable, rather than throwing. */
export function getSystemPrefersDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The one place `data-theme` is written — every consumer (CSS, this
 * module, the inline startup script) agrees on this exact attribute/values. */
export function applyResolvedTheme(
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = resolved;
}

const THEME_COLOR_BY_RESOLVED: Record<ResolvedTheme, string> = {
  light: '#faf7f2',
  dark: '#14181a',
};

/** Keeps the PWA/mobile-browser-chrome tint in sync with the active theme.
 * A missing meta tag (e.g. a test document) is a silent no-op. */
export function applyThemeColorMeta(
  resolved: ResolvedTheme,
  doc: Document = document,
): void {
  const meta = doc.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR_BY_RESOLVED[resolved]);
}
