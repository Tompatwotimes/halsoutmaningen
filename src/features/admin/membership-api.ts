import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface UpdateMembershipInput {
  membershipId: string;
  challengeId: string;
  userId: string;
  participationStartDate: string;
  participationEndDate: string | null;
  active: boolean;
}

function translate(message: string): string {
  if (message.includes('does not intersect challenge range'))
    return 'Perioden ligger helt utanför utmaningens datum.';
  if (
    message.includes('window_order') ||
    message.includes('>= participation_start_date')
  )
    return 'Slutdatum kan inte vara före startdatum.';
  if (message.includes('Endast administrat') || message.includes('42501'))
    return 'Endast administratörer får ändra medlemskap.';
  return `Medlemskapet kunde inte sparas: ${message}`;
}

/**
 * Update one challenge membership — window and/or active flag. Runs as the
 * authenticated admin through the normal `challenge_memberships` RLS
 * (`challenge_memberships_update` = `is_admin()`), the window guard and the
 * audit trigger (which records `membership_window_changed` /
 * `membership_deactivated` / `membership_reactivated`). No row is deleted —
 * ending participation is a date, deactivating is a flag; history is preserved.
 */
export async function updateMembership(
  input: UpdateMembershipInput,
): Promise<void> {
  const { error } = await supabase
    .from('challenge_memberships')
    .update({
      participation_start_date: input.participationStartDate,
      participation_end_date: input.participationEndDate,
      active: input.active,
    })
    .eq('id', input.membershipId);
  if (error) throw new Error(translate(error.message));
}

export function useUpdateMembership(challengeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMembership,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'participants', challengeId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['challenge', 'roster', challengeId],
      });
      void queryClient.invalidateQueries({ queryKey: ['challenge', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['challenge-data'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      void queryClient.invalidateQueries({ queryKey: ['straffbank'] });
    },
  });
}
