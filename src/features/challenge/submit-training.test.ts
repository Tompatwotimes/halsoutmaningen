import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeResult {
  data?: unknown;
  error?: unknown;
}

interface FakeBuilder extends Promise<FakeResult> {
  select: (...args: unknown[]) => FakeBuilder;
  eq: (...args: unknown[]) => FakeBuilder;
  delete: (...args: unknown[]) => FakeBuilder;
  insert: (...args: unknown[]) => Promise<FakeResult>;
  upsert: (...args: unknown[]) => FakeBuilder;
  single: () => Promise<FakeResult>;
  maybeSingle: () => Promise<FakeResult>;
}

/** A minimal fluent query-builder stub that resolves to `result` at any await point. */
function chain(result: FakeResult): FakeBuilder {
  const builder = Promise.resolve(result) as FakeBuilder;
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
  upload: vi.fn(),
  remove: vi.fn(),
  probeImage: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  },
}));

vi.mock('./heic', () => ({
  probeImage: mocks.probeImage,
}));

const { submitTraining } = await import('./submit-training');

function makeFile(name = 'foto.jpg', type = 'image/jpeg'): File {
  return new File(['x'.repeat(10)], name, { type });
}

const BASE_INPUT = {
  challengeId: 'c1',
  userId: 'u1',
  date: '2026-09-01',
  durationMinutes: 40,
  activity: 'Löpning',
  note: null,
};

describe('submitTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probeImage.mockResolvedValue({
      decodable: true,
      width: 100,
      height: 100,
      likelyHeic: false,
    });
  });

  it('translates a guard-trigger rejection into a Swedish message and does not touch storage', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: null, error: { message: 'Challenge is not active' } }),
    );

    await expect(submitTraining(BASE_INPUT)).rejects.toMatchObject({
      message: expect.stringContaining('inte aktiv'),
      entrySaved: false,
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('saves an entry with no proof file without touching storage', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );

    const result = await submitTraining(BASE_INPUT);
    expect(result).toEqual({ entryId: 'entry-1' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects an undecodable image before uploading, but keeps the saved entry', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );
    mocks.probeImage.mockResolvedValue({
      decodable: false,
      width: null,
      height: null,
      likelyHeic: true,
    });

    await expect(
      submitTraining({
        ...BASE_INPUT,
        proofFile: makeFile('IMG.heic', 'image/heic'),
      }),
    ).rejects.toMatchObject({ entrySaved: true });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('cleans up the newly uploaded object when linking the proof metadata fails', async () => {
    let proofCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'training_entries') {
        return chain({ data: { id: 'entry-1' }, error: null });
      }
      // training_proofs: 1st call = existence check (none), 2nd = insert (fails)
      proofCalls += 1;
      if (proofCalls === 1) {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: { message: 'insert failed' } });
    });
    mocks.upload.mockResolvedValue({ data: { path: 'new.jpg' }, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });

    await expect(
      submitTraining({ ...BASE_INPUT, proofFile: makeFile() }),
    ).rejects.toMatchObject({ entrySaved: true });

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    const [removedPaths] = mocks.remove.mock.calls[0] as [string[]];
    expect(removedPaths[0]).toEqual(
      expect.stringContaining('c1/u1/2026-09-01/'),
    );
  });

  it('replaces an existing proof: only removes the old object after the new one is linked', async () => {
    let proofCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'training_entries') {
        return chain({ data: { id: 'entry-1' }, error: null });
      }
      proofCalls += 1;
      if (proofCalls === 1) {
        // existence check finds a prior proof
        return chain({
          data: { storage_path: 'c1/u1/2026-09-01/old.jpg' },
          error: null,
        });
      }
      if (proofCalls === 2) {
        // delete of the old row
        return chain({ data: null, error: null });
      }
      // insert of the new row
      return chain({ data: null, error: null });
    });
    mocks.upload.mockResolvedValue({ data: { path: 'new.jpg' }, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });

    const result = await submitTraining({
      ...BASE_INPUT,
      proofFile: makeFile(),
    });
    expect(result).toEqual({ entryId: 'entry-1' });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(['c1/u1/2026-09-01/old.jpg']);
  });
});
