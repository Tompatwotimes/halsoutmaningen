import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { ChatError } from '@/features/chat/chat-api';
import { chatKeys } from '@/features/chat/useChat';

/**
 * Shared chat — admin moderation adapter.
 *
 * Split out of `chat-api.ts` the same way `game-master-api.ts` keeps its admin
 * surface separate: only an admin viewer ever imports this. The single write is
 * the `hide_chat_message` RPC, which enforces admin-only, a mandatory reason,
 * one audit row, and retention of the original body (rendered as the fixed
 * `[Borttaget av administratör]` placeholder). Clients never UPDATE or DELETE a
 * message row directly.
 */

// TODO(chat-types): drop the cast once the chat migrations are applied and
// `npm run db:types` has run.
const chatdb = supabase as unknown as SupabaseClient;

interface RpcResult {
  error: { message: string } | null;
}

/**
 * Hide one participant message. The RPC rejects a non-admin caller, an empty
 * reason, a Game Master row, and an already-hidden row; on success it writes
 * exactly one `audit_log` row (actor, target, reason — never the body text).
 */
export async function hideChatMessage(
  messageId: string,
  reason: string,
): Promise<void> {
  const res = (await chatdb.rpc('hide_chat_message', {
    p_message_id: messageId,
    p_reason: reason,
  })) as unknown as RpcResult;
  if (res.error) {
    // The RPC already speaks Swedish (not-admin / empty reason / GM row /
    // already hidden) — pass it through, fall back for a network failure.
    const message =
      !res.error.message ||
      /fetch failed|Failed to fetch|NetworkError/i.test(res.error.message)
        ? 'Meddelandet kunde inte döljas. Kontrollera uppkopplingen.'
        : res.error.message;
    throw new ChatError(message);
  }
}

interface HideVars {
  messageId: string;
  challengeId: string;
  reason: string;
}

export function useHideChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: HideVars) =>
      hideChatMessage(vars.messageId, vars.reason),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(vars.challengeId),
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}
