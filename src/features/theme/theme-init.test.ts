import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Exercises the ACTUAL bytes of the `#theme-init` inline script in
 * `index.html` — the one that runs before React (and before this module)
 * ever loads, to avoid a light↔dark flash on startup. Not a reimplementation:
 * a divergence between this script and `theme.ts` is exactly the bug this
 * file exists to catch.
 */

function loadInlineThemeScript(): string {
  const indexHtmlPath = path.join(process.cwd(), 'index.html');
  const html = readFileSync(indexHtmlPath, 'utf8');
  const match = /<script id="theme-init">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) {
    throw new Error('#theme-init script not found in index.html');
  }
  return match[1];
}

const SCRIPT = loadInlineThemeScript();

interface RunOptions {
  stored?: string | null;
  storageThrows?: boolean;
  prefersDark?: boolean;
  hasMatchMedia?: boolean;
}

function run({
  stored = null,
  storageThrows = false,
  prefersDark = false,
  hasMatchMedia = true,
}: RunOptions): { theme: string | undefined; themeColor: string | null } {
  const dataset: Record<string, string> = {};
  const documentElement = { dataset };
  const meta = { content: '#initial' as string | null };
  const fakeDocument = {
    documentElement,
    querySelector: (sel: string) =>
      sel === 'meta[name="theme-color"]'
        ? {
            setAttribute: (_name: string, value: string) => {
              meta.content = value;
            },
          }
        : null,
  };
  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error('blocked');
      return stored;
    },
  };
  const windowObj = hasMatchMedia
    ? {
        matchMedia: (q: string) => ({
          matches: q.includes('dark') && prefersDark,
        }),
      }
    : {};

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- exercising the real shipped script, not writing new dynamic code
  const fn = new Function('document', 'localStorage', 'window', SCRIPT);
  fn(fakeDocument, localStorage, windowObj);

  return { theme: dataset.theme, themeColor: meta.content };
}

describe('#theme-init inline script (index.html)', () => {
  it('no stored preference → light', () => {
    expect(run({ stored: null }).theme).toBe('light');
  });

  it('stored "light" → light', () => {
    expect(run({ stored: 'light' }).theme).toBe('light');
  });

  it('stored "dark" → dark', () => {
    expect(run({ stored: 'dark' }).theme).toBe('dark');
  });

  it('stored "system" + OS light → light', () => {
    expect(run({ stored: 'system', prefersDark: false }).theme).toBe('light');
  });

  it('stored "system" + OS dark → dark', () => {
    expect(run({ stored: 'system', prefersDark: true }).theme).toBe('dark');
  });

  it('invalid stored value → safe fallback to light', () => {
    expect(run({ stored: 'blue' }).theme).toBe('light');
    expect(run({ stored: '' }).theme).toBe('light');
  });

  it('a throwing localStorage → safe fallback to light', () => {
    expect(run({ storageThrows: true }).theme).toBe('light');
  });

  it('missing matchMedia with "system" stored → safe fallback to light', () => {
    expect(run({ stored: 'system', hasMatchMedia: false }).theme).toBe('light');
  });

  it('also updates the theme-color meta tag to match', () => {
    expect(run({ stored: 'dark' }).themeColor).toBe('#14181a');
    expect(run({ stored: 'light' }).themeColor).toBe('#faf7f2');
  });
});
