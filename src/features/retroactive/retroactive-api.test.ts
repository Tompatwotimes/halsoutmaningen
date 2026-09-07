import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
const remove = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload, remove }) },
    rpc: vi.fn(),
  },
}));

const { processImageForUpload, ImageProcessingError } = vi.hoisted(() => {
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
  return { processImageForUpload: vi.fn(), ImageProcessingError };
});

vi.mock('@/lib/media/image-processing', () => ({
  processImageForUpload,
  ImageProcessingError,
}));

const { uploadRetroactiveProof, RetroactiveError } =
  await import('./retroactive-api');

function file(name: string, type = 'image/jpeg') {
  return new File(['x'], name, { type });
}

function compressed(name = 'x.webp', mime = 'image/webp') {
  const out = new File(['c'], name, { type: mime });
  return {
    file: out,
    mimeType: mime,
    sizeBytes: out.size,
    width: 1600,
    height: 1200,
    wasProcessed: true,
  };
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  processImageForUpload.mockReset().mockResolvedValue(compressed());
});

describe('uploadRetroactiveProof', () => {
  it('compresses the file and uploads the processed bytes', async () => {
    const original = file('gammalt-pass.jpg');
    const meta = await uploadRetroactiveProof(
      'c1',
      'u1',
      '2026-08-10',
      original,
    );

    expect(processImageForUpload).toHaveBeenCalledWith(
      original,
      expect.objectContaining({ maxLongSidePx: 1600 }),
    );
    const [path, body, opts] = upload.mock.calls[0] as [
      string,
      File,
      { contentType: string },
    ];
    expect(body).not.toBe(original);
    expect(body.type).toBe('image/webp');
    expect(opts.contentType).toBe('image/webp');
    expect(path).toMatch(/^c1\/u1\/2026-08-10\/[\w-]+\.webp$/);
    expect(meta.storagePath).toBe(path);
    expect(meta.mimeType).toBe('image/webp');
    expect(meta.sizeBytes).toBe(body.size);
    expect(meta.width).toBe(1600);
  });

  it('maps an undecodable HEIC to a RetroactiveError with the HEIC message', async () => {
    processImageForUpload.mockRejectedValue(
      new ImageProcessingError('undecodable', 'trasig', true),
    );
    await expect(
      uploadRetroactiveProof(
        'c1',
        'u1',
        '2026-08-10',
        file('IMG.heic', 'image/heic'),
      ),
    ).rejects.toMatchObject({
      name: 'RetroactiveError',
      message: expect.stringMatching(/HEIC/i),
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces a storage upload failure as a RetroactiveError', async () => {
    upload.mockResolvedValue({ error: { message: 'boom' } });
    await expect(
      uploadRetroactiveProof('c1', 'u1', '2026-08-10', file('a.jpg')),
    ).rejects.toBeInstanceOf(RetroactiveError);
  });
});
