import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const lastMarkedSeq = useRef(0);

  const messages = query.messages;

  // Mark everything currently visible as read whenever the newest seq advances.
  // Best-effort — a failure is silently ignored and read state never regresses.
  useEffect(() => {
    if (!open || messages.length === 0) return;
    const maxSeq = messages[messages.length - 1]?.seq ?? 0;
    if (maxSeq > lastMarkedSeq.current) {
      lastMarkedSeq.current = maxSeq;
      markRead({ challengeId, seq: maxSeq });
    }
  }, [open, messages, markRead, challengeId]);

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
    <Sheet open onClose={onClose} title="Chatt" footer={composer}>
      <div className={styles.list} role="log" aria-label="Chattmeddelanden">
        {query.hasNextPage && (
          <button
            type="button"
            className={styles.loadOlder}
            onClick={() => void query.fetchNextPage()}
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
          <Badge tone="missed" size="sm">
            GAME MASTER
          </Badge>
        ) : (
          <span className={styles.sender}>{isSelf ? 'Du' : ''}</span>
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
