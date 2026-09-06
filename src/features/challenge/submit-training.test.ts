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

const mocks = vi.hoisted(() => {
  class ImageProcessingError extends Error {
    code: string;
    likelyHeic: boolean;
    constructor(code: string, message: string, likelyHeic = false) {
      super(message);
      this.name = 'ImageProcessingError';
      this.code = code;
      this.likelyHeic = likelyHeic;
    }
  }
  return {
    from: vi.fn<(table: string) => unknown>(),
    insert: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    processImages: vi.fn(),
    ImageProcessingError,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  },
}));

vi.mock('@/lib/media/image-processing', () => ({
  processImagesForUpload: mocks.processImages,
  ImageProcessingError: mocks.ImageProcessingError,
}));

const { submitTraining, PROOF_IMAGE_PROCESS_OPTIONS } =
  await import('./submit-training');

/** Default processor behaviour: each input file -> a compressed WebP. */
function compressedOf(file: File) {
  const out = new File(['c'], file.name.replace(/\.\w+$/, '.webp'), {
    type: 'image/webp',
  });
  return {
    file: out,
    mimeType: 'image/webp',
    sizeBytes: out.size,
    width: 1600,
    height: 1200,
    wasProcessed: true,
  };
}

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
    mocks.processImages.mockImplementation((files: File[]) =>
      Promise.resolve(files.map(compressedOf)),
    );
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

  it('rejects a third image before processing or uploading', async () => {
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
    expect(mocks.processImages).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects an undecodable image during processing, but keeps the saved entry', async () => {
    mocks.from.mockImplementation(() =>
      chain({ data: { id: 'entry-1' }, error: null }),
    );
    mocks.processImages.mockRejectedValue(
      new mocks.ImageProcessingError('undecodable', 'Bild 1: trasig', true),
    );

    await expect(
      submitTraining({
        ...BASE_INPUT,
        proofFiles: [makeFile('IMG.heic', 'image/heic')],
      }),
    ).rejects.toMatchObject({ entrySaved: true });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('compresses every proof file with the proof profile before uploading', async () => {
    mocks.from.mockImplementation((table: string) =>
      table === 'training_entries'
        ? chain({ data: { id: 'entry-1' }, error: null })
        : chain({ data: [], error: null }),
    );
    mocks.upload.mockResolvedValue({ data: { path: 'ok' }, error: null });
    const phases: string[] = [];

    await submitTraining({
      ...BASE_INPUT,
      proofFiles: [makeFile('selfie.jpg')],
      onProofPhase: (p) => phases.push(p),
    });

    expect(mocks.processImages).toHaveBeenCalledWith(
      [expect.any(File)],
      PROOF_IMAGE_PROCESS_OPTIONS,
    );
    expect(phases).toEqual(['processing', 'uploading']);
  });

  it('uploads two compressed images and links them at positions 1 and 2', async () => {
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
    // upload receives the compressed file, not the original
    const [, firstBody, firstOpts] = mocks.upload.mock.calls[0] as [
      string,
      File,
      { contentType: string },
    ];
    expect(firstBody.type).toBe('image/webp');
    expect(firstOpts.contentType).toBe('image/webp');
    const [rows] = mocks.insert.mock.calls.at(-1) as [
      {
        position: number;
        storage_path: string;
        mime_type: string;
        size_bytes: number;
      }[],
    ];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows[1]?.mime_type).toBe('image/webp');
    expect(rows[0]?.storage_path).toMatch(/\.webp$/);
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
