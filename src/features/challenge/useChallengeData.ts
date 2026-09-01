import { useQuery } from '@tanstack/react-query';
import {
  buildChallengeDataset,
  type ChallengeDataset,
} from '@/fixtures/dataset';

/**
 * Adapter boundary for challenge data.
 *
 * Today this resolves a typed development fixture (see `src/fixtures`). When
 * the Supabase RPCs land (recent dashboard, full matrix, participant stats —
 * docs/IMPLEMENTATION_PLAN.md Fas 5–8), only this module changes: swap the
 * `queryFn` for real queries that produce the same `ChallengeDataset` shape.
 * Screens never touch fixtures directly.
 */

let cached: ChallengeDataset | null = null;

function loadDataset(): Promise<ChallengeDataset> {
  cached ??= buildChallengeDataset();
  const dataset = cached;
  // A short delay so the designed loading/skeleton states are exercised.
  return new Promise((resolve) => setTimeout(() => resolve(dataset), 260));
}

export const challengeDataKey = ['challenge-data', 'active'] as const;

export function useChallengeData() {
  return useQuery({
    queryKey: challengeDataKey,
    queryFn: loadDataset,
    staleTime: Infinity,
  });
}
