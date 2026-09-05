import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, ChatMessageStatus, ChatSenderType } from './types';

/**
 * Shared chat — Supabase adapter boundary.
 *
 * Same deliberately-untyped boundary as `game-master-api.ts`: `chat_messages` /
 * `chat_read_state` are absent from the generated `Database` type until this
 * plan's migrations are applied and `npm run db:types` is re-run. Until then
 * every result is narrowed to `ChatMessage` here.
 *
 * All writes go through RPCs (`post_chat_message` / `mark_chat_read` /
 * `hide_chat_message` — the last one lives in `chat-admin-api.ts`). Reads are
 * plain RLS-scoped selects. `seq` is the only ordering / pagination / cursor
 * key; `created_at` is never used for anything but display grouping.
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

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

async function chatRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<QueryResult> {
  const res = (await chatdb.rpc(fn, args)) as unknown as QueryResult;
  return { data: res.data, error: res.error };
}

const MESSAGE_COLUMNS =
  'id, seq, challenge_id, sender_type, sender_user_id, body, status, hidden_reason, created_at';

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
    body: jstr(raw.body),
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
// Reads (RLS-scoped selects, seq-ordered)
// ---------------------------------------------------------------------------

/** The newest page of messages, `seq` descending. */
export async function fetchRecentChatMessages(
  challengeId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const { data, error }: QueryResult = await chatdb
    .from('chat_messages')
    .select(MESSAGE_COLUMNS)
    .eq('challenge_id', challengeId)
    .order('seq', { ascending: false })
    .limit(limit);
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
  const { data, error }: QueryResult = await chatdb
    .from('chat_messages')
    .select(MESSAGE_COLUMNS)
    .eq('challenge_id', challengeId)
    .lt('seq', beforeSeq)
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) {
    throw new ChatError('Äldre meddelanden kunde inte hämtas.');
  }
  return asArray(data).map((r) => mapChatRow(asRecord(r)));
}

/**
 * Exact unread count (spec §3.4): messages with `seq` greater than the caller's
 * `last_read_seq`. Two round-trips — read the cursor, then count — because
 * PostgREST has no subquery. A missing read-state row means a cursor of 0.
 */
export async function fetchUnreadCount(
  challengeId: string,
  userId: string,
): Promise<number> {
  const cursorRes: QueryResult = await chatdb
    .from('chat_read_state')
    .select('last_read_seq')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (cursorRes.error) {
    throw new ChatError('Antal olästa kunde inte hämtas.');
  }
  const lastReadSeq = jnum(asRecord(cursorRes.data).last_read_seq);

  const countRes: QueryResult = await chatdb
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('challenge_id', challengeId)
    .gt('seq', lastReadSeq);
  if (countRes.error) {
    throw new ChatError('Antal olästa kunde inte hämtas.');
  }
  return jnum(countRes.count);
}
