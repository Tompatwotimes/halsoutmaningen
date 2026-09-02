import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitTraining, type SubmitTrainingInput } from './submit-training';
import { invalidateChallengeData } from './useChallengeData';

/**
 * Mutation wrapper for `submitTraining` that refreshes exactly the queries a
 * successful log can change: this challenge's day states, the signed-in
 * user's own entries, and the composed dataset every screen reads (Part 12 —
 * Hem/Gruppen/Profil/Översikt all update from one invalidation, not a full
 * app refresh).
 */
export function useSubmitTraining() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SubmitTrainingInput) => submitTraining(input),
    onSuccess: (_result, input) => {
      invalidateChallengeData(queryClient, input.challengeId, input.userId);
    },
  });
}
