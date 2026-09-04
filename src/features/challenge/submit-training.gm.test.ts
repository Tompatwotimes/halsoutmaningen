import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Core isolation guarantee (GM1 plan Task 5, spec §2): a Game Master failure
 * must never turn a successful training submit into a failure. The pulse is
 * fired best-effort, unawaited, after the entry has already succeeded.
 */

interface FakeResult {
  data?: unknown;
  error?: unknown;
}

function chain(result: FakeResult) {
  const builder = Promise.resolve(result) as Promise<FakeResult> & {
    select: () => typeof builder;
    eq: () => typeof builder;
    delete: () => typeof builder;
    insert: () => Promise<FakeResult>;
    upsert: () => typeof builder;
    single: () => Promise<FakeResult>;
    maybeSingle: () => Promise<FakeResult>;
  };
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.delete = () => builder;
  builder.insert = () => Promise.resolve(result);
  builder.upsert = () => builder;
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  return builder;
}

const mocks = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  requestGameMasterPulse: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  },
}));

vi.mock('@/features/game-master/game-master-api', () => ({
  requestGameMasterPulse: mocks.requestGameMasterPulse,
}));

const { submitTraining } = await import('./submit-training');

const BASE_INPUT = {
  challengeId: 'c1',
  userId: 'u1',
  date: '2026-09-01',
  durationMinutes: 40,
  activity: 'Löpning',
  note: null,
};

describe('submitTraining × Game Master isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );
  });

  it('still resolves with the entry id when the Game Master pulse rejects', async () => {
    mocks.requestGameMasterPulse.mockRejectedValue(new Error('gm down'));

    await expect(submitTraining(BASE_INPUT)).resolves.toEqual({
      entryId: 'entry-1',
    });

    expect(mocks.requestGameMasterPulse).toHaveBeenCalledWith('c1');
    // let the swallowed rejection settle — no unhandled rejection
    await Promise.resolve();
  });

  it('does not await the pulse: a hanging pulse never blocks the result', async () => {
    mocks.requestGameMasterPulse.mockReturnValue(new Promise(() => undefined));

    await expect(submitTraining(BASE_INPUT)).resolves.toEqual({
      entryId: 'entry-1',
    });
  });
});
