import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import type { InviteParticipantInput } from './invite-schema';

const FUNCTION_NAME = 'invite-participant';

export type InviteStatus =
  | 'invited' // new account created, invite email sent, membership linked
  | 'linked' // account already existed, membership newly linked
  | 'membership_updated' // membership already existed, window/active updated
  | 'already_member'; // account + identical membership already present, no-op

export interface InviteParticipantResult {
  status: InviteStatus;
  userId: string;
  existingUser: boolean;
  displayName: string;
  message: string;
}

interface FunctionErrorBody {
  error?: unknown;
}

function messageFromBody(body: unknown, fallback: string): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    typeof (body as FunctionErrorBody).error === 'string'
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

/**
 * Calls the privileged `invite-participant` Edge Function. The function
 * verifies the caller is an admin server-side, creates/sends the Supabase Auth
 * invite with the service role, and links the challenge membership. The
 * service-role key never touches the browser (CLAUDE.md §19).
 */
export async function inviteParticipant(
  input: InviteParticipantInput,
): Promise<InviteParticipantResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Du måste vara inloggad för att bjuda in deltagare.');
  }

  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/functions/v1/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'invite', ...input }),
    });
  } catch {
    throw new Error('Kunde inte nå servern. Kontrollera din anslutning.');
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      messageFromBody(
        body,
        response.status === 403
          ? 'Du har inte behörighet att bjuda in deltagare.'
          : 'Inbjudan misslyckades. Försök igen.',
      ),
    );
  }

  return body as InviteParticipantResult;
}
