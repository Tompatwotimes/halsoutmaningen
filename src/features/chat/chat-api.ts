import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ChatMessageStatus, ChatSenderType } from './types';

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

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatError';
  }
}

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
function narrowSenderType(v: unknown): ChatSenderType {
  return v === 'game_master' ? 'game_master' : 'participant';
}
function narrowStatus(v: unknown): ChatMessageStatus {
  return v === 'hidden' ? 'hidden' : 'active';
}

export function mapChatRow(raw: Record<string, unknown>): ChatMessage {
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
    hiddenReason: jstrOrNull(raw.hidden_reason),
    gameMasterEventId: jstrOrNull(raw.game_master_event_id),
    createdAt: jstr(raw.created_at),
  };
}

// ---------------------------------------------------------------------------
// Writes (RPCs)
// ---------------------------------------------------------------------------

/**
 * Post one message. The server sets `sender_user_id` (always the caller) and
 * `sender_type` ('participant') itself — this call carries only the challenge
 * id and the body, so a client cannot impersonate another user or post as
 * Game Master.
 */
export async function postChatMessage(
  challengeId: string,
  body: string,
): Promise<ChatMessage> {
  const { data, error } = await chatRpc('post_chat_message', {
    p_challenge_id: challengeId,
    p_body: body,
  });
  if (error) {
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
