import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/useAuth';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { useProfile } from '@/features/profile/useProfile';
import { ChatModerationSheet } from '@/features/admin/ChatModerationSheet';
import type { ChatMessage } from './types';
import { ChatPanel } from './ChatPanel';
import { useUnreadChatCount } from './useChat';
import styles from './ChatBubble.module.css';

/**
 * Floating shared-chat entry point.
 *
 * Mounted once inside the authenticated AppShell (sibling of the Game Master
 * ambush). It is deliberately NOT a sixth bottom-nav item — the five-item nav
 * stays unchanged (spec). Renders nothing until there is both a challenge and a
 * signed-in user.
 */
export function ChatBubble() {
  const { user } = useAuth();
  const challengeQuery = useChallengeData();
  const { isAdmin } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();

  // Push-notification deep link: /?chat=1&seq=<n> opens the panel and jumps
  // to that message (reused as-is by ChatPanel's own jump-to-message driver).
  // Captured ONCE from the URL present at mount — `open`/`initialJumpSeq`
  // then live only in this state, never re-derived from `searchParams` on
  // every render, so stripping the query string a moment later (below) can't
  // race the value away before ChatPanel consumes it.
  const [open, setOpen] = useState(() => searchParams.get('chat') === '1');
  const [initialJumpSeq] = useState<number | null>(() => {
    if (searchParams.get('chat') !== '1') return null;
    const raw = searchParams.get('seq');
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  const challenge = challengeQuery.data?.challenge ?? null;
  const challengeId = challenge?.id ?? null;
  const userId = user?.id ?? null;

  const unreadQuery = useUnreadChatCount(challengeId, userId);
  const unread = unreadQuery.data ?? 0;

  useEffect(() => {
    if (searchParams.get('chat') !== '1') return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('chat');
        next.delete('seq');
        return next;
      },
      { replace: true },
    );
    // Runs once at mount for a deep-link arrival; setSearchParams above
    // removes the params so this never re-fires for the same navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable across renders so `React.memo(MessageRow)` holds (an inline arrow
  // here would re-render every moderated row on every ChatBubble render).
  const renderModeration = useCallback(
    (message: ChatMessage) =>
      challengeId === null ? null : (
        <ChatModerationSheet
          message={message}
          challengeId={challengeId}
          isAdmin={isAdmin}
        />
      ),
    [challengeId, isAdmin],
  );

  if (challengeId === null || userId === null || challenge === null)
    return null;

  const badgeText = unread > 99 ? '99+' : String(unread);

  return (
    <>
      <button
        type="button"
        className={styles.bubble}
        aria-label={unread > 0 ? `Chatt, ${unread} olästa` : 'Chatt'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <ChatIcon className={styles.icon} />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badgeText}
          </span>
        )}
      </button>

      <ChatPanel
        open={open}
        onClose={() => setOpen(false)}
        challengeId={challengeId}
        userId={userId}
        timeZone={challenge.timeZone}
        isAdmin={isAdmin}
        renderModeration={renderModeration}
        initialJumpSeq={initialJumpSeq}
      />
    </>
  );
}
