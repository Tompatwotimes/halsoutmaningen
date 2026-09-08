import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chat API adapter talks to Supabase through the same deliberately-untyped
 * boundary as game-master-api.ts. Every read and write is an RPC — ordinary
 * members have no direct SELECT on chat_messages (PR #3 finding I-1). These
 * tests assert the exact RPC call shapes (in particular that a client cannot
 * influence sender identity), that a moderated message's withheld body maps to
 * a null, and that a transport failure surfaces as ChatError.
 */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

const { uploadChatImagesMock } = vi.hoisted(() => ({
  uploadChatImagesMock: vi.fn(),
}));
vi.mock('./chat-media', () => ({
  newChatMessageId: () => 'generated-msg-id',
  uploadChatImages: uploadChatImagesMock,
  removeChatImages: vi.fn(),
}));

const {
  ChatError,
  sendChatMessage,
  markChatRead,
  mapChatRow,
  narrowReplyPreview,
  setChatMessageLike,
  fetchRecentChatMessages,
  fetchOlderChatMessages,
  fetchUnreadCount,
} = await import('./chat-api');

beforeEach(() => {
  rpc.mockReset();
  uploadChatImagesMock.mockReset().mockResolvedValue([
    {
      path: 'c1/u1/generated-msg-id/1-a.webp',
      mime_type: 'image/webp',
      size_bytes: 10,
      width: 1600,
      height: 1200,
    },
  ]);
});

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    seq: 5,
    challenge_id: 'c1',
    sender_type: 'participant',
    sender_user_id: 'u1',
    sender_display_name: 'Pia',
    body: 'hej',
    status: 'active',
    attachments: [],
    created_at: '2026-09-05T12:00:00Z',
    ...overrides,
  };
}

describe('sendChatMessage (text only)', () => {
  it('calls the RPC with exactly the challenge id and body — no sender field', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({ challengeId: 'c1', userId: 'u1', body: 'hej' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('post_chat_message', {
      p_challenge_id: 'c1',
      p_body: 'hej',
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_body',
      'p_challenge_id',
    ]);
  });

  it('maps the returned row to a ChatMessage', async () => {
    rpc.mockResolvedValue({
      data: rowFixture({
        seq: 9,
        sender_user_id: 'me',
        sender_display_name: 'Jag',
        attachments: [{ position: 1, path: 'c1/u1/m/1-a.jpg' }],
      }),
      error: null,
    });
    const msg = await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'hej',
    });
    expect(msg.seq).toBe(9);
    expect(msg.senderUserId).toBe('me');
    expect(msg.attachments).toEqual([{ position: 1, path: 'c1/u1/m/1-a.jpg' }]);
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(
      sendChatMessage({ challengeId: 'c1', userId: 'u1', body: 'hej' }),
    ).rejects.toBeInstanceOf(ChatError);
  });

  it('rejects an empty message with no text and no images', async () => {
    await expect(
      sendChatMessage({ challengeId: 'c1', userId: 'u1', body: '   ' }),
    ).rejects.toBeInstanceOf(ChatError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects more than four images before any upload', async () => {
    const f = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await expect(
      sendChatMessage({
        challengeId: 'c1',
        userId: 'u1',
        body: 'x',
        files: [f(), f(), f(), f(), f()],
      }),
    ).rejects.toBeInstanceOf(ChatError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forwards the onPhase callback into uploadChatImages', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    const onPhase = vi.fn();
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: '',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
      onPhase,
    });
    expect(uploadChatImagesMock).toHaveBeenCalledWith(
      'c1',
      'u1',
      'generated-msg-id',
      expect.any(Array),
      onPhase,
    );
  });

  it('does not touch the image pipeline for a text-only message', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'bara text',
    });
    expect(uploadChatImagesMock).not.toHaveBeenCalled();
  });
});

describe('mapChatRow attachments', () => {
  it('maps a hidden row to an empty attachments array', async () => {
    rpc.mockResolvedValue({
      data: rowFixture({ status: 'hidden', body: null, attachments: [] }),
      error: null,
    });
    const msg = await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'x',
    });
    expect(msg.attachments).toEqual([]);
    expect(msg.body).toBeNull();
  });
});

describe('mapChatRow training_card', () => {
  it('maps a training_card row from list_chat_messages', () => {
    const msg = mapChatRow(
      rowFixture({
        sender_type: 'training_card',
        body: null,
        training_card: {
          entry_id: 'ent-1',
          activity: 'Simning',
          duration_minutes: 50,
          note: 'skönt',
          challenge_date: '2026-09-06',
          entry_status: 'active',
          trained_at: '2026-09-06T18:00:00Z',
          proofs: [
            { position: 2, path: 'c/u/d/2-b.jpg' },
            { position: 1, path: 'c/u/d/1-a.jpg' },
          ],
        },
      }),
    );
    expect(msg.senderType).toBe('training_card');
    expect(msg.trainingCard).toEqual({
      entryId: 'ent-1',
      activity: 'Simning',
      durationMinutes: 50,
      note: 'skönt',
      challengeDate: '2026-09-06',
      entryStatus: 'active',
      trainedAt: '2026-09-06T18:00:00Z',
      proofs: [
        { position: 1, path: 'c/u/d/1-a.jpg' },
        { position: 2, path: 'c/u/d/2-b.jpg' },
      ],
    });
  });

  it('maps a withheld (hidden) training_card to trainingCard null', () => {
    const msg = mapChatRow(
      rowFixture({
        sender_type: 'training_card',
        status: 'hidden',
        body: null,
        training_card: null,
      }),
    );
    expect(msg.senderType).toBe('training_card');
    expect(msg.trainingCard).toBeNull();
  });

  it('leaves trainingCard null for an ordinary message', () => {
    expect(mapChatRow(rowFixture()).trainingCard).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list_chat_messages v4 (migration 20260908120000): +like_count, +liked_by_me,
// +reply_preview. All narrowed once, here at the adapter boundary — no caller
// should need `message.likeCount ?? 0`.
// ---------------------------------------------------------------------------
describe('mapChatRow — like_count / liked_by_me', () => {
  it('maps like_count 0', () => {
    expect(mapChatRow(rowFixture({ like_count: 0 })).likeCount).toBe(0);
  });
  it('maps like_count 1', () => {
    expect(mapChatRow(rowFixture({ like_count: 1 })).likeCount).toBe(1);
  });
  it('maps like_count > 1', () => {
    expect(mapChatRow(rowFixture({ like_count: 7 })).likeCount).toBe(7);
  });
  it('fails a negative like_count closed to 0', () => {
    expect(mapChatRow(rowFixture({ like_count: -3 })).likeCount).toBe(0);
  });
  it('does not coerce a numeric string like_count', () => {
    expect(mapChatRow(rowFixture({ like_count: '4' })).likeCount).toBe(0);
  });
  it('fails a non-integer like_count closed to 0', () => {
    expect(mapChatRow(rowFixture({ like_count: 2.5 })).likeCount).toBe(0);
    expect(mapChatRow(rowFixture({ like_count: Number.NaN })).likeCount).toBe(
      0,
    );
  });

  it('maps liked_by_me true', () => {
    expect(mapChatRow(rowFixture({ liked_by_me: true })).likedByMe).toBe(true);
  });
  it('maps liked_by_me false', () => {
    expect(mapChatRow(rowFixture({ liked_by_me: false })).likedByMe).toBe(
      false,
    );
  });
  it('never treats a "false" string as true (no Boolean() coercion)', () => {
    expect(mapChatRow(rowFixture({ liked_by_me: 'false' })).likedByMe).toBe(
      false,
    );
    expect(mapChatRow(rowFixture({ liked_by_me: 'true' })).likedByMe).toBe(
      false,
    );
    expect(mapChatRow(rowFixture({ liked_by_me: 1 })).likedByMe).toBe(false);
  });
});

describe('mapChatRow — reply_preview', () => {
  it('maps a visible text-parent preview and derives replyToMessageId', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p1',
          seq: 3,
          sender_type: 'participant',
          sender_user_id: 'u9',
          sender_display_name: 'Anna',
          kind: 'text',
          text: 'Golf räknas inte',
          has_image: false,
          training: null,
        },
      }),
    );
    expect(msg.replyPreview).toEqual({
      deleted: false,
      messageId: 'p1',
      seq: 3,
      senderType: 'participant',
      senderUserId: 'u9',
      senderDisplayName: 'Anna',
      kind: 'text',
      text: 'Golf räknas inte',
      hasImage: false,
      training: null,
    });
    expect(msg.replyToMessageId).toBe('p1');
  });

  it('maps a visible image-only-parent preview', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p2',
          kind: 'image',
          text: null,
          has_image: true,
          training: null,
        },
      }),
    );
    expect(msg.replyPreview?.kind).toBe('image');
    expect(msg.replyPreview?.hasImage).toBe(true);
    expect(msg.replyPreview?.text).toBeNull();
  });

  it('maps a visible training-card-parent preview to activity + duration only', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p3',
          kind: 'training_card',
          text: null,
          has_image: false,
          training: {
            activity: 'Löpning',
            duration_minutes: 45,
            // fields the server must never send — proven not to leak through:
            note: 'HEMLIG-NOTE',
            proofs: [{ position: 1, path: 'c/u/d/1.jpg' }],
            storage_path: 'c/u/d/1.jpg',
            entry_status: 'active',
          },
        },
      }),
    );
    expect(msg.replyPreview?.kind).toBe('training_card');
    expect(msg.replyPreview?.training).toEqual({
      activity: 'Löpning',
      durationMinutes: 45,
    });
    expect(Object.keys(msg.replyPreview!.training!).sort()).toEqual([
      'activity',
      'durationMinutes',
    ]);
    expect(JSON.stringify(msg.replyPreview)).not.toContain('HEMLIG-NOTE');
    expect(JSON.stringify(msg.replyPreview)).not.toContain('1.jpg');
  });

  it('maps a visible Game Master-parent preview', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p4',
          kind: 'game_master',
          sender_type: 'game_master',
          sender_user_id: null,
          sender_display_name: null,
          text: 'GAME MASTER: kör hårt',
          has_image: false,
          training: null,
        },
      }),
    );
    expect(msg.replyPreview?.kind).toBe('game_master');
    expect(msg.replyPreview?.senderType).toBe('game_master');
    expect(msg.replyPreview?.text).toBe('GAME MASTER: kör hårt');
  });

  it('maps the {"deleted": true} tombstone with every descriptive field withheld', () => {
    const msg = mapChatRow(rowFixture({ reply_preview: { deleted: true } }));
    expect(msg.replyPreview).toEqual({
      deleted: true,
      messageId: null,
      seq: null,
      senderType: null,
      senderUserId: null,
      senderDisplayName: null,
      kind: null,
      text: null,
      hasImage: false,
      training: null,
    });
    expect(msg.replyToMessageId).toBeNull();
  });

  it('never reads content off a tombstone even if the payload wrongly carries it', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          deleted: true,
          message_id: 'SECRET-ID',
          sender_display_name: 'SECRET-NAME',
          text: 'SECRET-BODY',
          training: { activity: 'SECRET-ACTIVITY', duration_minutes: 30 },
        },
      }),
    );
    expect(msg.replyPreview?.deleted).toBe(true);
    expect(msg.replyPreview?.messageId).toBeNull();
    expect(msg.replyPreview?.senderDisplayName).toBeNull();
    expect(msg.replyPreview?.text).toBeNull();
    expect(msg.replyPreview?.training).toBeNull();
    expect(msg.replyToMessageId).toBeNull();
    expect(JSON.stringify(msg.replyPreview)).not.toContain('SECRET');
  });

  it('maps a null / absent / malformed reply_preview to null (no quote)', () => {
    expect(
      mapChatRow(rowFixture({ reply_preview: null })).replyPreview,
    ).toBeNull();
    expect(mapChatRow(rowFixture()).replyPreview).toBeNull(); // key absent
    expect(
      mapChatRow(rowFixture({ reply_preview: 'boom' })).replyPreview,
    ).toBeNull();
    expect(
      mapChatRow(rowFixture({ reply_preview: 42 })).replyPreview,
    ).toBeNull();
    expect(
      mapChatRow(rowFixture({ reply_preview: [] })).replyPreview,
    ).toBeNull();
  });

  it('maps a visible preview with no message_id to null (malformed → no quote)', () => {
    expect(
      mapChatRow(rowFixture({ reply_preview: { kind: 'text', text: 'x' } }))
        .replyPreview,
    ).toBeNull();
  });

  it('degrades a malformed nested training object to null without throwing', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p5',
          kind: 'training_card',
          training: 'not-an-object',
        },
      }),
    );
    expect(msg.replyPreview?.training).toBeNull();
    expect(msg.replyPreview?.kind).toBe('training_card');
  });

  it('degrades malformed scalar fields to safe defaults without throwing', () => {
    const msg = mapChatRow(
      rowFixture({
        reply_preview: {
          message_id: 'p6',
          seq: 'not-a-number',
          sender_type: 'weird',
          kind: 'not-a-kind',
          has_image: 'yes',
          text: 123,
          training: { activity: 5, duration_minutes: 'lots' },
        },
      }),
    );
    expect(msg.replyPreview?.messageId).toBe('p6');
    expect(msg.replyPreview?.seq).toBeNull();
    expect(msg.replyPreview?.senderType).toBeNull();
    expect(msg.replyPreview?.kind).toBeNull();
    expect(msg.replyPreview?.hasImage).toBe(false);
    expect(msg.replyPreview?.text).toBeNull();
    expect(msg.replyPreview?.training).toEqual({
      activity: null,
      durationMinutes: 0,
    });
  });
});

describe('narrowReplyPreview (unit)', () => {
  it('returns null for null / undefined / scalars / arrays', () => {
    expect(narrowReplyPreview(null)).toBeNull();
    expect(narrowReplyPreview(undefined)).toBeNull();
    expect(narrowReplyPreview('x')).toBeNull();
    expect(narrowReplyPreview(0)).toBeNull();
    expect(narrowReplyPreview(true)).toBeNull();
    expect(narrowReplyPreview([])).toBeNull();
    expect(narrowReplyPreview([{ deleted: true }])).toBeNull();
  });

  it('returns the tombstone for { deleted: true }', () => {
    expect(narrowReplyPreview({ deleted: true })?.deleted).toBe(true);
    expect(narrowReplyPreview({ deleted: true })?.messageId).toBeNull();
  });

  it('returns a visible preview for a well-formed object', () => {
    const p = narrowReplyPreview({
      message_id: 'p',
      kind: 'text',
      text: 'hej',
    });
    expect(p?.deleted).toBe(false);
    expect(p?.messageId).toBe('p');
    expect(p?.kind).toBe('text');
  });

  it('returns null for a visible preview missing message_id', () => {
    expect(narrowReplyPreview({ kind: 'text' })).toBeNull();
  });

  it('never throws on arbitrary garbage', () => {
    expect(() =>
      narrowReplyPreview({ message_id: {}, training: [], seq: {}, kind: [] }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Release-compatibility: the NEW frontend must also run against the CURRENT
// production `list_chat_messages` — which has `training_card` (migration
// 20260907120000) but NOT `like_count` / `liked_by_me` / `reply_preview`
// (migration 20260908120000 is not deployed). This is the NEW-frontend +
// OLD-DB half of the DB-first rollout window (design §22.2).
// ---------------------------------------------------------------------------
describe('backwards compatibility — current (pre-replies-likes) list_chat_messages shape', () => {
  /** Exactly the keys production's RPC returns today — training_card, no social fields. */
  function currentProdRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cur-1',
      seq: 20,
      challenge_id: 'c1',
      sender_type: 'participant',
      sender_user_id: 'u9',
      sender_display_name: 'Erik',
      body: 'hej från nuvarande produktion',
      status: 'active',
      attachments: [],
      training_card: null,
      created_at: '2026-09-07T12:00:00Z',
      ...overrides,
    };
  }

  it('the fixture has none of the three new keys', () => {
    const row = currentProdRow();
    expect('like_count' in row).toBe(false);
    expect('liked_by_me' in row).toBe(false);
    expect('reply_preview' in row).toBe(false);
    expect('reply_to_message_id' in row).toBe(false);
  });

  it('maps a participant row → likeCount 0, likedByMe false, replyPreview null, replyToMessageId null', () => {
    const msg = mapChatRow(currentProdRow());
    expect(msg.senderType).toBe('participant');
    expect(msg.body).toBe('hej från nuvarande produktion');
    expect(msg.likeCount).toBe(0);
    expect(msg.likedByMe).toBe(false);
    expect(msg.replyPreview).toBeNull();
    expect(msg.replyToMessageId).toBeNull();
  });

  it('maps a Game Master row → the same safe defaults, sender unchanged', () => {
    const msg = mapChatRow(
      currentProdRow({
        sender_type: 'game_master',
        sender_user_id: null,
        sender_display_name: null,
        body: 'Systemet observerar.',
      }),
    );
    expect(msg.senderType).toBe('game_master');
    expect(msg.body).toBe('Systemet observerar.');
    expect(msg.likeCount).toBe(0);
    expect(msg.likedByMe).toBe(false);
    expect(msg.replyPreview).toBeNull();
  });

  it('maps a training_card row → trainingCard unchanged AND the social defaults', () => {
    const msg = mapChatRow(
      currentProdRow({
        sender_type: 'training_card',
        body: null,
        training_card: {
          entry_id: 'ent-9',
          activity: 'Cykling',
          duration_minutes: 60,
          note: null,
          challenge_date: '2026-09-07',
          entry_status: 'active',
          trained_at: '2026-09-07T07:00:00Z',
          proofs: [{ position: 1, path: 'c/u/d/1-a.jpg' }],
        },
      }),
    );
    expect(msg.trainingCard?.activity).toBe('Cykling');
    expect(msg.trainingCard?.durationMinutes).toBe(60);
    expect(msg.likeCount).toBe(0);
    expect(msg.likedByMe).toBe(false);
    expect(msg.replyPreview).toBeNull();
  });

  it('maps a hidden row → withheld body AND neutral social defaults', () => {
    const msg = mapChatRow(currentProdRow({ status: 'hidden', body: null }));
    expect(msg.status).toBe('hidden');
    expect(msg.body).toBeNull();
    expect(msg.likeCount).toBe(0);
    expect(msg.likedByMe).toBe(false);
    expect(msg.replyPreview).toBeNull();
  });

  it('fetchRecentChatMessages maps a whole mixed current-production page without throwing', async () => {
    rpc.mockResolvedValue({
      data: [
        currentProdRow({ id: 'a', seq: 4 }),
        currentProdRow({
          id: 'b',
          seq: 3,
          sender_type: 'game_master',
          sender_user_id: null,
        }),
        currentProdRow({
          id: 'c',
          seq: 2,
          sender_type: 'training_card',
          body: null,
          training_card: {
            entry_id: 'e',
            activity: 'Gå',
            duration_minutes: 30,
            note: null,
            challenge_date: '2026-09-07',
            entry_status: 'active',
            trained_at: '2026-09-07T07:00:00Z',
            proofs: [],
          },
        }),
        currentProdRow({ id: 'd', seq: 1, status: 'hidden', body: null }),
      ],
      error: null,
    });
    const page = await fetchRecentChatMessages('c1', 50);
    expect(page).toHaveLength(4);
    expect(page.every((m) => m.likeCount === 0)).toBe(true);
    expect(page.every((m) => !m.likedByMe)).toBe(true);
    expect(page.every((m) => m.replyPreview === null)).toBe(true);
    expect(page.every((m) => m.replyToMessageId === null)).toBe(true);
    expect(page.map((m) => m.senderType)).toEqual([
      'participant',
      'game_master',
      'training_card',
      'participant',
    ]);
  });
});

// ---------------------------------------------------------------------------
// New DB + new frontend: the additive fields do not disturb any existing field.
// ---------------------------------------------------------------------------
describe('mapChatRow — additive fields alongside a full v4 row', () => {
  it('maps a normal message with attachments AND a reply preview AND likes', () => {
    const msg = mapChatRow(
      rowFixture({
        seq: 30,
        body: 'Det gör det visst.',
        attachments: [{ position: 1, path: 'c1/u1/m/1-a.jpg' }],
        like_count: 2,
        liked_by_me: true,
        reply_preview: {
          message_id: 'parent',
          kind: 'text',
          text: 'Golf räknas inte',
          has_image: false,
          training: null,
        },
      }),
    );
    // unchanged fields
    expect(msg.seq).toBe(30);
    expect(msg.body).toBe('Det gör det visst.');
    expect(msg.senderDisplayName).toBe('Pia');
    expect(msg.status).toBe('active');
    expect(msg.attachments).toEqual([{ position: 1, path: 'c1/u1/m/1-a.jpg' }]);
    expect(msg.trainingCard).toBeNull();
    // additive fields
    expect(msg.likeCount).toBe(2);
    expect(msg.likedByMe).toBe(true);
    expect(msg.replyPreview?.text).toBe('Golf räknas inte');
    expect(msg.replyToMessageId).toBe('parent');
  });

  it('maps a training_card row that also carries likes — the two stay separate', () => {
    const msg = mapChatRow(
      rowFixture({
        sender_type: 'training_card',
        body: null,
        like_count: 5,
        liked_by_me: false,
        reply_preview: null,
        training_card: {
          entry_id: 'ent-2',
          activity: 'Simning',
          duration_minutes: 50,
          note: 'skönt',
          challenge_date: '2026-09-06',
          entry_status: 'active',
          trained_at: '2026-09-06T18:00:00Z',
          proofs: [],
        },
      }),
    );
    expect(msg.trainingCard?.activity).toBe('Simning');
    expect(msg.trainingCard?.note).toBe('skönt');
    expect(msg.likeCount).toBe(5);
    expect(msg.likedByMe).toBe(false);
    expect(msg.replyPreview).toBeNull();
  });
});

describe('sendChatMessage — reply threading', () => {
  it('a text-only NON-reply sends the exact old 2-key call (no p_reply_to_message_id)', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({ challengeId: 'c1', userId: 'u1', body: 'hej' });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_body',
      'p_challenge_id',
    ]);
    expect('p_reply_to_message_id' in (args as object)).toBe(false);
  });

  it('a text-only reply adds p_reply_to_message_id', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'Det gör det visst.',
      replyToMessageId: 'parent-1',
    });
    expect(rpc).toHaveBeenCalledWith('post_chat_message', {
      p_challenge_id: 'c1',
      p_body: 'Det gör det visst.',
      p_reply_to_message_id: 'parent-1',
    });
  });

  it('an image NON-reply sends the exact old 4-key call', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: '',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_attachments',
      'p_body',
      'p_challenge_id',
      'p_message_id',
    ]);
  });

  it('an image reply adds p_reply_to_message_id as the 5th key', async () => {
    rpc.mockResolvedValue({ data: rowFixture(), error: null });
    await sendChatMessage({
      challengeId: 'c1',
      userId: 'u1',
      body: 'kolla',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
      replyToMessageId: 'parent-2',
    });
    const [, args] = rpc.mock.calls[0]!;
    expect((args as Record<string, unknown>).p_reply_to_message_id).toBe(
      'parent-2',
    );
    expect(Object.keys(args as object)).toHaveLength(5);
  });
});

describe('setChatMessageLike', () => {
  it('calls set_chat_message_like with the message id and liked=true', async () => {
    rpc.mockResolvedValue({
      data: { liked: true, like_count: 1 },
      error: null,
    });
    await setChatMessageLike('m1', true);
    expect(rpc).toHaveBeenCalledWith('set_chat_message_like', {
      p_message_id: 'm1',
      p_liked: true,
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_liked',
      'p_message_id',
    ]);
  });

  it('calls set_chat_message_like with liked=false', async () => {
    rpc.mockResolvedValue({
      data: { liked: false, like_count: 0 },
      error: null,
    });
    await setChatMessageLike('m1', false);
    expect(rpc).toHaveBeenCalledWith('set_chat_message_like', {
      p_message_id: 'm1',
      p_liked: false,
    });
  });

  it('maps { liked, like_count } to { liked, likeCount }', async () => {
    rpc.mockResolvedValue({
      data: { liked: true, like_count: 4 },
      error: null,
    });
    expect(await setChatMessageLike('m1', true)).toEqual({
      liked: true,
      likeCount: 4,
    });
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(setChatMessageLike('m1', true)).rejects.toBeInstanceOf(
      ChatError,
    );
  });

  it('passes a Swedish RPC error message through', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Det går inte att gilla ett dolt meddelande' },
    });
    await expect(setChatMessageLike('m1', true)).rejects.toThrow(
      'Det går inte att gilla ett dolt meddelande',
    );
  });

  it('degrades a malformed response to a safe { liked:false, likeCount:0 } (no throw)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setChatMessageLike('m1', true)).toEqual({
      liked: false,
      likeCount: 0,
    });
    rpc.mockResolvedValue({
      data: { liked: 'yes', like_count: -1 },
      error: null,
    });
    expect(await setChatMessageLike('m1', true)).toEqual({
      liked: false,
      likeCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Release-compatibility: the PR #8 frontend must run against the CURRENT
// production `list_chat_messages`, which has NO `training_card` column and
// whose rows can only be sender_type 'participant' / 'game_master'. This
// models a CODE-FIRST rollout — new frontend live, old DB — so applying the
// migration is not a hard prerequisite for the deploy.
// ---------------------------------------------------------------------------
describe('backwards compatibility with the pre-PR-8 list_chat_messages shape', () => {
  /** Exactly the keys the CURRENT production RPC returns — no `training_card`. */
  function preMigrationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'old-1',
      seq: 12,
      challenge_id: 'c1',
      sender_type: 'participant',
      sender_user_id: 'u9',
      sender_display_name: 'Erik',
      body: 'hej från gamla världen',
      status: 'active',
      attachments: [],
      created_at: '2026-09-05T12:00:00Z',
      ...overrides,
    };
  }

  it('maps a pre-migration participant row with no exception and trainingCard null', () => {
    expect('training_card' in preMigrationRow()).toBe(false);
    const msg = mapChatRow(preMigrationRow());
    expect(msg.senderType).toBe('participant');
    expect(msg.body).toBe('hej från gamla världen');
    expect(msg.senderDisplayName).toBe('Erik');
    expect(msg.attachments).toEqual([]);
    expect(msg.status).toBe('active');
    expect(msg.trainingCard).toBeNull();
  });

  it('maps a pre-migration Game Master row unchanged, trainingCard null', () => {
    const msg = mapChatRow(
      preMigrationRow({
        sender_type: 'game_master',
        sender_user_id: null,
        sender_display_name: null,
        body: 'Systemet observerar.',
      }),
    );
    expect(msg.senderType).toBe('game_master');
    expect(msg.body).toBe('Systemet observerar.');
    expect(msg.trainingCard).toBeNull();
  });

  it('maps a pre-migration hidden row (withheld body) to the placeholder path', () => {
    const msg = mapChatRow(preMigrationRow({ status: 'hidden', body: null }));
    expect(msg.status).toBe('hidden');
    expect(msg.body).toBeNull();
    expect(msg.trainingCard).toBeNull();
  });

  it('fetchRecentChatMessages maps a whole pre-migration page without throwing', async () => {
    rpc.mockResolvedValue({
      data: [
        preMigrationRow({ id: 'a', seq: 3 }),
        preMigrationRow({
          id: 'b',
          seq: 2,
          sender_type: 'game_master',
          sender_user_id: null,
        }),
        preMigrationRow({ id: 'c', seq: 1, status: 'hidden', body: null }),
      ],
      error: null,
    });
    const page = await fetchRecentChatMessages('c1', 50);
    expect(page).toHaveLength(3);
    expect(page.every((m) => m.trainingCard === null)).toBe(true);
    expect(page.map((m) => m.senderType)).toEqual([
      'participant',
      'game_master',
      'participant',
    ]);
  });
});

describe('markChatRead', () => {
  it('calls the RPC with exactly the challenge id and seq', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await markChatRead('c1', 42);
    expect(rpc).toHaveBeenCalledWith('mark_chat_read', {
      p_challenge_id: 'c1',
      p_seq: 42,
    });
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(markChatRead('c1', 1)).rejects.toBeInstanceOf(ChatError);
  });
});

describe('fetchRecentChatMessages', () => {
  it('calls list_chat_messages with a null cursor and the page size', async () => {
    rpc.mockResolvedValue({ data: [rowFixture()], error: null });
    await fetchRecentChatMessages('c1', 50);
    expect(rpc).toHaveBeenCalledWith('list_chat_messages', {
      p_challenge_id: 'c1',
      p_before_seq: null,
      p_limit: 50,
    });
  });

  it('maps a withheld (hidden, non-admin) body to null', async () => {
    rpc.mockResolvedValue({
      data: [rowFixture({ status: 'hidden', body: null })],
      error: null,
    });
    const [msg] = await fetchRecentChatMessages('c1', 50);
    expect(msg!.status).toBe('hidden');
    expect(msg!.body).toBeNull();
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchRecentChatMessages('c1', 50)).rejects.toBeInstanceOf(
      ChatError,
    );
  });
});

describe('fetchOlderChatMessages', () => {
  it('passes beforeSeq as the strict upper-bound cursor', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchOlderChatMessages('c1', 100, 20);
    expect(rpc).toHaveBeenCalledWith('list_chat_messages', {
      p_challenge_id: 'c1',
      p_before_seq: 100,
      p_limit: 20,
    });
  });
});

describe('fetchUnreadCount', () => {
  it('calls unread_chat_count with just the challenge id and returns the scalar', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const count = await fetchUnreadCount('c1');
    expect(count).toBe(3);
    expect(rpc).toHaveBeenCalledWith('unread_chat_count', {
      p_challenge_id: 'c1',
    });
    const [, args] = rpc.mock.calls[0]!;
    expect(Object.keys(args as object)).toEqual(['p_challenge_id']);
  });

  it('treats a null/absent count as 0', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchUnreadCount('c1')).toBe(0);
  });

  it('rejects with ChatError on a transport failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchUnreadCount('c1')).rejects.toBeInstanceOf(ChatError);
  });
});
