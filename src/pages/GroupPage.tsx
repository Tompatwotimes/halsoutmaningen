import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function GroupPage() {
  return (
    <>
      <PageHeader
        title="Gruppen"
        subtitle="Idag och de senaste dagarna – vem har tränat och vem saknas."
      />
      <ComingSoon
        phase="Fas 6 – Gruppdashboard"
        what="Den rullbara statusrutan för idag + föregående dagar och gruppsammanfattningen"
      />
    </>
  );
}
