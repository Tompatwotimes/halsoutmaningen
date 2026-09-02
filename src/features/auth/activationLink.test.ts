import { describe, expect, it } from 'vitest';
import {
  activationLinkErrorMessage,
  parseActivationLink,
} from './activationLink';

describe('parseActivationLink', () => {
  it('reads the implicit-grant tokens from the hash (admin invite)', () => {
    const link = parseActivationLink(
      '',
      '#access_token=aaa&refresh_token=bbb&expires_in=3600&token_type=bearer&type=invite',
    );
    expect(link.accessToken).toBe('aaa');
    expect(link.refreshToken).toBe('bbb');
    expect(link.type).toBe('invite');
    expect(link.hasError).toBe(false);
    expect(link.hasPkceCode).toBe(false);
  });

  it('flags a PKCE code query (password reset) without treating it as tokens', () => {
    const link = parseActivationLink('?code=abc123', '');
    expect(link.hasPkceCode).toBe(true);
    expect(link.accessToken).toBeNull();
    expect(link.refreshToken).toBeNull();
    expect(link.hasError).toBe(false);
  });

  it('detects an error carried on the hash', () => {
    const link = parseActivationLink(
      '',
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(link.hasError).toBe(true);
    expect(link.errorCode).toBe('otp_expired');
  });

  it('detects an error carried on the query string', () => {
    const link = parseActivationLink(
      '?error=server_error&error_description=unexpected',
      '',
    );
    expect(link.hasError).toBe(true);
    expect(link.errorDescription).toBe('unexpected');
  });
});

describe('activationLinkErrorMessage', () => {
  it('uses expiry copy for an expired one-time link', () => {
    const message = activationLinkErrorMessage(
      parseActivationLink('', '#error_code=otp_expired'),
    );
    expect(message).toMatch(/gått ut/);
  });

  it('uses expiry copy when only the description mentions expiry', () => {
    const message = activationLinkErrorMessage(
      parseActivationLink('?error_description=Token has expired', ''),
    );
    expect(message).toMatch(/gått ut/);
  });

  it('falls back to a generic invalid-link message', () => {
    const message = activationLinkErrorMessage(
      parseActivationLink('?error=access_denied', ''),
    );
    expect(message).toMatch(/ogiltig eller har redan använts/);
  });
});
