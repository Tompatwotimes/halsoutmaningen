import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/domain/dates';
import { DayState } from '@/domain/dayState';
import { PenaltyType } from '@/domain/penalties';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

const { fetchDayStates } = await import('./challenge-api');

interface RpcRow {
  user_id: string;
  challenge_date: string;
  state: string;
  session_count: number;
  valid_session_count: number;
  total_valid_minutes: number;
  required_minutes: number;
  required_sessions: number;
  min_minutes_per_session: number;
  penalty_type: string | null;
  penalty_display_name: string | null;
  penalty_from_user_id: string | null;
}

/**
 * Stand-in for a `supabase.rpc(..., { count: 'exact' }).order().order()
 * .range(from, to)` chain. `range` slices the pre-ordered dataset exactly the
 * way PostgREST's `Range` header does and reports the full-set `count`, so
 * pagination logic is exercised for real. `cap` simulates a server row limit
 * below the requested window.
 */
function rpcChain(all: RpcRow[], cap = Infinity) {
  const orderCalls: string[] = [];
  const rangeCalls: [number, number][] = [];
  const builder = {
    orderCalls,
    rangeCalls,
    order(column: string) {
      orderCalls.push(column);
      return builder;
    },
    range(from: number, to: number) {
      rangeCalls.push([from, to]);
      const end = Math.min(to + 1, from + cap);
      return Promise.resolve({
        data: all.slice(from, end),
        error: null,
        count: all.length,
      });
    },
  };
  return builder;
}

function makeRow(
  over: Partial<RpcRow> & Pick<RpcRow, 'user_id' | 'challenge_date'>,
): RpcRow {
  return {
    state: 'pending',
    session_count: 0,
    valid_session_count: 0,
    total_valid_minutes: 0,
    required_minutes: 30,
    required_sessions: 1,
    min_minutes_per_session: 0,
    penalty_type: null,
    penalty_display_name: null,
    penalty_from_user_id: null,
    ...over,
  };
}

const START = '2026-08-01';
const DAYS = 120; // 2026-08-01 .. 2026-11-28
const PARTICIPANTS = 21; // 21 × 120 = 2520 rows — well over PostgREST's ~1000 cap

const dates = Array.from({ length: DAYS }, (_, i) => addDays(START, i));
// Zero-padded so a plain string sort matches, mirroring a stable RPC ORDER BY.
const users = Array.from(
  { length: PARTICIPANTS },
  (_, i) => `u${String(i).padStart(2, '0')}`,
);

/** A full, deterministically ordered (user, date) grid. */
function fullGrid(): RpcRow[] {
  const rows: RpcRow[] = [];
  for (const user_id of users) {
    for (const challenge_date of dates) {
      let state = 'future';
      if (challenge_date < '2026-09-02') state = 'completed';
      else if (challenge_date === '2026-09-02') state = 'pending';
      rows.push(makeRow({ user_id, challenge_date, state }));
    }
  }
  return rows;
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('fetchDayStates — pagination past the PostgREST row cap', () => {
  it('returns every row for a 21×120 challenge (2520 rows, 3 pages)', async () => {
    const grid = fullGrid();
    const chain = rpcChain(grid);
    mocks.rpc.mockReturnValue(chain);

    const rows = await fetchDayStates('c1');

    expect(rows).toHaveLength(PARTICIPANTS * DAYS);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(chain.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('orders deterministically by user_id then challenge_date', async () => {
    const chain = rpcChain(fullGrid());
    mocks.rpc.mockReturnValue(chain);

    await fetchDayStates('c1');

    // Two order() calls per page: user_id, then challenge_date.
    expect(chain.orderCalls.slice(0, 2)).toEqual(['user_id', 'challenge_date']);
  });

  it('keeps the first, middle and last participant intact (no truncation)', async () => {
    mocks.rpc.mockReturnValue(rpcChain(fullGrid()));

    const rows = await fetchDayStates('c1');
    const byUser = new Map<string, typeof rows>();
    for (const r of rows) {
      byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    }

    for (const uid of ['u00', 'u10', 'u20']) {
      const mine = byUser.get(uid);
      expect(mine, `${uid} present`).toBeDefined();
      expect(mine).toHaveLength(DAYS);
      expect(mine?.find((r) => r.challengeDate === '2026-09-02')?.state).toBe(
        DayState.Pending,
      );
      expect(mine?.find((r) => r.challengeDate === '2026-11-28')?.state).toBe(
        DayState.Future,
      );
    }
    // The last participant would have been the first casualty of a 1000-row cut.
    expect(byUser.get('u20')).toHaveLength(DAYS);
  });

  it('maps a genuine not_participating row through unchanged', async () => {
    const grid = fullGrid();
    // u20 left the challenge early — the RPC really does return this state.
    const target = grid.find(
      (r) => r.user_id === 'u20' && r.challenge_date === '2026-11-28',
    );
    if (target) target.state = 'not_participating';
    mocks.rpc.mockReturnValue(rpcChain(grid));

    const rows = await fetchDayStates('c1');
    const cell = rows.find(
      (r) => r.userId === 'u20' && r.challengeDate === '2026-11-28',
    );
    expect(cell?.state).toBe(DayState.NotParticipating);
  });

  it('maps penalty metadata and stops after a single short page for a small challenge', async () => {
    const small: RpcRow[] = [
      makeRow({
        user_id: 'u00',
        challenge_date: START,
        state: 'completed',
        penalty_type: PenaltyType.DoubleSession,
        penalty_display_name: 'Dubbelpass',
        penalty_from_user_id: 'u01',
        required_sessions: 2,
      }),
    ];
    const chain = rpcChain(small);
    mocks.rpc.mockReturnValue(chain);

    const rows = await fetchDayStates('c1');

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(chain.rangeCalls).toEqual([[0, 999]]);
    expect(rows[0]).toMatchObject({
      userId: 'u00',
      state: DayState.Completed,
      penaltyType: PenaltyType.DoubleSession,
      penaltyDisplayName: 'Dubbelpass',
      penaltyFromUserId: 'u01',
      requiredSessions: 2,
    });
  });

  it('stops exactly on the count boundary (2000 rows = 2 full pages, no wasted request)', async () => {
    const rows2000: RpcRow[] = [];
    for (let i = 0; i < 2000; i++) {
      rows2000.push(
        makeRow({
          user_id: `u${String(Math.floor(i / DAYS)).padStart(2, '0')}`,
          challenge_date: dates[i % DAYS] ?? START,
        }),
      );
    }
    const chain = rpcChain(rows2000);
    mocks.rpc.mockReturnValue(chain);

    const rows = await fetchDayStates('c1');

    expect(rows).toHaveLength(2000);
    expect(chain.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('adapts the page step when the server cap is below the requested window', async () => {
    // Server refuses more than 400 rows per request; the full set is 2520.
    const chain = rpcChain(fullGrid(), 400);
    mocks.rpc.mockReturnValue(chain);

    const rows = await fetchDayStates('c1');

    expect(rows).toHaveLength(PARTICIPANTS * DAYS);
    // First window 0-999 yields 400 → step becomes 400, then contiguous.
    expect(chain.rangeCalls.slice(0, 3)).toEqual([
      [0, 999],
      [400, 799],
      [800, 1199],
    ]);
    // No gaps or dupes: every (user, date) present exactly once.
    expect(
      new Set(rows.map((r) => `${r.userId}|${r.challengeDate}`)).size,
    ).toBe(PARTICIPANTS * DAYS);
  });

  it('throws if the response is incomplete despite paging', async () => {
    // count says 2520 but the source only holds 500 rows — a real hole.
    const chain = rpcChain(fullGrid().slice(0, 500));
    chain.range = (from: number, to: number) => {
      chain.rangeCalls.push([from, to]);
      return Promise.resolve({
        data: fullGrid()
          .slice(0, 500)
          .slice(from, to + 1),
        error: null,
        count: 2520,
      });
    };
    mocks.rpc.mockReturnValue(chain);

    await expect(fetchDayStates('c1')).rejects.toThrow('incomplete');
  });

  it('propagates an RPC error', async () => {
    const chain = {
      order() {
        return chain;
      },
      range() {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      },
    };
    mocks.rpc.mockReturnValue(chain);

    await expect(fetchDayStates('c1')).rejects.toThrow('boom');
  });
});
