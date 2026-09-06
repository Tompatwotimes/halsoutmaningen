import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeResult {
  data?: unknown;
  error?: unknown;
}

interface FakeBuilder extends Promise<FakeResult> {
  select: (...args: unknown[]) => FakeBuilder;
  eq: (...args: unknown[]) => FakeBuilder;
  in: (...args: unknown[]) => FakeBuilder;
  delete: (...args: unknown[]) => FakeBuilder;
  insert: (...args: unknown[]) => Promise<FakeResult>;
  upsert: (...args: unknown[]) => FakeBuilder;
  single: () => Promise<FakeResult>;
  maybeSingle: () => Promise<FakeResult>;
  returns: () => Promise<FakeResult>;
}

/** A minimal fluent query-builder stub that resolves to `result` at any await point. */
function chain(result: FakeResult): FakeBuilder {
  const builder = Promise.resolve(result) as FakeBuilder;
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.delete = () => builder;
  builder.insert = (...args) => {
    mocks.insert(...args);
    return Promise.resolve(result);
  };
  builder.upsert = () => builder;
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.returns = () => Promise.resolve(result);
  return builder;
}

const mocks = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  insert: vi.fn(),
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

  it('saves an entry with no proof files without touching storage', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );

    const result = await submitTraining({ ...BASE_INPUT, proofFiles: [] });
    expect(result).toEqual({ entryId: 'entry-1' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects a third image before any upload', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );

    await expect(
      submitTraining({
        ...BASE_INPUT,
        proofFiles: [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Högst två'),
      entrySaved: true,
    });
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
        proofFiles: [makeFile('IMG.heic', 'image/heic')],
      }),
    ).rejects.toMatchObject({ entrySaved: true });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('uploads two images and links them at positions 1 and 2', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'training_entries') {
        return chain({ data: { id: 'entry-1' }, error: null });
      }
      // training_proofs: existence check (none), then insert (ok)
      return chain({ data: [], error: null });
    });
    mocks.upload.mockResolvedValue({ data: { path: 'ok' }, error: null });

    const result = await submitTraining({
      ...BASE_INPUT,
      proofFiles: [makeFile('selfie.jpg'), makeFile('strava.png', 'image/png')],
    });

    expect(result).toEqual({ entryId: 'entry-1' });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    const [rows] = mocks.insert.mock.calls.at(-1) as [
      { position: number; storage_path: string; mime_type: string }[],
    ];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows[1]?.mime_type).toBe('image/png');
    // both objects uploaded before any DB row is touched → no orphan removal
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('cleans up every newly uploaded object when linking the proof metadata fails', async () => {
    let proofCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'training_entries') {
        return chain({ data: { id: 'entry-1' }, error: null });
      }
      // training_proofs: 1st call = existence check (none), 2nd = insert (fails)
      proofCalls += 1;
      if (proofCalls === 1) {
        return chain({ data: [], error: null });
      }
      return chain({ data: null, error: { message: 'insert failed' } });
    });
    mocks.upload.mockResolvedValue({ data: { path: 'new.jpg' }, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });

    await expect(
      submitTraining({
        ...BASE_INPUT,
        proofFiles: [makeFile('a.jpg'), makeFile('b.jpg')],
      }),
    ).rejects.toMatchObject({ entrySaved: true });

    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    const [removedPaths] = mocks.remove.mock.calls[0] as [string[]];
    expect(removedPaths).toHaveLength(2);
    expect(removedPaths[0]).toEqual(
      expect.stringContaining('c1/u1/2026-09-01/'),
    );
  });

  it('replaces an existing proof set: old objects removed only after the new rows are linked', async () => {
    let proofCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === 'training_entries') {
        return chain({ data: { id: 'entry-1' }, error: null });
      }
      proofCalls += 1;
      if (proofCalls === 1) {
        // existence check finds two prior proofs
        return chain({
          data: [
            { storage_path: 'c1/u1/2026-09-01/old1.jpg' },
            { storage_path: 'c1/u1/2026-09-01/old2.jpg' },
          ],
          error: null,
        });
      }
      if (proofCalls === 2) {
        return chain({ data: null, error: null }); // delete of the old rows
      }
      return chain({ data: null, error: null }); // insert of the new row(s)
    });
    mocks.upload.mockResolvedValue({ data: { path: 'new.jpg' }, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });

    const result = await submitTraining({
      ...BASE_INPUT,
      proofFiles: [makeFile('only.jpg')],
    });
    expect(result).toEqual({ entryId: 'entry-1' });
    // one new upload, then a single remove of BOTH old objects, last
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith([
      'c1/u1/2026-09-01/old1.jpg',
      'c1/u1/2026-09-01/old2.jpg',
    ]);
  });
});
