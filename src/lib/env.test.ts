import { describe, expect, it } from 'vitest';
import { env, siteUrl } from './env';

// The test env (vite.config.ts → test.env) sets only VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY, so VITE_PUBLIC_SITE_URL is unset here and siteUrl()
// exercises the browser-origin fallback path.
describe('siteUrl', () => {
  it('falls back to the current browser origin when VITE_PUBLIC_SITE_URL is unset', () => {
    expect(env.publicSiteUrl).toBeNull();
    expect(siteUrl()).toBe(window.location.origin);
  });

  it('never returns a trailing slash', () => {
    expect(siteUrl().endsWith('/')).toBe(false);
  });
});
