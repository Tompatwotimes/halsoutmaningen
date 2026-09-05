import { useState } from 'react';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { HIDDEN_MESSAGE_PLACEHOLDER } from '@/features/chat/chat';
import type { ChatMessage } from '@/features/chat/types';
import { useHideChatMessage } from './chat-admin-api';
import styles from './ChatModerationSheet.module.css';

interface Props {
  message: ChatMessage;
  challengeId: string;
  isAdmin: boolean;
}

/**
 * Per-message admin moderation affordance, rendered inside `ChatPanel` for an
 * admin viewer only. Reuses the mandatory-reason `ConfirmSheet` pattern from
 * the Game Master run log's hide flow. A non-admin viewer never sees the
 * trigger; an already-hidden message has nothing to hide.
 */
export function ChatModerationSheet({ message, challengeId, isAdmin }: Props) {
  const hide = useHideChatMessage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!isAdmin || message.senderType !== 'participant') return null;
  if (message.status === 'hidden') return null;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          if (hide.isError) hide.reset();
          setReason('');
          setOpen(true);
        }}
      >
        Dölj
      </button>

      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Dölj meddelandet?"
        body={
          <>
            Meddelandet ersätts med <em>{HIDDEN_MESSAGE_PLACEHOLDER}</em> för
            alla deltagare. Den ursprungliga texten sparas men visas inte, och
            åtgärden loggas.
          </>
        }
        confirmLabel="Dölj"
        danger
        loading={hide.isPending}
        error={hide.error instanceof Error ? hide.error.message : null}
        disabled={reason.trim().length === 0}
        onConfirm={() =>
          hide.mutate(
            { messageId: message.id, challengeId, reason: reason.trim() },
            {
              onSuccess: () => {
                setOpen(false);
                setReason('');
              },
            },
          )
        }
      >
        <label className={styles.field}>
          <span>Anledning (obligatorisk)</span>
          <textarea
            value={reason}
            rows={2}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="T.ex. Kränkande språk."
          />
        </label>
      </ConfirmSheet>
    </>
  );
}
