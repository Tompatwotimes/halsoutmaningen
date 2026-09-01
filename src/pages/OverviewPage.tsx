import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Översikt"
        subtitle="Hela utmaningen – alla deltagare och alla dagar."
      />
      <ComingSoon
        phase="Fas 7 – Fullständig utmaningsmatris"
        what="Deltagare × alla utmaningsdagar med fasta namn och datumrubriker"
      />
    </>
  );
}
