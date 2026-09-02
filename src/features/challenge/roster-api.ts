import { supabase } from '@/lib/supabase';
import type { Role } from '@/features/profile/profile-api';

export interface RosterMember {
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
 * Every membership row for one challenge, joined to the member's profile.
 *
 * Two small queries rather than an embed — predictable typing, and this scale
 * (tens of rows) doesn't need one. RLS lets any challenge member read every
 * membership/profile that shares the challenge (docs/DATABASE.md §5) — the
 * same query works whether the caller is an admin or a regular participant.
 */
export async function fetchChallengeRoster(
  challengeId: string,
): Promise<RosterMember[]> {
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
