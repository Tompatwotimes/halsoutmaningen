import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyResolvedTheme,
  applyThemeColorMeta,
  getSystemPrefersDark,
  readStoredPreference,
  resolveTheme,
  storePreference,
  THEME_STORAGE_KEY,
} from './theme';

function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(THEME_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    _data: data,
  };
}

describe('readStoredPreference', () => {
  it('defaults to light when nothing is stored', () => {
    expect(readStoredPreference(fakeStorage())).toBe('light');
  });

  it('returns a stored "light"', () => {
    expect(readStoredPreference(fakeStorage('light'))).toBe('light');
  });

  it('returns a stored "dark"', () => {
    expect(readStoredPreference(fakeStorage('dark'))).toBe('dark');
  });

  it('returns a stored "system"', () => {
    expect(readStoredPreference(fakeStorage('system'))).toBe('system');
  });

  it('falls back to light for an invalid/unknown stored value', () => {
    expect(readStoredPreference(fakeStorage('blue'))).toBe('light');
    expect(readStoredPreference(fakeStorage(''))).toBe('light');
  });

  it('falls back to light when the store throws (private mode etc.)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredPreference(throwing)).toBe('light');
  });
});

describe('storePreference', () => {
  it('writes the exact preference string', () => {
    const storage = fakeStorage();
    storePreference('dark', storage);
    expect(storage._data.get(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('does not throw when the store is unavailable', () => {
    const throwing = {
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => storePreference('light', throwing)).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('"light" stays light regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('"dark" stays dark regardless of the OS', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('"system" + OS light → light', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('"system" + OS dark → dark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });
});

describe('getSystemPrefersDark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reflects a dark OS preference', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('dark'),
    }));
    expect(getSystemPrefersDark()).toBe(true);
  });

  it('reflects a light OS preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('is false (light) when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(getSystemPrefersDark()).toBe(false);
  });
});

describe('applyResolvedTheme', () => {
  it('sets data-theme on the given root', () => {
    const root = document.createElement('html');
    applyResolvedTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyResolvedTheme('light', root);
    expect(root.dataset.theme).toBe('light');
  });
});

describe('applyThemeColorMeta', () => {
  it('updates an existing theme-color meta tag per resolved theme', () => {
    const doc = document.implementation.createHTMLDocument();
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#000000');
    doc.head.appendChild(meta);

    applyThemeColorMeta('dark', doc);
    expect(meta.getAttribute('content')).toBe('#14181a');

    applyThemeColorMeta('light', doc);
    expect(meta.getAttribute('content')).toBe('#faf7f2');
  });

  it('is a no-op when there is no theme-color meta tag', () => {
    const doc = document.implementation.createHTMLDocument();
    expect(() => applyThemeColorMeta('dark', doc)).not.toThrow();
  });
});
