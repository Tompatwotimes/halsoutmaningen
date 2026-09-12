import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIos, isStandalone } from './install';

function stubUserAgent(ua: string) {
  vi.stubGlobal('navigator', { userAgent: ua });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isIos', () => {
  it('detects an iPhone user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    );
    expect(isIos()).toBe(true);
  });

  it('detects an iPad user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    );
    expect(isIos()).toBe(true);
  });

  it('is false for a normal desktop Chrome user agent', () => {
    stubUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
    );
    expect(isIos()).toBe(false);
  });

  it('is false for Android Chrome', () => {
    stubUserAgent(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile',
    );
    expect(isIos()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('is true when matchMedia reports display-mode: standalone', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('standalone'),
    }));
    expect(isStandalone()).toBe(true);
  });

  it('is false when matchMedia reports no standalone display mode', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isStandalone()).toBe(false);
  });
});
