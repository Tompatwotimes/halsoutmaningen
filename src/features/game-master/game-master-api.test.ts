import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeResult {
  data?: unknown;
  error?: unknown;
}

/**
 * A minimal fluent query-builder stub that records `.eq/.or/.order` calls and
 * resolves to `result` at any await point — mirrors the chain used in
 * `submit-training.test.ts` / `challenge-api.test.ts`.
 */
function selectChain(result: FakeResult) {
  const calls = {
    select: [] as unknown[],
    eq: [] as [string, unknown][],
    or: [] as string[],
    order: [] as [string, unknown][],
  };
  const builder = Promise.resolve(result) as Promise<FakeResult> & {
    calls: typeof calls;
    select: (...a: unknown[]) => typeof builder;
    eq: (col: string, val: unknown) => typeof builder;
    or: (expr: string) => typeof builder;
    order: (col: string, opts?: unknown) => typeof builder;
  };
  builder.calls = calls;
  builder.select = (...a) => {
    calls.select.push(a);
    return builder;
  };
  builder.eq = (col, val) => {
    calls.eq.push([col, val]);
    return builder;
  };
  builder.or = (expr) => {
    calls.or.push(expr);
    return builder;
  };
  builder.order = (col, opts) => {
    calls.order.push([col, opts]);
    return builder;
  };
  return builder;
}

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn<(table: string) => unknown>(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

const {
  requestGameMasterPulse,
  markGameMasterEventSeen,
  fetchNextGameMasterEvent,
  fetchGameMasterArchive,
  GameMasterError,
} = await import('./game-master-api');

function eventRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'e0',
    challenge_id: 'c1',
    family: 'missed_day',
    visibility: 'private',
    subject_user_id: 'u1',
    template_id: 't1',
    severity: 3,
    title_text: 'SYSTEMET HAR NOTERAT EN AVVIKELSE',
    body_text: 'Kravet var 30 minuter.',
    payload: {},
    archive: false,
    status: 'active',
    starts_at: '2026-09-04T06:00:00Z',
    expires_at: null,
    created_at: '2026-09-04T06:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestGameMasterPulse', () => {
  it('calls the RPC with ONLY the challenge id', async () => {
    mocks.rpc.mockResolvedValue({ data: 'evt-1', error: null });

    const id = await requestGameMasterPulse('c1');

    expect(id).toBe('evt-1');
    expect(mocks.rpc).toHaveBeenCalledWith('request_game_master_pulse', {
      p_challenge_id: 'c1',
    });
    const [, args] = mocks.rpc.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(args)).toEqual(['p_challenge_id']);
    // no victim / template / body / score smuggled in
    for (const forbidden of [
      'p_user_id',
      'p_subject_user_id',
      'p_template_id',
      'p_body',
      'p_title',
      'p_score',
      'p_severity',
    ]) {
      expect(args).not.toHaveProperty(forbidden);
    }
  });

  it('resolves to null when the server stays silent (no event)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requestGameMasterPulse('c1')).resolves.toBeNull();
  });

  it('rejects with GameMasterError on a transport failure', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'fetch failed' },
    });
    await expect(requestGameMasterPulse('c1')).rejects.toBeInstanceOf(
      GameMasterError,
    );
  });

  it('a best-effort caller swallows the error but still sees silence as normal', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      requestGameMasterPulse('c1').catch(() => undefined),
    ).resolves.toBeUndefined();

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      requestGameMasterPulse('c1').catch(() => undefined),
    ).resolves.toBeNull();
  });
});

describe('markGameMasterEventSeen', () => {
  it('calls the protected RPC with the event id and dismiss flag', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await markGameMasterEventSeen('e1', true);

    expect(mocks.rpc).toHaveBeenCalledWith('mark_game_master_event_seen', {
      p_event_id: 'e1',
      p_dismiss: true,
    });
  });

  it('rejects with GameMasterError when the RPC fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(markGameMasterEventSeen('e1', false)).rejects.toBeInstanceOf(
      GameMasterError,
    );
  });
});

describe('fetchNextGameMasterEvent', () => {
  it('issues an RLS-scoped query and drops events this user has dismissed', async () => {
    const eventsChain = selectChain({
      data: [
        eventRow({ id: 'e1', severity: 5 }),
        eventRow({ id: 'e2', severity: 3 }),
      ],
      error: null,
    });
    const viewsChain = selectChain({
      data: [
        {
          event_id: 'e1',
          first_seen_at: '2026-09-04T07:00:00Z',
          dismissed_at: '2026-09-04T07:01:00Z',
        },
      ],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === 'game_master_events' ? eventsChain : viewsChain,
    );

    const ev = await fetchNextGameMasterEvent('c1', 'u1');

    // e1 is dismissed → the next-best (e2) is returned
    expect(ev?.id).toBe('e2');
    expect(ev?.title).toBe('SYSTEMET HAR NOTERAT EN AVVIKELSE');

    const eqCols = eventsChain.calls.eq.map(([c]) => c);
    // RLS handles visibility — no client-side subject filter as a security gate
    expect(eqCols).not.toContain('subject_user_id');
    expect(eqCols).toContain('challenge_id');
    expect(eqCols).toContain('status');
    expect(eventsChain.calls.eq).toContainEqual(['status', 'active']);
    // the view lookup is scoped to the current user
    expect(viewsChain.calls.eq).toContainEqual(['user_id', 'u1']);
  });

  it('returns null when every visible event is dismissed', async () => {
    const eventsChain = selectChain({
      data: [eventRow({ id: 'e1' })],
      error: null,
    });
    const viewsChain = selectChain({
      data: [
        {
          event_id: 'e1',
          first_seen_at: '2026-09-04T07:00:00Z',
          dismissed_at: '2026-09-04T07:01:00Z',
        },
      ],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === 'game_master_events' ? eventsChain : viewsChain,
    );

    await expect(fetchNextGameMasterEvent('c1', 'u1')).resolves.toBeNull();
  });

  it('returns null (no view fetch) when there are no visible events', async () => {
    const eventsChain = selectChain({ data: [], error: null });
    mocks.from.mockImplementation(() => eventsChain);

    await expect(fetchNextGameMasterEvent('c1', 'u1')).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('rejects with GameMasterError on a query failure', async () => {
    mocks.from.mockImplementation(() =>
      selectChain({ data: null, error: { message: 'boom' } }),
    );
    await expect(fetchNextGameMasterEvent('c1', 'u1')).rejects.toBeInstanceOf(
      GameMasterError,
    );
  });
});

describe('fetchGameMasterArchive', () => {
  it('requests public, archival, active events newest first', async () => {
    const chain = selectChain({
      data: [
        eventRow({ id: 'a1', visibility: 'public', archive: true }),
        eventRow({ id: 'a2', visibility: 'public', archive: true }),
      ],
      error: null,
    });
    mocks.from.mockReturnValue(chain);

    const rows = await fetchGameMasterArchive('c1');

    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(chain.calls.eq).toContainEqual(['challenge_id', 'c1']);
    expect(chain.calls.eq).toContainEqual(['visibility', 'public']);
    expect(chain.calls.eq).toContainEqual(['archive', true]);
    expect(chain.calls.eq).toContainEqual(['status', 'active']);
    expect(chain.calls.order).toContainEqual([
      'created_at',
      { ascending: false },
    ]);
  });

  it('rejects with GameMasterError on failure', async () => {
    mocks.from.mockReturnValue(
      selectChain({ data: null, error: { message: 'boom' } }),
    );
    await expect(fetchGameMasterArchive('c1')).rejects.toBeInstanceOf(
      GameMasterError,
    );
  });
});
