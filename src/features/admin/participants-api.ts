import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { fetchChallengeRoster } from '@/features/challenge/roster-api';

/**
 * Participant list for the admin "Deltagare" screen. Delegates to the shared
 * roster fetch (`@/features/challenge/roster-api`) — the same query the real
 * participant-facing dataset uses, since RLS already exposes the full roster
 * to any challenge member, not just admins.
 */
export const fetchParticipants = fetchChallengeRoster;

export function useParticipants(challengeId: string | null) {
  return useQuery({
    queryKey: ['admin', 'participants', challengeId],
    queryFn: () => {
      if (challengeId === null) {
        throw new Error('challengeId krävs.');
      }
      return fetchChallengeRoster(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Optional auth-account status enrichment (invited vs. active).
//
// auth.users is never exposed to the browser. This asks the privileged
// Edge Function, which verifies admin and returns only non-sensitive fields.
// ---------------------------------------------------------------------------

export type AccountState = 'invited' | 'active' | 'unknown';

export interface AccountStatus {
  userId: string;
  state: AccountState;
  invitedAt: string | null;
  lastSignInAt: string | null;
}

export async function fetchAccountStatuses(
  challengeId: string,
): Promise<Record<string, AccountStatus>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Ingen aktiv session.');
  }

  const response = await fetch(
    `${env.supabaseUrl}/functions/v1/invite-participant`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'account-status', challengeId }),
    },
  );

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error('Kunde inte hämta kontostatus.');
  }

  const list = (body as { accounts?: AccountStatus[] }).accounts ?? [];
  return Object.fromEntries(list.map((a) => [a.userId, a]));
}

export function useAccountStatuses(
  challengeId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['admin', 'account-status', challengeId],
    queryFn: () => {
      if (challengeId === null) {
        throw new Error('challengeId krävs.');
      }
      return fetchAccountStatuses(challengeId);
    },
    enabled: enabled && challengeId !== null,
    staleTime: 60_000,
    retry: 0,
  });
}
