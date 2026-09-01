import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import type { Role } from '@/features/profile/profile-api';

export interface ParticipantRow {
  membershipId: string;
  userId: string;
  displayName: string;
  avatarPath: string | null;
  role: Role;
  profileActive: boolean;
  participationStartDate: string;
  participationEndDate: string | null;
  membershipActive: boolean;
  createdAt: string;
}

function toRole(value: string): Role {
  return value === 'admin' ? 'admin' : 'participant';
}

/**
 * Participant list for one challenge: challenge_memberships joined to profiles.
 * Two small queries rather than an embed — predictable typing, and ~21 rows.
 * Admin RLS exposes every membership and profile.
 */
export async function fetchParticipants(
  challengeId: string,
): Promise<ParticipantRow[]> {
  const { data: memberships, error: mErr } = await supabase
    .from('challenge_memberships')
    .select(
      'id, user_id, participation_start_date, participation_end_date, active, created_at',
    )
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: true });

  if (mErr) {
    throw new Error(mErr.message);
  }
  if (memberships.length === 0) {
    return [];
  }

  const userIds = memberships.map((m) => m.user_id);
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_path, role, active')
    .in('id', userIds);

  if (pErr) {
    throw new Error(pErr.message);
  }

  const byId = new Map(profiles.map((p) => [p.id, p]));

  return memberships.map((m) => {
    const profile = byId.get(m.user_id);
    return {
      membershipId: m.id,
      userId: m.user_id,
      displayName: profile?.display_name ?? 'Okänd deltagare',
      avatarPath: profile?.avatar_path ?? null,
      role: toRole(profile?.role ?? 'participant'),
      profileActive: profile?.active ?? true,
      participationStartDate: m.participation_start_date,
      participationEndDate: m.participation_end_date,
      membershipActive: m.active,
      createdAt: m.created_at,
    };
  });
}

export function useParticipants(challengeId: string | null) {
  return useQuery({
    queryKey: ['admin', 'participants', challengeId],
    queryFn: () => {
      if (challengeId === null) {
        throw new Error('challengeId krävs.');
      }
      return fetchParticipants(challengeId);
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
