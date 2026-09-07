import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
const remove = vi.fn();
const createSignedUrl = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({ upload, remove, createSignedUrl }),
    },
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

const { uploadChatImages, chatImageSignedUrl, CHAT_MEDIA_BUCKET } =
  await import('./chat-media');

function jpeg(name = 'a.jpg') {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** What the processor hands back — a re-encoded WebP file by default. */
function processed(name: string, mime = 'image/webp') {
  const file = new File(['compressed'], name, { type: mime });
  return {
    file,
    mimeType: mime,
    sizeBytes: file.size,
    width: 1600,
    height: 1200,
    wasProcessed: true,
  };
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  createSignedUrl.mockReset();
  processImageForUpload.mockReset();
  processImageForUpload.mockImplementation((file: File) =>
    Promise.resolve(processed(file.name.replace(/\.\w+$/, '.webp'))),
  );
});

describe('uploadChatImages', () => {
  it('compresses each file and uploads the processed bytes, not the original', async () => {
    const original = jpeg('holiday.jpg');
    const [first] = await uploadChatImages('ch1', 'u1', 'msg1', [original]);

    expect(processImageForUpload).toHaveBeenCalledTimes(1);
    expect(processImageForUpload.mock.calls[0]?.[0]).toBe(original);

    const [path, body, opts] = upload.mock.calls[0] as [
      string,
      File,
      { contentType: string },
    ];
    expect(body).not.toBe(original);
    expect(body.type).toBe('image/webp');
    expect(opts.contentType).toBe('image/webp');
    expect(path).toMatch(/^ch1\/u1\/msg1\/1-[\w-]+\.webp$/);
    expect(first?.mime_type).toBe('image/webp');
    expect(first?.size_bytes).toBe(body.size);
    expect(first?.width).toBe(1600);
  });

  it('uses a .jpg extension when the processor emits JPEG', async () => {
    processImageForUpload.mockResolvedValue(processed('x.jpg', 'image/jpeg'));
    const [first] = await uploadChatImages('ch1', 'u1', 'm', [jpeg()]);
    expect(first?.path).toMatch(/\.jpg$/);
  });

  it('reports "Förbereder bild…" then "Laddar upp…" through onPhase', async () => {
    const phases: string[] = [];
    await uploadChatImages('ch1', 'u1', 'm', [jpeg(), jpeg('b.jpg')], (p) =>
      phases.push(p),
    );
    expect(phases).toEqual(['processing', 'uploading']);
  });

  it('rejects more than four images before processing or uploading', async () => {
    await expect(
      uploadChatImages('ch1', 'u1', 'm', [
        jpeg(),
        jpeg(),
        jpeg(),
        jpeg(),
        jpeg(),
      ]),
    ).rejects.toThrow();
    expect(processImageForUpload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces an undecodable HEIC as a ChatError with the HEIC message, uploads nothing', async () => {
    processImageForUpload.mockRejectedValue(
      new ImageProcessingError('undecodable', 'trasig', true),
    );
    await expect(
      uploadChatImages('ch1', 'u1', 'm', [jpeg('IMG.heic')]),
    ).rejects.toMatchObject({
      name: 'ChatError',
      message: expect.stringMatching(/HEIC/i),
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces a non-HEIC processing failure with the generic message', async () => {
    processImageForUpload.mockRejectedValue(
      new ImageProcessingError('undecodable', 'trasig', false),
    );
    await expect(
      uploadChatImages('ch1', 'u1', 'm', [jpeg('weird.jpg')]),
    ).rejects.toMatchObject({
      name: 'ChatError',
      message: expect.stringMatching(/JPEG.*PNG.*WEBP/i),
    });
  });

  it('removes already-uploaded objects when a later upload fails', async () => {
    upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(
      uploadChatImages('ch1', 'u1', 'm', [jpeg(), jpeg('b.jpg')]),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect((remove.mock.calls[0]?.[0] as string[]).length).toBe(1);
  });
});

describe('chatImageSignedUrl', () => {
  it('returns the signed url on success', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://x/y?token=1' },
      error: null,
    });
    expect(await chatImageSignedUrl('ch1/u1/m/1-a.webp')).toBe(
      'https://x/y?token=1',
    );
  });

  it('returns null when the storage policy denies it', async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });
    expect(await chatImageSignedUrl('ch1/u1/m/1-a.webp')).toBeNull();
  });
});

it('bucket id is chat-media', () => {
  expect(CHAT_MEDIA_BUCKET).toBe('chat-media');
});
