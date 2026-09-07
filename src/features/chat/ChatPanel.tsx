import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ImageIcon, CloseIcon } from '@/components/icons';
import { probeImage } from '@/features/challenge/heic';
import type { UploadPhase } from '@/lib/media/image-processing';
import { ChatImageGrid } from './ChatImageGrid';
import { TrainingCard } from './TrainingCard';
import { CHAT_IMAGE_MAX_COUNT } from './chat-media';
import { formatLongDate } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import {
  CHAT_BODY_MAX_LENGTH,
  chatDateSeparatorKey,
  displayBody,
  isNearBottom,
  isProgrammaticScroll,
  scrollAnchorAdjustment,
} from './chat';
import {
  useChatMessages,
  useMarkChatRead,
  usePostChatMessage,
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
}: ChatPanelProps) {
  const query = useChatMessages(open ? challengeId : null);
  const { mutate: markRead } = useMarkChatRead();
  const post = usePostChatMessage();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
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
  const bottomRef = useRef<HTMLDivElement>(null);
  // Have we performed the very first "open at the newest message" pin yet?
  const hasPinnedOnce = useRef(false);
  // "Keep the viewport pinned to the newest message." Starts true on open and
  // stays true until the user deliberately scrolls up; scrolling back to the
  // bottom re-arms it. While true, asynchronous media / layout growth (images
  // finishing load, the Sheet settling) re-pins to the bottom via the
  // ResizeObserver below — so the first-open position never ends up above the
  // newest message just because a thumbnail loaded a frame late.
  const stickToBottom = useRef(true);
  // The `scrollTop` a programmatic pin/scroll is heading to. The `scroll` event
  // it produces is recognised (landed within a pixel or two) and ignored, so
  // our own scrolling never gets mistaken for the user scrolling away.
  const programmaticScrollTo = useRef<number | null>(null);
  // Set right before an older page is fetched; consumed once it has rendered.
  const pendingAnchorHeight = useRef<number | null>(null);
  // Newest seq we have already reacted to (scrolled to / announced).
  const reactedMaxSeq = useRef(0);
  // Newest seq the read cursor has been advanced to (never regresses).
  const markedSeq = useRef(0);
  const [showNewMessages, setShowNewMessages] = useState(false);

  // Pin the viewport to the bottom, recording where the resulting scroll lands
  // so the scroll listener does not read it back as a user gesture.
  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollTo.current = el.scrollHeight;
    el.scrollTop = el.scrollHeight;
  }, []);

  const messages = query.messages;
  const maxSeq =
    messages.length > 0 ? (messages[messages.length - 1]?.seq ?? 0) : 0;

  const advanceRead = useCallback(
    (seq: number) => {
      if (seq > markedSeq.current) {
        markedSeq.current = seq;
        markRead({ challengeId, seq });
      }
    },
    [markRead, challengeId],
  );

  // Reset all positioning state when the room changes or the panel is (re)opened.
  useEffect(() => {
    hasPinnedOnce.current = false;
    stickToBottom.current = true;
    programmaticScrollTo.current = null;
    pendingAnchorHeight.current = null;
    reactedMaxSeq.current = 0;
    markedSeq.current = 0;
    setShowNewMessages(false);
  }, [challengeId, open]);

  // Track user intent from the scroll position; auto-load older history near
  // the top; dismiss the "Nya meddelanden" pill once the user scrolls back
  // down. Our own programmatic pins are recognised and skipped so they never
  // clear the follow-the-bottom latch.
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const onScroll = () => {
      const expected = programmaticScrollTo.current;
      programmaticScrollTo.current = null;
      if (isProgrammaticScroll(el.scrollTop, expected)) return;

      const near = isNearBottom(el);
      stickToBottom.current = near;
      if (near && showNewMessages) {
        setShowNewMessages(false);
        advanceRead(maxSeq);
      }
      if (
        el.scrollTop < 48 &&
        query.hasNextPage &&
        !query.isFetchingNextPage &&
        pendingAnchorHeight.current === null
      ) {
        pendingAnchorHeight.current = el.scrollHeight;
        void query.fetchNextPage();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, showNewMessages, maxSeq, advanceRead, query]);

  // Re-assert the bottom pin whenever the list's size changes while the user
  // has not scrolled away — images finishing load, the Sheet settling after
  // open, font/emoji reflow. This is what makes the *first* open reliably land
  // on the newest message even though media contributes its height a frame or
  // two after the initial pin.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (
        !hasPinnedOnce.current ||
        !stickToBottom.current ||
        pendingAnchorHeight.current !== null
      ) {
        return;
      }
      pinToBottom();
    });
    ro.observe(list);
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
      pendingAnchorHeight.current = null;
      if (maxSeq > reactedMaxSeq.current) reactedMaxSeq.current = maxSeq;
      return;
    }

    // (b) first render with content — open pinned to the newest message. The
    // ResizeObserver above keeps it pinned as media/layout settle.
    if (!hasPinnedOnce.current) {
      pinToBottom();
      hasPinnedOnce.current = true;
      stickToBottom.current = true;
      reactedMaxSeq.current = maxSeq;
      advanceRead(maxSeq);
      return;
    }

    // (c) a newer message arrived.
    if (maxSeq > reactedMaxSeq.current) {
      const newest = messages[messages.length - 1];
      const isOwnMessage = newest?.senderUserId === userId;
      if (stickToBottom.current || isOwnMessage) {
        programmaticScrollTo.current = el.scrollHeight;
        bottomRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
        stickToBottom.current = true;
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
    post.mutate(
      { challengeId, userId, body: draft, files, onPhase: setComposePhase },
      {
        onSuccess: () => {
          setDraft('');
          setFiles([]);
          setImageError(null);
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

  function jumpToLatest() {
    stickToBottom.current = true;
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
          Meddelandet kunde inte skickas — försök igen.
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
                moderation={
                  isAdmin &&
                  (entry.message.senderType === 'participant' ||
                    entry.message.senderType === 'training_card')
                    ? renderModeration?.(entry.message)
                    : undefined
                }
              />
            ),
          )
        )}
        <div ref={bottomRef} aria-hidden="true" />

        {showNewMessages && (
          <button
            type="button"
            className={styles.newMessages}
            onClick={jumpToLatest}
          >
            Nya meddelanden ↓
          </button>
        )}
      </div>
    </Sheet>
  );
}

function MessageRow({
  message,
  isSelf,
  moderation,
}: {
  message: ChatMessage;
  isSelf: boolean;
  moderation: ReactNode;
}) {
  const isGameMaster = message.senderType === 'game_master';
  const text = displayBody(message);
  const senderLabel = isSelf
    ? 'Du'
    : (message.senderDisplayName ?? 'Deltagare');

  // An active training card renders its own self-contained layout (its own
  // header + time), not a normal bubble. A hidden card falls through to the
  // standard render: sender label + the "[Borttaget av administratör]"
  // placeholder, exactly like a hidden participant message.
  if (
    message.senderType === 'training_card' &&
    message.status === 'active' &&
    message.trainingCard !== null
  ) {
    return (
      <div
        className={[styles.message, isSelf && styles.self]
          .filter(Boolean)
          .join(' ')}
      >
        <TrainingCard
          card={message.trainingCard}
          senderName={senderLabel}
          time={formatTime(message.createdAt)}
        />
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
    >
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
      {text !== null && (
        <p className={styles.body} data-testid="chat-message-body">
          {text}
        </p>
      )}
      {message.attachments.length > 0 && (
        <ChatImageGrid
          messageId={message.id}
          attachments={message.attachments}
        />
      )}
      {moderation}
    </div>
  );
}
