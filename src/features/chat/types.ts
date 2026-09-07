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

export type ChatSenderType = 'participant' | 'game_master' | 'training_card';

export type ChatMessageStatus = 'active' | 'hidden';

/**
 * One proof image on a training card. `path` is a private object name in the
 * `proofs` bucket — useless without a signed URL. `list_chat_messages` returns
 * these only for an active card seen by a challenge member (the same
 * membership gate that already lets a member read that challenge's proof
 * objects), and withholds the whole card payload for a hidden card.
 */
export interface TrainingCardProof {
  position: number;
  path: string;
}

/**
 * The payload of a `sender_type = 'training_card'` message — an automatic
 * activity card for a real `training_entries` row. Resolved LIVE from the entry
 * by `list_chat_messages` (the entry is the source of truth), so it always
 * reflects the entry's current state, including invalidation. `null` on a
 * `ChatMessage` for every non-card message, and for a hidden card seen by a
 * non-admin.
 */
export interface TrainingCardData {
  entryId: string;
  activity: string | null;
  durationMinutes: number;
  note: string | null;
  /** The challenge-local calendar day the session belongs to (`YYYY-MM-DD`). */
  challengeDate: string;
  entryStatus: 'active' | 'invalidated';
  /** When the entry row was created (ISO). Display only. */
  trainedAt: string;
  proofs: TrainingCardProof[];
}

/**
 * One image attachment on a chat message. `path` is a private storage-object
 * name in the `chat-media` bucket — useless without a signed URL, and the
 * storage read policy (`_chat_attachment_readable`) denies one for a hidden
 * message. `list_chat_messages` returns an empty list for a hidden message
 * seen by a non-admin, so a non-admin never even receives the paths.
 */
export interface ChatAttachment {
  position: number;
  path: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  challengeId: string;
  senderType: ChatSenderType;
  /** Always set for a participant message; always null for a Game Master one. */
  senderUserId: string | null;
  /**
   * Display name of the participant sender (from `profiles`), resolved
   * server-side by `list_chat_messages` in the same query — no per-message
   * lookup. Null for a Game Master message (rendered as "GAME MASTER" instead).
   */
  senderDisplayName: string | null;
  /**
   * The message text — `null` for a moderated ("hidden") message seen by a
   * non-admin: the server withholds the original body, and the client renders
   * the fixed placeholder. Also `null`-safe defensively.
   */
  body: string | null;
  status: ChatMessageStatus;
  /**
   * Image attachments in display order (0–4). Empty for a text-only message,
   * and empty for a hidden message seen by a non-admin — the server withholds
   * the paths, exactly like `body`.
   */
  attachments: ChatAttachment[];
  /**
   * Set only for a `senderType === 'training_card'` message — the training
   * entry it represents, resolved live. `null` for every other message and for
   * a hidden card seen by a non-admin.
   */
  trainingCard: TrainingCardData | null;
  /**
   * Admin-only. Never populated for a non-admin viewer (the `list_chat_messages`
   * read surface does not project it). Kept on the type for admin tooling.
   */
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
