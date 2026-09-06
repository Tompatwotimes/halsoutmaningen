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
import { formatLongDate } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import {
  CHAT_BODY_MAX_LENGTH,
  chatDateSeparatorKey,
  displayBody,
  isNearBottom,
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

  // --- scroll positioning (B1) --------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Have we done the one-time "open at the newest message" jump yet?
  const didInitialScroll = useRef(false);
  // Set right before an older page is fetched; consumed once it has rendered.
  const pendingAnchorHeight = useRef<number | null>(null);
  // Snapshot of "is the viewport near the bottom", kept fresh by the scroll
  // listener and read when new messages arrive.
  const nearBottomRef = useRef(true);
  // Newest seq we have already reacted to (scrolled to / announced).
  const reactedMaxSeq = useRef(0);
  // Newest seq the read cursor has been advanced to (never regresses).
  const markedSeq = useRef(0);
  const [showNewMessages, setShowNewMessages] = useState(false);

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
    didInitialScroll.current = false;
    pendingAnchorHeight.current = null;
    nearBottomRef.current = true;
    reactedMaxSeq.current = 0;
    markedSeq.current = 0;
    setShowNewMessages(false);
  }, [challengeId, open]);

  // Keep the near-bottom snapshot fresh; auto-load older history near the top;
  // dismiss the "Nya meddelanden" pill once the user scrolls back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const onScroll = () => {
      const near = isNearBottom(el);
      nearBottomRef.current = near;
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

    // (b) first render with content — open pinned to the newest message.
    if (!didInitialScroll.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      nearBottomRef.current = true;
      reactedMaxSeq.current = maxSeq;
      advanceRead(maxSeq);
      return;
    }

    // (c) a newer message arrived.
    if (maxSeq > reactedMaxSeq.current) {
      const newest = messages[messages.length - 1];
      const isOwnMessage = newest?.senderUserId === userId;
      if (nearBottomRef.current || isOwnMessage) {
        bottomRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
        nearBottomRef.current = true;
        setShowNewMessages(false);
        advanceRead(maxSeq);
      } else {
        setShowNewMessages(true);
      }
      reactedMaxSeq.current = maxSeq;
    }
  }, [open, query.isLoading, messages, maxSeq, userId, advanceRead]);

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
    draft.trim().length > 0 &&
    draft.length <= CHAT_BODY_MAX_LENGTH &&
    !post.isPending;

  function send() {
    if (!canSend) return;
    post.mutate(
      { challengeId, body: draft },
      { onSuccess: () => setDraft('') },
    );
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
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
        Skicka
      </Button>
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
      <div className={styles.list} role="log" aria-label="Chattmeddelanden">
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
                  isAdmin && entry.message.senderType === 'participant'
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
          <span className={styles.sender}>
            {isSelf ? 'Du' : (message.senderDisplayName ?? 'Deltagare')}
          </span>
        )}
        <time className={styles.time}>{formatTime(message.createdAt)}</time>
      </div>
      <p className={styles.body} data-testid="chat-message-body">
        {displayBody(message)}
      </p>
      {moderation}
    </div>
  );
}
