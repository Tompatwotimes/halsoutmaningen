import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SubmitTrainingError, attachProof } from './submit-training';
import { invalidateChallengeData } from './useChallengeData';

/**
 * Append an EXTRA training session for the current challenge day (Dubbelpass).
 * The primary session (seq 1) still goes through `submitTraining`; this is for
 * the 2nd, 3rd, … session. `add_training_session` assigns the next `session_seq`
 * atomically server-side, then the proof is attached to the new row.
 */
export interface AddSessionInput {
  challengeId: string;
  userId: string;
  /** Challenge-local today; the RPC re-verifies. */
  date: string;
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  proofFile?: File | null;
}

function translate(message: string): string {
  if (message.includes('current challenge day') || message.includes('aktiv'))
    return 'Du kan bara logga pass för dagens datum.';
  if (message.includes('membership') || message.includes('medlemskap'))
    return 'Ditt medlemskap i utmaningen är pausat just nu.';
  return 'Passet kunde inte sparas. Försök igen.';
}

export async function addTrainingSession(
  input: AddSessionInput,
): Promise<{ entryId: string }> {
  const { data, error } = await supabase.rpc('add_training_session', {
    p_challenge_id: input.challengeId,
    p_duration_minutes: input.durationMinutes,
    ...(input.activity ? { p_activity: input.activity } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });

  if (error) {
    throw new SubmitTrainingError(translate(error.message), false);
  }

  const row = data as { id: string } | null;
  const entryId = row?.id ?? '';
  if (!entryId) {
    throw new SubmitTrainingError('Passet kunde inte sparas.', false);
  }

  if (input.proofFile) {
    await attachProof(
      input.challengeId,
      input.userId,
      input.date,
      entryId,
      input.proofFile,
    );
  }

  return { entryId };
}

export function useAddTrainingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSessionInput) => addTrainingSession(input),
    onSuccess: (_r, input) => {
      invalidateChallengeData(queryClient, input.challengeId, input.userId);
    },
  });
}
