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

vi.mock('@/features/challenge/heic', () => ({
  probeImage: vi.fn().mockResolvedValue({
    decodable: true,
    width: 100,
    height: 80,
    likelyHeic: false,
  }),
}));

const { uploadChatImages, chatImageSignedUrl, CHAT_MEDIA_BUCKET } =
  await import('./chat-media');

function jpeg(name = 'a.jpg') {
  return new File(['x'], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  createSignedUrl.mockReset();
});

describe('uploadChatImages', () => {
  it('uploads each file under {challenge}/{user}/{message}/ with a 1-based position', async () => {
    const [first, second] = await uploadChatImages('ch1', 'u1', 'msg1', [
      jpeg(),
      jpeg('b.jpg'),
    ]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(first?.path).toMatch(/^ch1\/u1\/msg1\/1-[\w-]+\.jpg$/);
    expect(second?.path).toMatch(/^ch1\/u1\/msg1\/2-[\w-]+\.jpg$/);
    expect(first?.mime_type).toBe('image/jpeg');
    expect(first?.width).toBe(100);
  });

  it('rejects more than four images without uploading', async () => {
    await expect(
      uploadChatImages('ch1', 'u1', 'm', [
        jpeg(),
        jpeg(),
        jpeg(),
        jpeg(),
        jpeg(),
      ]),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
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
    expect(await chatImageSignedUrl('ch1/u1/m/1-a.jpg')).toBe(
      'https://x/y?token=1',
    );
  });

  it('returns null when the storage policy denies it', async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });
    expect(await chatImageSignedUrl('ch1/u1/m/1-a.jpg')).toBeNull();
  });
});

it('bucket id is chat-media', () => {
  expect(CHAT_MEDIA_BUCKET).toBe('chat-media');
});
