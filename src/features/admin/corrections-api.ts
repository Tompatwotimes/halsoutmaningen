import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateChallengeData } from '@/features/challenge/useChallengeData';

export const INVALIDATION_REASONS = [
  { code: 'felregistrerad', label: 'Felaktigt registrerat' },
  { code: 'otillrackligt_bildbevis', label: 'Otillräckligt bildbevis' },
  { code: 'dubblett', label: 'Dubblerad registrering' },
  { code: 'fel_datum', label: 'Fel datum' },
  { code: 'administrativ_rattning', label: 'Administrativ rättning' },
  { code: 'annat', label: 'Annat' },
] as const;

export type InvalidationReasonCode =
  (typeof INVALIDATION_REASONS)[number]['code'];

export async function invalidateTrainingSession(input: {
  entryId: string;
  reason: string;
  reasonCode: InvalidationReasonCode;
}): Promise<void> {
  const { error } = await supabase.rpc('invalidate_training_session', {
    p_entry_id: input.entryId,
    p_reason: input.reason,
    p_reason_code: input.reasonCode,
  });
  if (error) throw new Error(error.message);
}

export async function revalidateTrainingSession(input: {
  entryId: string;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc('revalidate_training_session', {
    p_entry_id: input.entryId,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
}

export function useTrainingCorrection(
  challengeId: string,
  targetUserId: string,
) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    invalidateChallengeData(queryClient, challengeId, targetUserId);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    void queryClient.invalidateQueries({ queryKey: ['entry-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['straffbank'] });
  };

  return {
    invalidate: useMutation({
      mutationFn: invalidateTrainingSession,
      onSuccess: invalidate,
    }),
    revalidate: useMutation({
      mutationFn: revalidateTrainingSession,
      onSuccess: invalidate,
    }),
  };
}
