import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chat API adapter talks to Supabase through the same deliberately-untyped
 * boundary as game-master-api.ts. These tests assert the exact call shapes —
 * in particular that a client cannot influence sender identity — and that a
 * transport failure surfaces as `ChatError`.
 */

interface QueryResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<QueryResult>>();

// A chainable stub for `.from(table).select(...).eq(...).order(...).limit(...)`.
function makeChain(result: QueryResult) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lt', 'gt', 'order', 'limit', 'or']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  // Awaiting the builder resolves to the result.
  (chain as { then: unknown }).then = (
    onFulfilled: (v: QueryResult) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  (chain as { __calls: unknown }).__calls = calls;
  (chain as { maybeSingle: unknown }).maybeSingle = () => {
    calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(result);
  };
  return chain;
}

let fromResults: QueryResult[] = [];
const fromChains: Record<string, unknown>[] = [];
const from = vi.fn((table: string) => {
  const chain = makeChain(fromResults.shift() ?? { data: [], error: null });
  (chain as { __table: string }).__table = table;
  fromChains.push(chain);
  return chain;
});

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc, from },
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
  from.mockClear();
  fromResults = [];
  fromChains.length = 0;
});

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    seq: 5,
    challenge_id: 'c1',
    sender_type: 'participant',
    sender_user_id: 'u1',
    body: 'hej',
    status: 'active',
    hidden_reason: null,
    game_master_event_id: null,
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
      data: rowFixture({ seq: 9, sender_user_id: 'me' }),
      error: null,
    });
    const msg = await postChatMessage('c1', 'hej');
    expect(msg.seq).toBe(9);
    expect(msg.senderUserId).toBe('me');
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
  it('orders by seq descending, limits, and never touches created_at', async () => {
    fromResults = [{ data: [rowFixture()], error: null }];
    await fetchRecentChatMessages('c1', 50);
    const chain = fromChains[0]!;
    expect((chain as { __table: string }).__table).toBe('chat_messages');
    const calls = (chain as { __calls: { method: string; args: unknown[] }[] })
      .__calls;
    const order = calls.find((c) => c.method === 'order');
    expect(order?.args).toEqual(['seq', { ascending: false }]);
    expect(calls.some((c) => c.method === 'limit' && c.args[0] === 50)).toBe(
      true,
    );
    expect(
      calls.some(
        (c) => c.method === 'order' && (c.args[0] as string) === 'created_at',
      ),
    ).toBe(false);
    expect(
      calls.some((c) => c.method === 'eq' && c.args[0] === 'challenge_id'),
    ).toBe(true);
  });
});

describe('fetchOlderChatMessages', () => {
  it('filters seq < beforeSeq and orders seq descending', async () => {
    fromResults = [{ data: [], error: null }];
    await fetchOlderChatMessages('c1', 100, 20);
    const calls = (
      fromChains[0] as { __calls: { method: string; args: unknown[] }[] }
    ).__calls;
    expect(
      calls.some(
        (c) => c.method === 'lt' && c.args[0] === 'seq' && c.args[1] === 100,
      ),
    ).toBe(true);
    const order = calls.find((c) => c.method === 'order');
    expect(order?.args).toEqual(['seq', { ascending: false }]);
  });
});

describe('fetchUnreadCount', () => {
  it('reads last_read_seq then counts messages with a greater seq', async () => {
    fromResults = [
      { data: { last_read_seq: 7 }, error: null }, // chat_read_state
      { data: null, error: null, count: 3 }, // chat_messages count
    ];
    const count = await fetchUnreadCount('c1', 'u1');
    expect(count).toBe(3);
    expect((fromChains[0] as { __table: string }).__table).toBe(
      'chat_read_state',
    );
    expect((fromChains[1] as { __table: string }).__table).toBe(
      'chat_messages',
    );
    const countCalls = (
      fromChains[1] as { __calls: { method: string; args: unknown[] }[] }
    ).__calls;
    expect(
      countCalls.some(
        (c) => c.method === 'gt' && c.args[0] === 'seq' && c.args[1] === 7,
      ),
    ).toBe(true);
  });

  it('treats a missing read-state row as last_read_seq 0', async () => {
    fromResults = [
      { data: null, error: null }, // no chat_read_state row
      { data: null, error: null, count: 12 },
    ];
    const count = await fetchUnreadCount('c1', 'u1');
    expect(count).toBe(12);
    const countCalls = (
      fromChains[1] as { __calls: { method: string; args: unknown[] }[] }
    ).__calls;
    expect(
      countCalls.some(
        (c) => c.method === 'gt' && c.args[0] === 'seq' && c.args[1] === 0,
      ),
    ).toBe(true);
  });
});
