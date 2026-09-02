import { useQuery } from '@tanstack/react-query';
import {
  createProofSignedUrl,
  fetchDaySessions,
  type EntryDetail,
} from './entries-api';

export interface SessionDetailWithProof extends Omit<EntryDetail, 'proofPath'> {
  proofSignedUrl: string | null;
}

export interface DayDetail {
  sessions: SessionDetailWithProof[];
}

/**
 * On-demand session(s) + proof lookup for one (challenge, participant, date)
 * cell. Only runs while `enabled` (the detail sheet is open) — never prefetched
 * for a whole grid (CLAUDE.md §12). Signed URLs are short-lived and requested
 * fresh every time the sheet opens.
 */
export function useEntryDetail(
  challengeId: string | null,
  userId: string | null,
  date: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['challenge', 'entry-detail', challengeId, userId, date],
    queryFn: async (): Promise<DayDetail> => {
      if (!challengeId || !userId || !date) return { sessions: [] };
      const sessions = await fetchDaySessions(challengeId, userId, date);
      const withProof = await Promise.all(
        sessions.map(async (s) => ({
          ...s,
          proofSignedUrl: s.proofPath
            ? await createProofSignedUrl(s.proofPath)
            : null,
        })),
      );
      return { sessions: withProof };
    },
    enabled:
      enabled && challengeId !== null && userId !== null && date !== null,
    staleTime: 0,
    gcTime: 0,
  });
}
