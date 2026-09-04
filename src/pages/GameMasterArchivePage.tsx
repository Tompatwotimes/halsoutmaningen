import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { NoMembershipState } from '@/features/challenge/NoMembershipState';
import { GameMasterArchive } from '@/features/game-master/GameMasterArchive';
import styles from './GameMasterArchivePage.module.css';

/**
 * Arkivet — the Game Master's public chronicle (spec §9). Reached from a
 * discrete card on the Group page and the `/arkivet` route (normal
 * authentication, not admin). It is a chronicle, not a feed: no likes,
 * comments, replies or participant posting.
 *
 * The page shell (loading / error / no-membership) mirrors `StraffbankenPage`.
 * The archive list itself is best-effort — its own failure stays inside
 * `GameMasterArchive` as a quiet empty state and never turns this page into an
 * error.
 */
export function GameMasterArchivePage() {
  const { data, isLoading, isError, refetch } = useChallengeData();

  if (isLoading) {
    return (
      <>
        <PageHeader eyebrow="SYSTEMET" title="Arkivet" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
      </>
    );
  }
  if (isError) {
    return (
      <>
        <PageHeader eyebrow="SYSTEMET" title="Arkivet" />
        <ErrorState onRetry={() => void refetch()} />
      </>
    );
  }
  if (!data) return <NoMembershipState title="Arkivet" />;

  return (
    <>
      <PageHeader
        eyebrow="SYSTEMET"
        title="Arkivet"
        subtitle="Systemets officiella historieskrivning."
      />
      <div className={styles.body}>
        <GameMasterArchive challengeId={data.challenge.id} />
      </div>
    </>
  );
}
