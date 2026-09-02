/**
 * Parsing for the Supabase invite / password-reset redirect URL.
 *
 * Supabase can hand the browser back one of three shapes on `/aktivera`:
 *
 *  1. an **implicit-grant hash** —
 *     `#access_token=…&refresh_token=…&expires_in=…&type=invite`.
 *     This is what the admin `inviteUserByEmail` link produces: it is routed
 *     through `/auth/v1/verify`, which has no PKCE code verifier and therefore
 *     always redirects implicit-style. The `flowType: 'pkce'` client rejects
 *     this URL ("Not a valid PKCE flow url") and never establishes the session,
 *     so it has to be consumed explicitly — see `useActivation`.
 *
 *  2. a **PKCE query** — `?code=…`. Produced by the client-initiated
 *     `supabase.auth.resetPasswordForEmail(...)`. `supabase-js` exchanges this
 *     on its own via `detectSessionInUrl`; we only wait for the session.
 *
 *  3. an **error** — `?error=…&error_code=…` or `#error=…` when the link is
 *     expired or already used.
 */
export interface ActivationLink {
  accessToken: string | null;
  refreshToken: string | null;
  /** `invite`, `recovery`, `signup`, … when Supabase includes it. */
  type: string | null;
  /** `?code=…` present — a PKCE callback handled by supabase-js itself. */
  hasPkceCode: boolean;
  hasError: boolean;
  errorCode: string | null;
  errorDescription: string | null;
}

export function parseActivationLink(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  hash: string = typeof window === 'undefined' ? '' : window.location.hash,
): ActivationLink {
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const pick = (key: string) => fragment.get(key) ?? query.get(key);

  const errorCode = pick('error_code') ?? pick('error');
  const errorDescription = pick('error_description');

  return {
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    type: pick('type'),
    hasPkceCode: query.get('code') !== null,
    hasError: Boolean(errorCode) || Boolean(errorDescription),
    errorCode,
    errorDescription,
  };
}

/** Swedish copy for an error handed back on the redirect URL. */
export function activationLinkErrorMessage(link: ActivationLink): string {
  if (
    link.errorCode === 'otp_expired' ||
    /expired/i.test(link.errorDescription ?? '')
  ) {
    return 'Länken har gått ut. Be en administratör skicka en ny inbjudan eller en ny återställningslänk.';
  }
  return 'Länken är ogiltig eller har redan använts. Be en administratör skicka en ny.';
}

const AUTH_URL_PARAMS = [
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'provider_token',
  'provider_refresh_token',
  'type',
  'code',
  'error',
  'error_code',
  'error_description',
] as const;

/**
 * Drops the auth tokens / error markers from the address bar once consumed, so
 * a reload of `/aktivera` does not replay a spent link and the tokens do not
 * linger in history. Mirrors what `supabase-js` does on its own success path.
 */
export function stripActivationParamsFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = '';
  for (const key of AUTH_URL_PARAMS) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}`,
  );
}
