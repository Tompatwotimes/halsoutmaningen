import { useState } from 'react';
import { ChatIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/useAuth';
import { useChallengeData } from '@/features/challenge/useChallengeData';
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
  const [open, setOpen] = useState(false);

  const challenge = challengeQuery.data?.challenge ?? null;
  const challengeId = challenge?.id ?? null;
  const userId = user?.id ?? null;

  const unreadQuery = useUnreadChatCount(challengeId, userId);
  const unread = unreadQuery.data ?? 0;

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
        isAdmin={false}
      />
    </>
  );
}
