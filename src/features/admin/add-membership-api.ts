import type { PostgrestError } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/features/profile/profile-api';

export interface ProfileOption {
  id: string;
  displayName: string;
  role: Role;
  active: boolean;
}

function toRole(value: string): Role {
  return value === 'admin' ? 'admin' : 'participant';
}

/**
 * Every profile in the system — admin-only (RLS `profiles_select` grants an
 * admin every row via `is_admin()`). Small table; used to populate the
 * "add an existing account" picker (Part 2 of the real-data phase).
 */
export async function fetchAllProfiles(): Promise<ProfileOption[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, active')
    .order('display_name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    role: toRole(p.role),
    active: p.active,
  }));
}

export function useAllProfiles() {
  return useQuery({
    queryKey: ['admin', 'profiles'],
    queryFn: fetchAllProfiles,
    staleTime: 30_000,
  });
}

export interface AddMembershipInput {
  challengeId: string;
  userId: string;
  participationStartDate: string;
  participationEndDate: string | null;
  callerId: string;
}

export type AddMembershipStatus = 'created' | 'updated' | 'unchanged';
export interface AddMembershipResult {
  status: AddMembershipStatus;
}

function translateMembershipError(error: PostgrestError): string {
  const msg = error.message;
  if (msg.includes('does not intersect challenge range')) {
    return 'Perioden ligger helt utanför utmaningens datum.';
  }
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'Personen är redan deltagare i den här utmaningen.';
  }
  return `Medlemskapet kunde inte sparas: ${msg}`;
}

/**
 * Admin workflow: add an existing profile to a challenge, or update an
 * existing membership's window and reactivate it (Part 2 of the real-data
 * phase). Runs entirely as the authenticated admin caller through the normal
 * `challenge_memberships` RLS/audit trigger — no Edge Function needed, and no
 * duplicate membership rows (checked here, and the unique constraint is the
 * backstop).
 */
export async function addExistingMember(
  input: AddMembershipInput,
): Promise<AddMembershipResult> {
  const { data: existing, error: selectError } = await supabase
    .from('challenge_memberships')
    .select('id, participation_start_date, participation_end_date, active')
    .eq('challenge_id', input.challengeId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (selectError) {
    throw new Error(translateMembershipError(selectError));
  }

  if (!existing) {
    const { error } = await supabase.from('challenge_memberships').insert({
      challenge_id: input.challengeId,
      user_id: input.userId,
      participation_start_date: input.participationStartDate,
      participation_end_date: input.participationEndDate,
      active: true,
      created_by: input.callerId,
    });
    if (error) {
      throw new Error(translateMembershipError(error));
    }
    return { status: 'created' };
  }

  const unchanged =
    existing.participation_start_date === input.participationStartDate &&
    existing.participation_end_date === input.participationEndDate &&
    existing.active;

  if (unchanged) {
    return { status: 'unchanged' };
  }

  const { error } = await supabase
    .from('challenge_memberships')
    .update({
      participation_start_date: input.participationStartDate,
      participation_end_date: input.participationEndDate,
      active: true,
    })
    .eq('id', existing.id);

  if (error) {
    throw new Error(translateMembershipError(error));
  }
  return { status: 'updated' };
}

export function useAddExistingMember(challengeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addExistingMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'participants', challengeId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['challenge', 'roster', challengeId],
      });
      // The added/updated person might be the caller themselves (an admin
      // adding themselves as a participant) — invalidate the "which
      // challenge am I in" lookup and the composed dataset broadly (prefix
      // match) so Hem/Gruppen/etc. stop showing the "not a participant" state
      // immediately, without needing a manual refresh (Part 2 requirement).
      void queryClient.invalidateQueries({ queryKey: ['challenge', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['challenge-data'] });
    },
  });
}
