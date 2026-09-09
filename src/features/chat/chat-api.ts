import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  ChatAttachment,
  ChatMessage,
  ChatMessageStatus,
  ChatSenderType,
  ReplyPreview,
  ReplyPreviewKind,
  TrainingCardData,
} from './types';
import {
  newChatMessageId,
  removeChatImages,
  uploadChatImages,
} from './chat-media';
import type { UploadPhaseCallback } from '@/lib/media/image-processing';
import { ChatError } from './chat-error';

/**
 * Shared chat — Supabase adapter boundary.
 *
 * Same deliberately-untyped boundary as `game-master-api.ts`: `chat_messages`
 * and the chat RPCs are absent from the generated `Database` type until this
 * plan's migrations are applied and `npm run db:types` is re-run. Until then
 * every result is narrowed to `ChatMessage` here.
 *
 * **All reads and writes go through RPCs.** Ordinary members have NO direct
 * SELECT on `public.chat_messages` (admin-only since migration
 * `20260905140200_chat_safe_read.sql`, PR #3 finding I-1). `list_chat_messages`
 * / `unread_chat_count` are the members' read surface — they withhold the body
 * and moderation trail of a hidden message server-side, so a moderated
 * message's original text can never reach a non-admin client through PostgREST
 * or Realtime. `seq` is the only ordering / pagination / cursor key;
 * `created_at` is display grouping only.
 */

// TODO(chat-types): remove the cast once the chat migrations are applied and
// `npm run db:types` has run (see the plan's rollout section).
const chatdb = supabase as unknown as SupabaseClient;

// Re-exported so existing importers (`import { ChatError } from './chat-api'`)
// keep working; the class now lives in ./chat-error to avoid an import cycle
// with ./chat-media.
export { ChatError };

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

async function chatRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const res = (await chatdb.rpc(fn, args)) as unknown as RpcResult;
  return { data: res.data, error: res.error };
}

// ---------------------------------------------------------------------------
// Narrowing (pattern mirrors retroactive-api.ts / game-master-api.ts)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function jstr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function jstrOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function jnum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
/** A non-negative integer count, else 0. Never coerces a numeric string. */
function jcount(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}
/** Strict boolean — only the literal `true` is true. Never `Boolean("false")`. */
function jbool(v: unknown): boolean {
  return v === true;
}
function narrowSenderType(v: unknown): ChatSenderType {
  if (v === 'game_master') return 'game_master';
  if (v === 'training_card') return 'training_card';
  return 'participant';
}
/** Like `narrowSenderType` but fails closed to `null` for an unknown value. */
function narrowSenderTypeOrNull(v: unknown): ChatSenderType | null {
  return v === 'participant' || v === 'game_master' || v === 'training_card'
    ? v
    : null;
}
function narrowStatus(v: unknown): ChatMessageStatus {
  return v === 'hidden' ? 'hidden' : 'active';
}
function narrowTrainingCard(v: unknown): TrainingCardData | null {
  const r = asRecord(v);
  const entryId = jstrOrNull(r.entry_id);
  if (entryId === null) return null;
  return {
    entryId,
    activity: jstrOrNull(r.activity),
    durationMinutes: jnum(r.duration_minutes),
    note: jstrOrNull(r.note),
    challengeDate: jstr(r.challenge_date),
    entryStatus: r.entry_status === 'invalidated' ? 'invalidated' : 'active',
    trainedAt: jstr(r.trained_at),
    proofs: asArray(r.proofs)
      .map((raw): { position: number; path: string } | null => {
        const p = asRecord(raw);
        const path = jstrOrNull(p.path);
        const position = jnum(p.position);
        return path && position > 0 ? { position, path } : null;
      })
      .filter((p): p is { position: number; path: string } => p !== null)
      .sort((a, b) => a.position - b.position),
  };
}
function narrowAttachments(v: unknown): ChatAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw): ChatAttachment | null => {
      const r = asRecord(raw);
      const path = jstrOrNull(r.path);
      const position = jnum(r.position);
      return path && position > 0 ? { position, path } : null;
    })
    .filter((a): a is ChatAttachment => a !== null)
    .sort((a, b) => a.position - b.position);
}

const REPLY_PREVIEW_KINDS: readonly ReplyPreviewKind[] = [
  'text',
  'image',
  'training_card',
  'game_master',
];
function narrowReplyPreviewKind(v: unknown): ReplyPreviewKind | null {
  return typeof v === 'string' &&
    (REPLY_PREVIEW_KINDS as readonly string[]).includes(v)
    ? (v as ReplyPreviewKind)
    : null;
}
function narrowReplyPreviewTraining(
  v: unknown,
): { activity: string | null; durationMinutes: number } | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  // `activity` + `duration_minutes` are the ONLY fields the server sends — a
  // note, proof path, storage_path or status is never read off this object.
  return {
    activity: jstrOrNull(r.activity),
    durationMinutes: jcount(r.duration_minutes),
  };
}

const REPLY_PREVIEW_TOMBSTONE: ReplyPreview = {
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
};

/**
 * Narrow a `list_chat_messages` `reply_preview` jsonb value to a `ReplyPreview`.
 *
 *  - `null` / `undefined` / a non-object scalar / an array   → `null` (not a
 *      reply, a pre-migration row, or malformed — degrade to "no quote")
 *  - `{ deleted: true }`                                     → the **tombstone**
 *      (a fixed, fully-withheld object). NOTHING is read from the raw payload,
 *      so a hidden parent can never leak a field through here even if the
 *      server wrongly included one.
 *  - otherwise                                               → the visible
 *      quote. It must at least carry a `message_id`; without one it is
 *      malformed → `null` (the reply renders as a plain message). Every field
 *      is narrowed defensively; a malformed nested `training` degrades to
 *      `null`. Never throws.
 */
export function narrowReplyPreview(v: unknown): ReplyPreview | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;

  if (r.deleted === true) return { ...REPLY_PREVIEW_TOMBSTONE };

  const messageId = jstrOrNull(r.message_id);
  if (messageId === null) return null;

  return {
    deleted: false,
    messageId,
    seq: typeof r.seq === 'number' && Number.isFinite(r.seq) ? r.seq : null,
    senderType: narrowSenderTypeOrNull(r.sender_type),
    senderUserId: jstrOrNull(r.sender_user_id),
    senderDisplayName: jstrOrNull(r.sender_display_name),
    kind: narrowReplyPreviewKind(r.kind),
    text: jstrOrNull(r.text),
    hasImage: r.has_image === true,
    training: narrowReplyPreviewTraining(r.training),
  };
}

export function mapChatRow(raw: Record<string, unknown>): ChatMessage {
  const replyPreview = narrowReplyPreview(raw.reply_preview);
  return {
    id: jstr(raw.id),
    seq: jnum(raw.seq),
    challengeId: jstr(raw.challenge_id),
    senderType: narrowSenderType(raw.sender_type),
    senderUserId: jstrOrNull(raw.sender_user_id),
    senderDisplayName: jstrOrNull(raw.sender_display_name),
    // `body` is null for a hidden message seen by a non-admin — the server
    // withholds it; `displayBody` renders the placeholder regardless.
    body: jstrOrNull(raw.body),
    status: narrowStatus(raw.status),
    attachments: narrowAttachments(raw.attachments),
    trainingCard: narrowTrainingCard(raw.training_card),
    hiddenReason: jstrOrNull(raw.hidden_reason),
    gameMasterEventId: jstrOrNull(raw.game_master_event_id),
    // The only parent reference a client gets is inside the access-gated
    // preview (`list_chat_messages` exposes no raw reply_to_message_id column):
    // null for a normal message and for the tombstone (parent id withheld).
    replyToMessageId: replyPreview?.messageId ?? null,
    replyPreview,
    // Reaction metadata, gated server-side (0 / false for a hidden row seen by
    // a non-admin, absent on a pre-migration row) — normalised once here.
    likeCount: jcount(raw.like_count),
    likedByMe: jbool(raw.liked_by_me),
    createdAt: jstr(raw.created_at),
  };
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

export interface SendChatMessageInput {
  challengeId: string;
  /** Required to build the `chat-media` upload path when there are images. */
  userId: string;
  /** Trimmed text, or empty when the message is image-only. */
  body: string;
  /** 0–4 already-picked image files. */
  files?: File[];
  /** Composer progress: `'processing'` (compressing) then `'uploading'`. */
  onPhase?: UploadPhaseCallback;
  /**
   * When this message is a reply, the id of the message it replies to. Passed
   * to `post_chat_message` as `p_reply_to_message_id` **only when set** — a
   * normal message still sends the exact old 2-key / 4-key call shape, which
   * matters for the NEW-frontend + OLD-DB verification window (design §22.2).
   */
  replyToMessageId?: string;
}

/**
 * Post one message, with 0–4 images, atomically.
 *
 * The server sets `sender_user_id` (always the caller) and `sender_type`
 * ('participant') itself. When there are images the client generates the
 * message id, uploads the files to `chat-media/{challenge}/{uid}/{id}/…`, then
 * `post_chat_message` inserts the message row and its attachment rows in one
 * transaction. If that RPC fails the uploaded objects are removed.
 */
export async function sendChatMessage(
  input: SendChatMessageInput,
): Promise<ChatMessage> {
  const body = input.body.trim();
  const files = input.files ?? [];
  const replyTo = input.replyToMessageId;

  if (body.length === 0 && files.length === 0) {
    throw new ChatError('Meddelandet kan inte vara tomt.');
  }
  if (files.length > 4) {
    throw new ChatError('Högst fyra bilder per meddelande.');
  }

  if (files.length === 0) {
    const args: Record<string, unknown> = {
      p_challenge_id: input.challengeId,
      p_body: body.length > 0 ? body : null,
    };
    if (replyTo !== undefined) args.p_reply_to_message_id = replyTo;
    const { data, error } = await chatRpc('post_chat_message', args);
    if (error) throw new ChatError(chatMessageError(error.message));
    return mapChatRow(asRecord(data));
  }

  const messageId = newChatMessageId();
  const prepared = await uploadChatImages(
    input.challengeId,
    input.userId,
    messageId,
    files,
    input.onPhase,
  );

  const args: Record<string, unknown> = {
    p_challenge_id: input.challengeId,
    p_body: body.length > 0 ? body : null,
    p_message_id: messageId,
    p_attachments: prepared,
  };
  if (replyTo !== undefined) args.p_reply_to_message_id = replyTo;
  const { data, error } = await chatRpc('post_chat_message', args);
  if (error) {
    await removeChatImages(prepared.map((p) => p.path));
    throw new ChatError(chatMessageError(error.message));
  }
  return mapChatRow(asRecord(data));
}

/** Advance the caller's read cursor. Best-effort — the server never regresses it. */
export async function markChatRead(
  challengeId: string,
  seq: number,
): Promise<void> {
  const { error } = await chatRpc('mark_chat_read', {
    p_challenge_id: challengeId,
    p_seq: seq,
  });
  if (error) {
    throw new ChatError('Läspositionen kunde inte sparas.');
  }
}

/** Camel-cased committed state from `set_chat_message_like` — no snake_case past here. */
export interface SetChatMessageLikeResult {
  liked: boolean;
  likeCount: number;
}

/**
 * Set the calling participant's heart on a message to an explicit state
 * (design §10.2 — idempotent, retry-safe: `liked === true` guarantees the like
 * exists, `liked === false` guarantees it is gone; repeating a call is a
 * no-op). The server derives identity from `auth.uid()` and does every
 * authorization check (active membership, target visible, status='active'); this
 * wrapper only marshals the call and narrows the `{ liked, like_count }` reply.
 *
 * Optimistic cache handling belongs to the hook layer (Task D), not here. A
 * transport failure throws `ChatError` (the RPC already speaks Swedish); a
 * malformed reply degrades to `{ liked: false, likeCount: 0 }` — the next
 * `list_chat_messages` refetch reconciles — matching `fetchUnreadCount`'s
 * "null → 0" convention.
 */
export async function setChatMessageLike(
  messageId: string,
  liked: boolean,
): Promise<SetChatMessageLikeResult> {
  const { data, error } = await chatRpc('set_chat_message_like', {
    p_message_id: messageId,
    p_liked: liked,
  });
  if (error) {
    throw new ChatError(chatMessageError(error.message));
  }
  const r = asRecord(data);
  return { liked: jbool(r.liked), likeCount: jcount(r.like_count) };
}

function chatMessageError(serverMessage: string): string {
  if (
    !serverMessage ||
    /fetch failed|Failed to fetch|NetworkError/i.test(serverMessage)
  ) {
    return 'Meddelandet kunde inte skickas. Kontrollera uppkopplingen.';
  }
  // The RPC already speaks Swedish (empty body / too long / rate limit /
  // not-a-member) — pass it through.
  return serverMessage;
}

// ---------------------------------------------------------------------------
// Reads (SECURITY DEFINER RPCs, seq-ordered, moderated content withheld)
// ---------------------------------------------------------------------------

/** The newest page of messages, `seq` descending (via `list_chat_messages`). */
export async function fetchRecentChatMessages(
  challengeId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const { data, error } = await chatRpc('list_chat_messages', {
    p_challenge_id: challengeId,
    p_before_seq: null,
    p_limit: limit,
  });
  if (error) {
    throw new ChatError('Meddelandena kunde inte hämtas.');
  }
  return asArray(data).map((r) => mapChatRow(asRecord(r)));
}

/** The page immediately before `beforeSeq`, `seq` descending (upward scroll). */
export async function fetchOlderChatMessages(
  challengeId: string,
  beforeSeq: number,
  limit = 50,
): Promise<ChatMessage[]> {
  const { data, error } = await chatRpc('list_chat_messages', {
    p_challenge_id: challengeId,
    p_before_seq: beforeSeq,
    p_limit: limit,
  });
  if (error) {
    throw new ChatError('Äldre meddelanden kunde inte hämtas.');
  }
  return asArray(data).map((r) => mapChatRow(asRecord(r)));
}

/**
 * Exact unread count (spec §3.4): messages with `seq` greater than the caller's
 * `last_read_seq`. Computed entirely server-side by `unread_chat_count` (which
 * reads the caller's own read cursor via `auth.uid()`), so the client never
 * needs a direct read of `chat_messages` or another user's `chat_read_state`.
 * A hidden message still occupies a `seq` and still counts.
 */
export async function fetchUnreadCount(challengeId: string): Promise<number> {
  const { data, error } = await chatRpc('unread_chat_count', {
    p_challenge_id: challengeId,
  });
  if (error) {
    throw new ChatError('Antal olästa kunde inte hämtas.');
  }
  return jnum(data);
}
