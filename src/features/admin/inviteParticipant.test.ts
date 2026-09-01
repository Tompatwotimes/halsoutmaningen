import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({
  getSession:
    vi.fn<
      () => Promise<{ data: { session: { access_token: string } | null } }>
    >(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

import { inviteParticipant } from './inviteParticipant';
import type { InviteParticipantInput } from './invite-schema';

const input: InviteParticipantInput = {
  email: 'ny@example.com',
  displayName: 'Ny Deltagare',
  challengeId: '11111111-1111-4111-8111-111111111111',
  participationStartDate: '2026-08-01',
  participationEndDate: null,
};

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('inviteParticipant', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-123' } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends the caller bearer token and invite action to the Edge Function', async () => {
    const fetchMock = mockFetch(200, {
      status: 'invited',
      userId: 'u1',
      existingUser: false,
      displayName: 'Ny Deltagare',
      message: 'Inbjudan skickad.',
    });

    const result = await inviteParticipant(input);

    expect(result.status).toBe('invited');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/invite-participant'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token-123',
        }),
      }),
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toMatchObject({
      action: 'invite',
      email: 'ny@example.com',
      challengeId: input.challengeId,
    });
  });

  it('refuses to call the function without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = mockFetch(200, {});

    await expect(inviteParticipant(input)).rejects.toThrow(/inloggad/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the server error message on a 4xx/5xx response', async () => {
    mockFetch(403, {
      error: 'Endast administratörer får utföra denna åtgärd.',
    });
    await expect(inviteParticipant(input)).rejects.toThrow(
      'Endast administratörer får utföra denna åtgärd.',
    );
  });

  it('falls back to a generic message when the error body has no text', async () => {
    mockFetch(500, {});
    await expect(inviteParticipant(input)).rejects.toThrow(/misslyckades/i);
  });

  it('returns the parsed result body for the already-member case', async () => {
    mockFetch(200, {
      status: 'already_member',
      userId: 'u9',
      existingUser: true,
      displayName: 'Ny Deltagare',
      message: 'Personen är redan deltagare i utmaningen.',
    });
    const result = await inviteParticipant(input);
    expect(result).toMatchObject({
      status: 'already_member',
      existingUser: true,
    });
  });
});
