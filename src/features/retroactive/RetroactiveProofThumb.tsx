import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/Skeleton';
import { SignedProofImage } from '@/components/proof/SignedProofImage';
import { createRetroactiveProofUrl } from './retroactive-api';

/**
 * A proof image for a retroactive-request session. The signed URL is requested
 * only when this renders (an admin opening the review card) — never in bulk.
 * A pending proof is readable only by its owner + admins (tightened bucket
 * policy).
 */
export function RetroactiveProofThumb({
  path,
  enabled = true,
}: {
  path: string | null;
  enabled?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['retroactive', 'proof-url', path],
    queryFn: () => {
      if (path === null) throw new Error('path krävs.');
      return createRetroactiveProofUrl(path);
    },
    enabled: enabled && path !== null,
    staleTime: 60_000,
    gcTime: 0,
  });

  if (path === null) return null;
  if (isLoading) return <Skeleton height="10rem" radius="var(--radius-md)" />;
  if (isError || !data)
    return (
      <p style={{ fontSize: 'var(--fs-xs)' }}>Bilden kunde inte laddas.</p>
    );
  return <SignedProofImage src={data} alt="Bildbevis" />;
}
