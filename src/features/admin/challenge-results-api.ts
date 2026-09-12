import { useQuery } from '@tanstack/react-query';
import {
  fetchChallengeResults,
  type ChallengeResultRow,
} from '@/features/challenge/challenge-api';

export type { ChallengeResultRow };

export function useChallengeResults(challengeId: string | null) {
  return useQuery({
    queryKey: ['admin', 'challenge-results', challengeId],
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchChallengeResults(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 30_000,
  });
}
