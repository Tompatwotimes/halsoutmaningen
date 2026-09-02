import { useQuery } from '@tanstack/react-query';
import {
  createProofSignedUrl,
  fetchEntryDetail,
  type EntryDetail,
} from './entries-api';

export interface EntryDetailWithProof extends Omit<EntryDetail, 'proofPath'> {
  proofSignedUrl: string | null;
}

/**
 * On-demand entry + proof lookup for one (challenge, participant, date) cell.
 * Only runs while `enabled` (the detail sheet is open) — never prefetched for
 * a whole grid (CLAUDE.md §12, Part 8 of the real-data phase). The signed URL
 * is short-lived and requested fresh every time the sheet opens.
 */
export function useEntryDetail(
  challengeId: string | null,
  userId: string | null,
  date: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['challenge', 'entry-detail', challengeId, userId, date],
    queryFn: async (): Promise<EntryDetailWithProof | null> => {
      if (!challengeId || !userId || !date) return null;
      const entry = await fetchEntryDetail(challengeId, userId, date);
      if (!entry) return null;
      const proofSignedUrl = entry.proofPath
        ? await createProofSignedUrl(entry.proofPath)
        : null;
      return { ...entry, proofSignedUrl };
    },
    enabled:
      enabled && challengeId !== null && userId !== null && date !== null,
    staleTime: 0,
    gcTime: 0,
  });
}
