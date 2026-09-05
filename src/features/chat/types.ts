/**
 * Shared chat — domain types (spec: docs/superpowers/specs/2026-09-05-shared-chat-design.md).
 *
 * One shared, text-only chat room per challenge. `seq` (a Postgres
 * `generated always as identity` column) is the sole ordering / pagination /
 * read-state key — `createdAt` is display metadata only and must never be
 * compared, counted or sorted by in any correctness-relevant path. A Postgres
 * identity column's allocation order is not guaranteed to equal transaction
 * commit order under concurrency; `seq` is used because it is the single
 * deterministic total order every reader agrees on, not because it perfectly
 * reconstructs arrival order.
 */

export type ChatSenderType = 'participant' | 'game_master';

export type ChatMessageStatus = 'active' | 'hidden';

export interface ChatMessage {
  id: string;
  seq: number;
  challengeId: string;
  senderType: ChatSenderType;
  /** Always set for a participant message; always null for a Game Master one. */
  senderUserId: string | null;
  body: string;
  status: ChatMessageStatus;
  hiddenReason: string | null;
  /**
   * Set only for a Game Master message that materialises a frozen
   * `game_master_events` row. Always null for a participant message. The column
   * is added by the Game Master integration migration, not the chat schema —
   * kept in the type from day one so no shape change is needed later.
   */
  gameMasterEventId: string | null;
  /** DISPLAY ONLY — date separators, "sent at HH:MM". Never an ordering key. */
  createdAt: string;
}

export interface ChatReadState {
  challengeId: string;
  userId: string;
  lastReadSeq: number;
  lastReadMessageId: string | null;
}
