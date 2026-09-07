import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chat API adapter talks to Supabase through the same deliberately-untyped
 * boundary as game-master-api.ts. Every read and write is an RPC — ordinary
 * members have no direct SELECT on chat_messages (PR #3 finding I-1). These
 * tests assert the exact RPC call shapes (in particular that a client cannot
 * influence sender identity), that a moderated message's withheld body maps to
 * a null, and that a transport failure surfaces as ChatError.
 */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

const { uploadChatImagesMock } = vi.hoisted(() => ({
  uploadChatImagesMock: vi.fn(),
}));
vi.mock('./chat-media', () => ({
  newChatMessageId: () => 'generated-msg-id',
  uploadChatImages: uploadChatImagesMock,
  removeChatImages: vi.fn(),
}));

const {
  ChatError,
  sendChatMessage,
  markChatRead,
  mapChatRow,
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
} = await import('./chat-api');

beforeEach(() => {
  rpc.mockReset();
  uploadChatImagesMock.mockReset().mockResolvedValue([
    {
      path: 'c1/u1/generated-msg-id/1-a.webp',
      mime_type: 'image/webp',
      size_bytes: 10,
      width: 1600,
      height: 1200,
    },
  ]);
});

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    seq: 5,
    challenge_id: 'c1',
    sender_type: 'participant',
    sender_user_id: 'u1',
    sender_display_name: 'Pia',
    body: 'hej',
    status: 'active',
    attachments: [],
    created_at: '2026-09-05T12:00:00Z',
    ...overrides,
  };
}

describe('sendChatMessage (text only)', () => {
  it('calls the RPC with exactly the challenge id and body — no sender field', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({ challengeId: 'c1', userId: 'u1', body: 'hej' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('post_chat_message', {
      p_challenge_id: 'c1',
      p_body: 'hej',
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_body',
      'p_challenge_id',
    ]);
  });

  it('maps the returned row to a ChatMessage', async () => {
    rpc.mockResolvedValue({
      data: rowFixture({
        seq: 9,
        sender_user_id: 'me',
        sender_display_name: 'Jag',
        attachments: [{ position: 1, path: 'c1/u1/m/1-a.jpg' }],
      }),
      error: null,
    });
    const msg = await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'hej',
    });
    expect(msg.seq).toBe(9);
    expect(msg.senderUserId).toBe('me');
    expect(msg.attachments).toEqual([{ position: 1, path: 'c1/u1/m/1-a.jpg' }]);
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(
      sendChatMessage({ challengeId: 'c1', userId: 'u1', body: 'hej' }),
    ).rejects.toBeInstanceOf(ChatError);
  });

  it('rejects an empty message with no text and no images', async () => {
    await expect(
      sendChatMessage({ challengeId: 'c1', userId: 'u1', body: '   ' }),
    ).rejects.toBeInstanceOf(ChatError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects more than four images before any upload', async () => {
    const f = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await expect(
      sendChatMessage({
        challengeId: 'c1',
        userId: 'u1',
        body: 'x',
        files: [f(), f(), f(), f(), f()],
      }),
    ).rejects.toBeInstanceOf(ChatError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forwards the onPhase callback into uploadChatImages', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    const onPhase = vi.fn();
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: '',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
      onPhase,
    });
    expect(uploadChatImagesMock).toHaveBeenCalledWith(
      'c1',
      'u1',
      'generated-msg-id',
      expect.any(Array),
      onPhase,
    );
  });

  it('does not touch the image pipeline for a text-only message', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'bara text',
    });
    expect(uploadChatImagesMock).not.toHaveBeenCalled();
  });
});

describe('mapChatRow attachments', () => {
  it('maps a hidden row to an empty attachments array', async () => {
    rpc.mockResolvedValue({
      data: rowFixture({ status: 'hidden', body: null, attachments: [] }),
      error: null,
    });
    const msg = await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'x',
    });
    expect(msg.attachments).toEqual([]);
    expect(msg.body).toBeNull();
  });
});

describe('mapChatRow training_card', () => {
  it('maps a training_card row from list_chat_messages', () => {
    const msg = mapChatRow(
      rowFixture({
        sender_type: 'training_card',
        body: null,
        training_card: {
          entry_id: 'ent-1',
          activity: 'Simning',
          duration_minutes: 50,
          note: 'skönt',
          challenge_date: '2026-09-06',
          entry_status: 'active',
          trained_at: '2026-09-06T18:00:00Z',
          proofs: [
            { position: 2, path: 'c/u/d/2-b.jpg' },
            { position: 1, path: 'c/u/d/1-a.jpg' },
          ],
        },
      }),
    );
    expect(msg.senderType).toBe('training_card');
    expect(msg.trainingCard).toEqual({
      entryId: 'ent-1',
      activity: 'Simning',
      durationMinutes: 50,
      note: 'skönt',
      challengeDate: '2026-09-06',
      entryStatus: 'active',
      trainedAt: '2026-09-06T18:00:00Z',
      proofs: [
        { position: 1, path: 'c/u/d/1-a.jpg' },
        { position: 2, path: 'c/u/d/2-b.jpg' },
      ],
    });
  });

  it('maps a withheld (hidden) training_card to trainingCard null', () => {
    const msg = mapChatRow(
      rowFixture({
        sender_type: 'training_card',
        status: 'hidden',
        body: null,
        training_card: null,
      }),
    );
    expect(msg.senderType).toBe('training_card');
    expect(msg.trainingCard).toBeNull();
  });

  it('leaves trainingCard null for an ordinary message', () => {
    expect(mapChatRow(rowFixture()).trainingCard).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Release-compatibility: the PR #8 frontend must run against the CURRENT
// production `list_chat_messages`, which has NO `training_card` column and
// whose rows can only be sender_type 'participant' / 'game_master'. This
// models a CODE-FIRST rollout — new frontend live, old DB — so applying the
// migration is not a hard prerequisite for the deploy.
// ---------------------------------------------------------------------------
describe('backwards compatibility with the pre-PR-8 list_chat_messages shape', () => {
  /** Exactly the keys the CURRENT production RPC returns — no `training_card`. */
  function preMigrationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'old-1',
      seq: 12,
      challenge_id: 'c1',
      sender_type: 'participant',
      sender_user_id: 'u9',
      sender_display_name: 'Erik',
      body: 'hej från gamla världen',
      status: 'active',
      attachments: [],
      created_at: '2026-09-05T12:00:00Z',
      ...overrides,
    };
  }

  it('maps a pre-migration participant row with no exception and trainingCard null', () => {
    expect('training_card' in preMigrationRow()).toBe(false);
    const msg = mapChatRow(preMigrationRow());
    expect(msg.senderType).toBe('participant');
    expect(msg.body).toBe('hej från gamla världen');
    expect(msg.senderDisplayName).toBe('Erik');
    expect(msg.attachments).toEqual([]);
    expect(msg.status).toBe('active');
    expect(msg.trainingCard).toBeNull();
  });

  it('maps a pre-migration Game Master row unchanged, trainingCard null', () => {
    const msg = mapChatRow(
      preMigrationRow({
        sender_type: 'game_master',
        sender_user_id: null,
        sender_display_name: null,
        body: 'Systemet observerar.',
      }),
    );
    expect(msg.senderType).toBe('game_master');
    expect(msg.body).toBe('Systemet observerar.');
    expect(msg.trainingCard).toBeNull();
  });

  it('maps a pre-migration hidden row (withheld body) to the placeholder path', () => {
    const msg = mapChatRow(preMigrationRow({ status: 'hidden', body: null }));
    expect(msg.status).toBe('hidden');
    expect(msg.body).toBeNull();
    expect(msg.trainingCard).toBeNull();
  });

  it('fetchRecentChatMessages maps a whole pre-migration page without throwing', async () => {
    rpc.mockResolvedValue({
      data: [
        preMigrationRow({ id: 'a', seq: 3 }),
        preMigrationRow({
          id: 'b',
          seq: 2,
          sender_type: 'game_master',
          sender_user_id: null,
        }),
        preMigrationRow({ id: 'c', seq: 1, status: 'hidden', body: null }),
      ],
      error: null,
    });
    const page = await fetchRecentChatMessages('c1', 50);
    expect(page).toHaveLength(3);
    expect(page.every((m) => m.trainingCard === null)).toBe(true);
    expect(page.map((m) => m.senderType)).toEqual([
      'participant',
      'game_master',
      'participant',
    ]);
  });
});

describe('markChatRead', () => {
  it('calls the RPC with exactly the challenge id and seq', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await markChatRead('c1', 42);
    expect(rpc).toHaveBeenCalledWith('mark_chat_read', {
      p_challenge_id: 'c1',
      p_seq: 42,
    });
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(markChatRead('c1', 1)).rejects.toBeInstanceOf(ChatError);
  });
});

describe('fetchRecentChatMessages', () => {
  it('calls list_chat_messages with a null cursor and the page size', async () => {
    rpc.mockResolvedValue({ data: [rowFixture()], error: null });
    await fetchRecentChatMessages('c1', 50);
    expect(rpc).toHaveBeenCalledWith('list_chat_messages', {
      p_challenge_id: 'c1',
      p_before_seq: null,
      p_limit: 50,
    });
  });

  it('maps a withheld (hidden, non-admin) body to null', async () => {
    rpc.mockResolvedValue({
      data: [rowFixture({ status: 'hidden', body: null })],
      error: null,
    });
    const [msg] = await fetchRecentChatMessages('c1', 50);
    expect(msg!.status).toBe('hidden');
    expect(msg!.body).toBeNull();
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchRecentChatMessages('c1', 50)).rejects.toBeInstanceOf(
      ChatError,
    );
  });
});

describe('fetchOlderChatMessages', () => {
  it('passes beforeSeq as the strict upper-bound cursor', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchOlderChatMessages('c1', 100, 20);
    expect(rpc).toHaveBeenCalledWith('list_chat_messages', {
      p_challenge_id: 'c1',
      p_before_seq: 100,
      p_limit: 20,
    });
  });
});

describe('fetchUnreadCount', () => {
  it('calls unread_chat_count with just the challenge id and returns the scalar', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const count = await fetchUnreadCount('c1');
    expect(count).toBe(3);
    expect(rpc).toHaveBeenCalledWith('unread_chat_count', {
      p_challenge_id: 'c1',
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object)).toEqual(['p_challenge_id']);
  });

  it('treats a null/absent count as 0', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchUnreadCount('c1')).toBe(0);
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchUnreadCount('c1')).rejects.toBeInstanceOf(ChatError);
  });
});
