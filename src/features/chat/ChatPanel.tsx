import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import {
  CloseIcon,
  HeartFilledIcon,
  ImageIcon,
  ReplyIcon,
} from '@/components/icons';
import { probeImage } from '@/features/challenge/heic';
import type { UploadPhase } from '@/lib/media/image-processing';
import { ChatImageGrid } from './ChatImageGrid';
import { TrainingCard } from './TrainingCard';
import { LikeBadge } from './LikeBadge';
import { MessageActions } from './MessageActions';
import { ReplyQuote } from './ReplyQuote';
import { useMessageGestures } from './useMessageGestures';
import { CHAT_IMAGE_MAX_COUNT } from './chat-media';
import { formatLongDate } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import {
  CHAT_BODY_MAX_LENGTH,
  HIDDEN_REPLY_TARGET_MESSAGE,
  REPLY_JUMP_MAX_PAGES,
  REPLY_SWIPE_ARM_PX,
  chatDateSeparatorKey,
  displayBody,
  findLoadedSeq,
  isInteractiveEventTarget,
  isNearBottom,
  isUserScrollUp,
  scrollAnchorAdjustment,
  swedishPossessive,
} from './chat';
import { deriveReplyTarget, type ReplyTarget } from './replyPreview';
import { ChatError } from './chat-error';
import {
  useChatMessages,
  useMarkChatRead,
  usePostChatMessage,
  useSetChatMessageLike,
} from './useChat';
import type { ChatMessage } from './types';
import styles from './ChatPanel.module.css';

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  challengeId: string;
  userId: string;
  timeZone: string;
  isAdmin: boolean;
  /** Rendered under a participant message when the viewer is an admin (Task 9). */
  renderModeration?: (message: ChatMessage) => ReactNode;
  /**
   * Optional notification that a viewer started a reply to `message` (via the
   * "Svara" action or a right-swipe). The reply composer itself is fully
   * self-contained in this component now (Task G) — this seam only exists for
   * a host that wants to observe the intent; production leaves it unset.
   */
  onReplyToMessage?: (message: ChatMessage) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function separatorLabel(dayKey: string): string {
  return `${capitalize(weekdayLong(dayKey))} ${formatLongDate(dayKey)}`;
}

export function ChatPanel({
  open,
  onClose,
  challengeId,
  userId,
  timeZone,
  isAdmin,
  renderModeration,
  onReplyToMessage,
}: ChatPanelProps) {
  const query = useChatMessages(open ? challengeId : null);
  const { mutate: markRead } = useMarkChatRead();
  const post = usePostChatMessage();
  const { setLike, isPending: isLikePending } = useSetChatMessageLike(
    open ? challengeId : null,
  );
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [composePhase, setComposePhase] = useState<UploadPhase | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Object URLs for the pending-image previews, created and revoked with `files`.
  const previewUrls = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );
  useEffect(
    () => () => previewUrls.forEach((u) => URL.revokeObjectURL(u)),
    [previewUrls],
  );

  // --- scroll positioning (B1) --------------------------------------------
  // `scrollRef` is the scroll container (the Sheet body); `listRef` is the
  // content inside it, observed for size changes.
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Have we performed the very first "open at the newest message" pin yet?
  const hasPinnedOnce = useRef(false);
  // `true` once the user has deliberately scrolled UP to read history in THIS
  // open session — the only thing that stops the panel following the newest
  // message. Reset to `false` on every open, and re-armed (→ `false`) when the
  // user scrolls back to the bottom. It is set ONLY from a real downward
  // `scrollTop` move (`isUserScrollUp`) — a programmatic pin only ever holds or
  // increases `scrollTop`, so it can never spuriously flip this, which is the
  // core of the "chat still opens above the latest message" fix.
  const userAway = useRef(false);
  // Last `scrollTop` we observed, to measure the direction of the next move.
  const lastScrollTop = useRef(0);
  // Set right before an older page is fetched; consumed once it has rendered.
  const pendingAnchorHeight = useRef<number | null>(null);
  // Newest seq we have already reacted to (scrolled to / announced).
  const reactedMaxSeq = useRef(0);
  // Newest seq the read cursor has been advanced to (never regresses).
  const markedSeq = useRef(0);
  const [showNewMessages, setShowNewMessages] = useState(false);

  // Live copies of the query fields the scroll listener reads, so the listener
  // effect does not re-bind (add/removeEventListener) on every render — the
  // whole `query` object is a fresh reference each render.
  const scrollQueryRef = useRef<{
    maxSeq: number;
    hasNextPage: boolean | undefined;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  }>({
    maxSeq: 0,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => Promise.resolve(),
  });

  // --- jump-to-original from a reply quote (design §5.6) ------------------
  // The seq currently outlined by a jump (cleared after ~1.2 s), a one-line
  // "not in history" notice, and the in-progress jump request. `jumpTick`
  // re-runs the driver effect after each bounded `fetchNextPage`.
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const jumpRequest = useRef<{
    seq: number;
    pagesFetched: number;
    fetching: boolean;
  } | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  // Pin the viewport to the newest message. `scrollTop = scrollHeight` is
  // clamped by the browser to `scrollHeight - clientHeight` (the real max);
  // record where it actually landed so the next scroll event measures
  // direction from there.
  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
  }, []);

  const messages = query.messages;
  const maxSeq =
    messages.length > 0 ? (messages[messages.length - 1]?.seq ?? 0) : 0;

  scrollQueryRef.current = {
    maxSeq,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };

  const advanceRead = useCallback(
    (seq: number) => {
      if (seq > markedSeq.current) {
        markedSeq.current = seq;
        markRead({ challengeId, seq });
      }
    },
    [markRead, challengeId],
  );

  // Reset all positioning state when the room changes or the panel is
  // (re)opened. A layout effect declared BEFORE the orchestration layout effect
  // below, so on a cached reopen (`messages` already populated, no `isLoading`
  // transition) it runs first, then the orchestration pin sets
  // `hasPinnedOnce = true` and that sticks.
  useLayoutEffect(() => {
    hasPinnedOnce.current = false;
    userAway.current = false;
    lastScrollTop.current = 0;
    pendingAnchorHeight.current = null;
    reactedMaxSeq.current = 0;
    markedSeq.current = 0;
    setShowNewMessages(false);
    // A reply target from a previous open / room is stale (design §5.8).
    setReplyTarget(null);
    // Any pending / lingering jump belongs to the previous room.
    jumpRequest.current = null;
    setHighlightSeq(null);
    setJumpNotice(null);
  }, [challengeId, open]);

  // Track the reader's intent from the DIRECTION of each scroll, auto-load
  // older history near the top, and dismiss the "Nya meddelanden" pill when the
  // reader returns to the bottom. A downward `scrollTop` move (`isUserScrollUp`)
  // is the only thing that sets `userAway` — a programmatic pin never moves
  // `scrollTop` down, so this needs no "was that us?" heuristic. Depends only on
  // stable values, so it binds the listener once per open, not per render.
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const onScroll = () => {
      const top = el.scrollTop;
      const delta = top - lastScrollTop.current;
      lastScrollTop.current = top;
      const near = isNearBottom(el);

      if (isUserScrollUp(delta)) {
        // The reader scrolled up. If that took them away from the bottom they
        // are now reading history; if they are still near the bottom, keep
        // following.
        userAway.current = !near;
      } else if (near) {
        // At / back to the bottom → resume following, clear the pill.
        userAway.current = false;
        if (showNewMessages) {
          setShowNewMessages(false);
          advanceRead(scrollQueryRef.current.maxSeq);
        }
      }

      const q = scrollQueryRef.current;
      if (
        top < 48 &&
        q.hasNextPage &&
        !q.isFetchingNextPage &&
        pendingAnchorHeight.current === null
      ) {
        pendingAnchorHeight.current = el.scrollHeight;
        void q.fetchNextPage();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, showNewMessages, advanceRead]);

  // Re-assert the bottom pin whenever the visible geometry changes while the
  // reader has not scrolled away — media finishing load, the Sheet settling,
  // reply quotes / action rows / a web font landing a frame late, or the
  // viewport itself resizing (keyboard, dvh). Observes BOTH the content list
  // (scrollHeight side) and the scroll container (clientHeight side) so a
  // change to either half of `maxScroll = scrollHeight - clientHeight` is
  // caught.
  useEffect(() => {
    const list = listRef.current;
    const body = scrollRef.current;
    if (!open || !list || !body || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => {
      if (
        !hasPinnedOnce.current ||
        userAway.current ||
        pendingAnchorHeight.current !== null
      ) {
        return;
      }
      pinToBottom();
    });
    ro.observe(list);
    ro.observe(body);
    return () => ro.disconnect();
  }, [open, challengeId, pinToBottom]);

  // The single scroll orchestration point. Runs before paint so the viewport
  // never visibly jumps.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!open || query.isLoading || messages.length === 0 || !el) return;

    // (a) an older page was just prepended — keep the same message in view.
    if (pendingAnchorHeight.current !== null) {
      el.scrollTop += scrollAnchorAdjustment(
        pendingAnchorHeight.current,
        el.scrollHeight,
      );
      lastScrollTop.current = el.scrollTop;
      pendingAnchorHeight.current = null;
      if (maxSeq > reactedMaxSeq.current) reactedMaxSeq.current = maxSeq;
      return;
    }

    // (b) first render with content — open pinned to the newest message. The
    // ResizeObserver above keeps it pinned as media/layout settle.
    if (!hasPinnedOnce.current) {
      pinToBottom();
      hasPinnedOnce.current = true;
      userAway.current = false;
      reactedMaxSeq.current = maxSeq;
      advanceRead(maxSeq);
      return;
    }

    // (c) a newer message arrived.
    if (maxSeq > reactedMaxSeq.current) {
      const newest = messages[messages.length - 1];
      const isOwnMessage = newest?.senderUserId === userId;
      if (!userAway.current || isOwnMessage) {
        pinToBottom();
        userAway.current = false;
        setShowNewMessages(false);
        advanceRead(maxSeq);
      } else {
        setShowNewMessages(true);
      }
      reactedMaxSeq.current = maxSeq;
    }
  }, [
    open,
    query.isLoading,
    messages,
    maxSeq,
    userId,
    advanceRead,
    pinToBottom,
  ]);

  const rows = useMemo(() => {
    const out: (
      | { kind: 'separator'; key: string; label: string }
      | { kind: 'message'; message: ChatMessage }
    )[] = [];
    let prevDay: string | null = null;
    for (const message of messages) {
      const day = chatDateSeparatorKey(message.createdAt, timeZone);
      if (day !== prevDay) {
        out.push({
          kind: 'separator',
          key: `sep-${day}`,
          label: separatorLabel(day),
        });
        prevDay = day;
      }
      out.push({ kind: 'message', message });
    }
    return out;
  }, [messages, timeZone]);

  const canSend =
    (draft.trim().length > 0 || files.length > 0) &&
    draft.length <= CHAT_BODY_MAX_LENGTH &&
    !post.isPending;

  function send() {
    if (!canSend) return;
    const replyToMessageId = replyTarget?.messageId;
    post.mutate(
      {
        challengeId,
        userId,
        body: draft,
        files,
        onPhase: setComposePhase,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
      {
        onSuccess: () => {
          // Success clears everything (design §5.8 / §18.2).
          setDraft('');
          setFiles([]);
          setImageError(null);
          setReplyTarget(null);
        },
        onError: (error: unknown) => {
          // Failure keeps the draft, attachments AND reply target so the user
          // retries losing nothing — except when the target itself became
          // hidden, where reply mode is dropped (draft still kept) (§5.8).
          if (
            error instanceof Error &&
            error.message === HIDDEN_REPLY_TARGET_MESSAGE
          ) {
            setReplyTarget(null);
          }
        },
        onSettled: () => {
          setComposePhase(null);
        },
      },
    );
  }

  async function addImages(picked: FileList | null) {
    setImageError(null);
    if (!picked || picked.length === 0) return;
    const next = [...files];
    for (const file of Array.from(picked)) {
      if (next.length >= CHAT_IMAGE_MAX_COUNT) {
        setImageError('Högst fyra bilder per meddelande.');
        break;
      }
      const probe = await probeImage(file);
      if (!probe.decodable) {
        setImageError('En av bilderna kunde inte läsas och hoppades över.');
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function removeImageAt(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    setImageError(null);
  }

  const handleReply = useCallback(
    (message: ChatMessage) => {
      // One reply-target state — the "Svara" action row and the swipe gesture
      // both converge here (design §5.9). The external seam still fires.
      setReplyTarget(deriveReplyTarget(message, userId));
      onReplyToMessage?.(message);
    },
    [onReplyToMessage, userId],
  );

  // Tap a reply quote → bring its original into view (design §5.6). Cheap
  // request-setter; the driver effect below does the bounded work.
  const jumpToMessage = useCallback((seq: number) => {
    jumpRequest.current = { seq, pagesFetched: 0, fetching: false };
    setHighlightSeq(null);
    setJumpNotice(null);
    setJumpTick((n) => n + 1);
  }, []);

  // Jump driver: scroll to the target if it is loaded (+ brief highlight).
  // Jumping to an older message is a move UP, so the scroll listener records it
  // as "reading history" (`userAway`) — which is correct: after a jump the
  // panel must not yank the reader back to the bottom. Otherwise page upward
  // through the EXISTING `fetchNextPage` mechanism, at most
  // `REPLY_JUMP_MAX_PAGES` times, re-checking after each page. If the target
  // never appears, show a one-line notice and stop — no unbounded loop.
  useEffect(() => {
    const req = jumpRequest.current;
    if (!req || req.fetching) return;

    if (findLoadedSeq(messages, req.seq)) {
      jumpRequest.current = null;
      const node = listRef.current?.querySelector<HTMLElement>(
        `[data-seq="${String(req.seq)}"]`,
      );
      if (node) {
        node.scrollIntoView({ block: 'center' });
        setHighlightSeq(req.seq);
        window.setTimeout(() => {
          setHighlightSeq((s) => (s === req.seq ? null : s));
        }, 1200);
      }
      return;
    }

    if (
      req.pagesFetched >= REPLY_JUMP_MAX_PAGES ||
      !queryRef.current.hasNextPage
    ) {
      jumpRequest.current = null;
      setJumpNotice('Kunde inte hitta meddelandet i historiken.');
      return;
    }

    req.fetching = true;
    req.pagesFetched += 1;
    const el = scrollRef.current;
    if (el) pendingAnchorHeight.current = el.scrollHeight;
    void queryRef.current.fetchNextPage().finally(() => {
      if (jumpRequest.current) jumpRequest.current.fetching = false;
      setJumpTick((n) => n + 1);
    });
  }, [jumpTick, messages]);

  // Auto-dismiss the "not in history" notice after a few seconds (toast-like).
  useEffect(() => {
    if (jumpNotice === null) return;
    const t = window.setTimeout(() => setJumpNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [jumpNotice]);

  function jumpToLatest() {
    userAway.current = false;
    pinToBottom();
    setShowNewMessages(false);
    advanceRead(maxSeq);
  }

  function loadOlder() {
    const el = scrollRef.current;
    if (el) pendingAnchorHeight.current = el.scrollHeight;
    void query.fetchNextPage();
  }

  if (!open) return null;

  const composer = (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {replyTarget && (
        <div className={styles.replyStrip}>
          <div className={styles.replyStripText}>
            <span className={styles.replyStripSender}>
              Svarar på {replyTarget.senderLabel}
            </span>
            {replyTarget.line !== '' && (
              <span className={styles.replyStripLine}>{replyTarget.line}</span>
            )}
          </div>
          <button
            type="button"
            className={styles.replyStripCancel}
            onClick={() => setReplyTarget(null)}
            aria-label="Avbryt svar"
          >
            <CloseIcon />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className={styles.pickStrip} data-testid="chat-compose-images">
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className={styles.pickThumb}>
              <img src={previewUrls[i]} alt="" />
              <button
                type="button"
                onClick={() => removeImageAt(i)}
                aria-label={`Ta bort bild ${i + 1}`}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.composeRow}>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles.hiddenFile}
          tabIndex={-1}
          aria-label="Välj bilder"
          onChange={(e) => void addImages(e.target.files)}
        />
        <button
          type="button"
          className={styles.imageButton}
          onClick={() => imageInputRef.current?.click()}
          disabled={files.length >= CHAT_IMAGE_MAX_COUNT || post.isPending}
          aria-label="Lägg till bild"
        >
          <ImageIcon />
        </button>
        <textarea
          className={styles.input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Skriv ett meddelande…"
          rows={2}
          maxLength={CHAT_BODY_MAX_LENGTH + 200}
          aria-label="Skriv ett meddelande"
        />
        <Button type="submit" size="sm" disabled={!canSend}>
          {composePhase === 'processing'
            ? 'Förbereder bild…'
            : composePhase === 'uploading' || post.isPending
              ? 'Laddar upp…'
              : 'Skicka'}
        </Button>
      </div>
      {imageError && (
        <p className={styles.sendError} role="status">
          {imageError}
        </p>
      )}
      {post.isError && (
        <p className={styles.sendError} role="status">
          {/* A ChatError.message is always a Swedish, user-safe string (empty
              body / too long / rate limit / hidden reply target / offline);
              anything else falls back to the generic line. */}
          {post.error instanceof ChatError && post.error.message
            ? post.error.message
            : 'Meddelandet kunde inte skickas — försök igen.'}
        </p>
      )}
    </form>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title="Chatt"
      footer={composer}
      bodyRef={scrollRef}
    >
      <div
        ref={listRef}
        className={styles.list}
        role="log"
        aria-label="Chattmeddelanden"
      >
        {query.hasNextPage && (
          <button
            type="button"
            className={styles.loadOlder}
            onClick={loadOlder}
            disabled={query.isFetchingNextPage}
          >
            Ladda äldre meddelanden
          </button>
        )}

        {query.isLoading ? (
          <div className={styles.skeletons}>
            <Skeleton height="3rem" radius="var(--radius-md)" />
            <Skeleton height="3rem" radius="var(--radius-md)" />
            <Skeleton height="3rem" radius="var(--radius-md)" />
          </div>
        ) : query.isError ? (
          <EmptyState
            title="Chatten kunde inte laddas just nu"
            body="Försök igen om en stund."
          />
        ) : messages.length === 0 ? (
          <EmptyState
            title="Inga meddelanden än"
            body="Var först med att skriva något."
          />
        ) : (
          rows.map((entry) =>
            entry.kind === 'separator' ? (
              <p
                key={entry.key}
                className={styles.daySeparator}
                data-testid="chat-date-separator"
              >
                {entry.label}
              </p>
            ) : (
              <MessageRow
                key={entry.message.id}
                message={entry.message}
                isSelf={entry.message.senderUserId === userId}
                viewerUserId={userId}
                isJumpHighlighted={entry.message.seq === highlightSeq}
                likePending={isLikePending(entry.message.id)}
                onSetLike={setLike}
                onReply={handleReply}
                onJumpToMessage={jumpToMessage}
                renderModeration={
                  isAdmin &&
                  (entry.message.senderType === 'participant' ||
                    entry.message.senderType === 'training_card')
                    ? renderModeration
                    : undefined
                }
              />
            ),
          )
        )}

        {showNewMessages && (
          <button
            type="button"
            className={styles.newMessages}
            onClick={jumpToLatest}
          >
            Nya meddelanden <span aria-hidden="true">↓</span>
          </button>
        )}

        {jumpNotice && (
          <div className={styles.jumpNotice} role="status">
            <span>{jumpNotice}</span>
            <button
              type="button"
              onClick={() => setJumpNotice(null)}
              aria-label="Stäng"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * `React.memo` so a re-render of `ChatPanel` for an unrelated reason (a
 * keystroke in the composer, one like's optimistic patch, the jump highlight,
 * a Realtime refetch that structural-sharing collapsed to unchanged rows) does
 * NOT re-render + re-run `useMessageGestures` for all ~50 rows. Every prop is
 * identity-stable across those renders: `message` via React Query structural
 * sharing, the callbacks via `useCallback`, `likePending` / `isJumpHighlighted`
 * as plain booleans that only flip for the one affected row.
 */
const MessageRow = memo(function MessageRow({
  message,
  isSelf,
  viewerUserId,
  isJumpHighlighted,
  likePending,
  onSetLike,
  onReply,
  onJumpToMessage,
  renderModeration,
}: {
  message: ChatMessage;
  isSelf: boolean;
  viewerUserId: string;
  isJumpHighlighted: boolean;
  likePending: boolean;
  onSetLike: (vars: { messageId: string; liked: boolean }) => void;
  onReply: (message: ChatMessage) => void;
  onJumpToMessage: (seq: number) => void;
  renderModeration: ((message: ChatMessage) => ReactNode) | undefined;
}) {
  const isGameMaster = message.senderType === 'game_master';
  const isCard =
    message.senderType === 'training_card' &&
    message.status === 'active' &&
    message.trainingCard !== null;
  const text = displayBody(message);
  const senderLabel = isSelf
    ? 'Du'
    : (message.senderDisplayName ?? 'Deltagare');

  const moderation = renderModeration?.(message);

  // Social affordances only on a live chat item — never on the
  // "[Borttaget av administratör]" placeholder (design §7.1).
  const showSocial = message.status === 'active';
  const badgeSubject = isCard ? 'passet' : 'meddelandet';
  const likeLabel = message.likedByMe
    ? 'Ta bort gilla-markering'
    : `Gilla ${badgeSubject}`;
  const replyNoun = isCard ? 'pass' : 'meddelande';
  const replyName = isGameMaster
    ? 'Game Master'
    : (message.senderDisplayName ?? 'deltagaren');
  const replyLabel = isSelf
    ? `Svara på ditt ${replyNoun}`
    : `Svara på ${swedishPossessive(replyName)} ${replyNoun}`;

  const toggleLike = useCallback(() => {
    onSetLike({ messageId: message.id, liked: !message.likedByMe });
  }, [onSetLike, message.id, message.likedByMe]);

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      // Double-click LIKES — it never unlikes, and never fires from an
      // interactive child (image, badge, action / moderation button).
      if (message.likedByMe || likePending) return;
      if (isInteractiveEventTarget(event.target)) return;
      onSetLike({ messageId: message.id, liked: true });
    },
    [message.likedByMe, message.id, likePending, onSetLike],
  );

  const handleReply = useCallback(() => onReply(message), [onReply, message]);

  // Touch/pen gestures (design §6): swipe-right → reply, double-tap → like.
  // Mouse keeps the desktop onDoubleClick above; the hook is inert for it.
  const lightboxCloseRef = useRef<(() => void) | null>(null);
  const gestures = useMessageGestures({
    enabled: showSocial,
    likedByMe: message.likedByMe,
    likePending,
    onArmReply: handleReply,
    onDoubleTapLike: () => onSetLike({ messageId: message.id, liked: true }),
    onCloseLightbox: () => lightboxCloseRef.current?.(),
  });

  const wrapperStyle: CSSProperties = {
    transform:
      gestures.swipeDx > 0 ? `translateX(${gestures.swipeDx}px)` : undefined,
    transition: gestures.dragging ? 'none' : undefined,
  };

  const overlay = showSocial ? (
    <>
      <span
        className={styles.replyReveal}
        data-armed={gestures.armed || undefined}
        aria-hidden="true"
        style={{
          opacity:
            gestures.swipeDx > 8
              ? Math.min(1, gestures.swipeDx / REPLY_SWIPE_ARM_PX)
              : 0,
        }}
      >
        <ReplyIcon />
      </span>
      {gestures.popping && (
        <span className={styles.heartPop} aria-hidden="true">
          <HeartFilledIcon />
        </span>
      )}
    </>
  ) : null;

  const social = showSocial ? (
    <>
      <MessageActions
        likedByMe={message.likedByMe}
        likeLabel={likeLabel}
        replyLabel={replyLabel}
        likeDisabled={likePending}
        onLike={toggleLike}
        onReply={handleReply}
      />
      <LikeBadge
        likeCount={message.likeCount}
        likedByMe={message.likedByMe}
        subject={badgeSubject}
        onToggle={toggleLike}
        disabled={likePending}
      />
    </>
  ) : null;

  // An active training card renders its own self-contained layout (its own
  // header + time), not a normal bubble. A hidden card falls through to the
  // standard render: sender label + the "[Borttaget av administratör]"
  // placeholder, exactly like a hidden participant message.
  if (isCard && message.trainingCard !== null) {
    return (
      <div
        className={[styles.message, isSelf && styles.self]
          .filter(Boolean)
          .join(' ')}
        data-seq={message.seq}
        data-jump-highlight={isJumpHighlighted || undefined}
        style={wrapperStyle}
        onDoubleClick={handleDoubleClick}
        {...gestures.handlers}
      >
        {overlay}
        <TrainingCard
          card={message.trainingCard}
          senderName={senderLabel}
          time={formatTime(message.createdAt)}
        />
        {social}
        {moderation}
      </div>
    );
  }

  return (
    <div
      className={[
        styles.message,
        isSelf && styles.self,
        isGameMaster && styles.gm,
      ]
        .filter(Boolean)
        .join(' ')}
      data-seq={message.seq}
      data-jump-highlight={isJumpHighlighted || undefined}
      style={wrapperStyle}
      onDoubleClick={handleDoubleClick}
      {...gestures.handlers}
    >
      {overlay}
      <div className={styles.messageHead}>
        {isGameMaster ? (
          <Badge tone="neutral" size="sm">
            GAME MASTER
          </Badge>
        ) : (
          <span className={styles.sender}>{senderLabel}</span>
        )}
        <time className={styles.time}>{formatTime(message.createdAt)}</time>
      </div>
      {message.replyPreview !== null && (
        <ReplyQuote
          preview={message.replyPreview}
          viewerUserId={viewerUserId}
          onJump={onJumpToMessage}
        />
      )}
      {text !== null && (
        <p className={styles.body} data-testid="chat-message-body">
          {text}
        </p>
      )}
      {message.attachments.length > 0 && (
        <ChatImageGrid
          messageId={message.id}
          attachments={message.attachments}
          registerLightboxClose={(fn) => {
            lightboxCloseRef.current = fn;
          }}
        />
      )}
      {social}
      {moderation}
    </div>
  );
});
