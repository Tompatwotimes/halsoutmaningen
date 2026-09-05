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

const {
  ChatError,
  postChatMessage,
  markChatRead,
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
} = await import('./chat-api');

beforeEach(() => {
  rpc.mockReset();
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
    created_at: '2026-09-05T12:00:00Z',
    ...overrides,
  };
}

describe('postChatMessage', () => {
  it('calls the RPC with exactly the challenge id and body — no sender field', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await postChatMessage('c1', 'hej');
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
      }),
      error: null,
    });
    const msg = await postChatMessage('c1', 'hej');
    expect(msg.seq).toBe(9);
    expect(msg.senderUserId).toBe('me');
    expect(msg.senderDisplayName).toBe('Jag');
    expect(msg.senderType).toBe('participant');
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(postChatMessage('c1', 'hej')).rejects.toBeInstanceOf(
      ChatError,
    );
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
