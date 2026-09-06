import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The weight API adapter talks to Supabase through the same deliberately
 * untyped boundary as game-master-api.ts / chat-api.ts. These tests pin the
 * exact RPC call shapes — in particular that log_weight_entry never sends
 * anything date-shaped (backdating is impossible even to attempt through this
 * adapter) — and that a lock-window rejection surfaces the server's Swedish
 * message via WeightError.
 */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();

function makeChain(result: RpcResult) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  (chain as { then: unknown }).then = (
    onFulfilled: (v: RpcResult) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  (chain as { maybeSingle: unknown }).maybeSingle = () => {
    calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(result);
  };
  (chain as { __calls: unknown }).__calls = calls;
  return chain;
}

let fromResults: RpcResult[] = [];
const fromChains: Record<string, unknown>[] = [];
const from = vi.fn((table: string) => {
  const chain = makeChain(fromResults.shift() ?? { data: [], error: null });
  (chain as { __table: string }).__table = table;
  fromChains.push(chain);
  return chain;
});

vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));

const {
  WeightError,
  setStartWeight,
  logWeightEntry,
  setWeightHidden,
  fetchMyWeightProfile,
  fetchMyWeightEntries,
  fetchWeightPublicRanking,
  fetchWeightFinalResult,
} = await import('./weight-api');

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  fromResults = [];
  fromChains.length = 0;
});

describe('write RPCs — exact parameter shape', () => {
  it('setStartWeight sends only the challenge id and weight', async () => {
    rpc.mockResolvedValue({
      data: {
        challenge_id: 'c1',
        user_id: 'u1',
        start_weight_kg: 80,
        start_weight_first_saved_at: '2026-09-06T10:00:00Z',
        start_weight_locked_at: '2026-09-07T10:00:00Z',
        is_weight_hidden: false,
        official_final_weight_kg: null,
        official_final_recorded_at: null,
      },
      error: null,
    });
    await setStartWeight('c1', 80);
    expect(rpc).toHaveBeenCalledWith('set_start_weight', {
      p_challenge_id: 'c1',
      p_weight_kg: 80,
    });
    expect(Object.keys(rpc.mock.calls[0]![1] as object).sort()).toEqual([
      'p_challenge_id',
      'p_weight_kg',
    ]);
  });

  it('logWeightEntry sends only the challenge id and weight — never a date', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'e1',
        challenge_id: 'c1',
        user_id: 'u1',
        entry_date: '2026-09-06',
        weight_kg: 79,
      },
      error: null,
    });
    await logWeightEntry('c1', 79);
    expect(rpc).toHaveBeenCalledWith('log_weight_entry', {
      p_challenge_id: 'c1',
      p_weight_kg: 79,
    });
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(['p_challenge_id', 'p_weight_kg']);
    // no key that could carry a backdated date
    for (const k of Object.keys(args)) {
      expect(k.toLowerCase()).not.toContain('date');
      expect(k.toLowerCase()).not.toContain('day');
    }
  });

  it('setWeightHidden sends only the challenge id and the boolean', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setWeightHidden('c1', true);
    expect(rpc).toHaveBeenCalledWith('set_weight_hidden', {
      p_challenge_id: 'c1',
      p_hidden: true,
    });
  });
});

describe('error handling', () => {
  it('passes the server lock-window message through a WeightError', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'Din startvikt är låst — be en administratör rätta den om det behövs.',
      },
    });
    await expect(setStartWeight('c1', 70)).rejects.toMatchObject({
      name: 'WeightError',
      message:
        'Din startvikt är låst — be en administratör rätta den om det behövs.',
    });
  });

  it('rejects with WeightError on a transport failure from a fetch', async () => {
    fromResults = [{ data: null, error: { message: 'network' } }];
    await expect(fetchMyWeightProfile('c1', 'u1')).rejects.toBeInstanceOf(
      WeightError,
    );
  });

  it('rejects with WeightError on a transport failure from an RPC read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchWeightPublicRanking('c1')).rejects.toBeInstanceOf(
      WeightError,
    );
  });
});

describe('reads', () => {
  it('fetchMyWeightProfile reads its own weight_profiles row and returns null when absent', async () => {
    fromResults = [{ data: null, error: null }];
    const result = await fetchMyWeightProfile('c1', 'u1');
    expect(result).toBeNull();
    expect((fromChains[0] as { __table: string }).__table).toBe(
      'weight_profiles',
    );
  });

  it('fetchMyWeightEntries maps rows newest first', async () => {
    fromResults = [
      {
        data: [
          {
            id: 'e2',
            challenge_id: 'c1',
            user_id: 'u1',
            entry_date: '2026-09-06',
            weight_kg: 79,
          },
        ],
        error: null,
      },
    ];
    const rows = await fetchMyWeightEntries('c1', 'u1');
    expect(rows).toEqual([
      {
        id: 'e2',
        challengeId: 'c1',
        userId: 'u1',
        entryDate: '2026-09-06',
        weightKg: 79,
      },
    ]);
  });

  it('fetchWeightPublicRanking calls the RPC (not a table select) and maps every field', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: 'u2',
          display_name: 'Anna',
          start_weight_kg: 82,
          latest_weight_kg: 78.7,
          latest_entry_date: '2026-09-05',
          kg_change: -3.3,
          percentage_change: -4.02,
        },
      ],
      error: null,
    });
    const rows = await fetchWeightPublicRanking('c1');
    expect(rpc).toHaveBeenCalledWith('weight_public_ranking', {
      p_challenge_id: 'c1',
    });
    expect(from).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        userId: 'u2',
        displayName: 'Anna',
        startWeightKg: 82,
        latestWeightKg: 78.7,
        latestEntryDate: '2026-09-05',
        kgChange: -3.3,
        percentageChange: -4.02,
      },
    ]);
  });

  it('fetchWeightFinalResult maps the gated result, defaulting to an undisclosed empty result', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchWeightFinalResult('c1')).toEqual({
      winnerUserId: null,
      winnerDisplayName: null,
      winnerPercentageChange: null,
      disclosed: false,
    });

    rpc.mockResolvedValue({
      data: [
        {
          winner_user_id: 'u3',
          winner_display_name: 'Rex',
          winner_percentage_change: -8,
          disclosed: true,
        },
      ],
      error: null,
    });
    expect(await fetchWeightFinalResult('c1')).toEqual({
      winnerUserId: 'u3',
      winnerDisplayName: 'Rex',
      winnerPercentageChange: -8,
      disclosed: true,
    });
  });
});
