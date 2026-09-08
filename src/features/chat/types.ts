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

/** The kind of message a reply is quoting — drives how the quote chip renders. */
export type ReplyPreviewKind =
  'text' | 'image' | 'training_card' | 'game_master';

/**
 * A compact, one-level quote of the message a reply is replying to — from
 * `list_chat_messages`' `reply_preview` jsonb (migration 20260908120000).
 * Resolved LIVE from the parent's CURRENT state, so moderating the parent later
 * flips this to the tombstone automatically. Never a stored snapshot.
 *
 * `deleted === true` is the **tombstone**: the parent is hidden (or otherwise
 * withheld) from this viewer. In that state every other field is `null` /
 * `false` — the server sends only `{ "deleted": true }` and the mapper refuses
 * to read anything else — and the UI later renders the fixed
 * `HIDDEN_MESSAGE_PLACEHOLDER`. When `deleted === false` the parent is visible
 * and the descriptive fields are populated.
 *
 * There is deliberately NO storage path, signed URL, attachment list, full
 * note, proof reference or Game Master internal here: an image parent is only
 * `hasImage: true`; a training-card parent is only `training.activity` +
 * `training.durationMinutes`. Identity is left neutral — the viewer-relative
 * "Du" is applied later, in rendering, never baked in here.
 */
export interface ReplyPreview {
  deleted: boolean;
  /** The parent message id — `null` on the tombstone (withheld from the viewer). */
  messageId: string | null;
  seq: number | null;
  senderType: ChatSenderType | null;
  senderUserId: string | null;
  senderDisplayName: string | null;
  kind: ReplyPreviewKind | null;
  /** ≤ 140 chars, already truncated server-side. `null` for an image-only / card / tombstone parent. */
  text: string | null;
  hasImage: boolean;
  training: { activity: string | null; durationMinutes: number } | null;
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
  /**
   * The message this one is replying to, or `null` for a normal message.
   * Derived from `replyPreview`: for a visible parent it is
   * `replyPreview.messageId`; for the tombstone (hidden parent) it is `null` —
   * the server withholds the parent id from an ordinary viewer, and
   * `list_chat_messages` exposes no raw `reply_to_message_id` column.
   */
  replyToMessageId: string | null;
  /**
   * A compact quote of the parent when this message is a reply, else `null`.
   * See {@link ReplyPreview} — `deleted === true` is the hidden-parent
   * tombstone. `null` for a normal message, a pre-migration row, or a
   * physically-deleted parent (FK SET NULL).
   */
  replyPreview: ReplyPreview | null;
  /**
   * Number of hearts on this message. `0` when there are none, when the server
   * withholds reaction metadata (a hidden message seen by a non-admin), and for
   * a pre-migration `list_chat_messages` row with no `like_count` key. Always a
   * non-negative integer — normalised once, here at the adapter boundary, so no
   * caller needs `message.likeCount ?? 0`.
   */
  likeCount: number;
  /**
   * Whether the current viewer has hearted this message. `false` when they have
   * not, when the server withholds it, and for a pre-migration row.
   */
  likedByMe: boolean;
  /** DISPLAY ONLY — date separators, "sent at HH:MM". Never an ordering key. */
  createdAt: string;
}

export interface ChatReadState {
  challengeId: string;
  userId: string;
  lastReadSeq: number;
  lastReadMessageId: string | null;
}
