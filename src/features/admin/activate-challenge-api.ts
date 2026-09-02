import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Flips a challenge from `draft` to `active` (Part 3 of the real-data phase).
 * Participants can only create training entries once the challenge is active
 * (`training_entries_guard` — docs/DATABASE.md §2); admins already bypass
 * that check. This does not touch any other field — the rule fields
 * (`start_date`, `required_minutes`, `proof_required`, `missed_day_cost`,
 * `timezone`) are handled entirely by the existing `challenges_guard` lock,
 * which engages once the challenge has started in its own timezone
 * regardless of status.
 */
export async function activateChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase
    .from('challenges')
    .update({ status: 'active' })
    .eq('id', challengeId);

  if (error) {
    throw new Error(error.message);
  }
}

export function useActivateChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateChallenge,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['challenge', 'mine'] });
    },
  });
}
