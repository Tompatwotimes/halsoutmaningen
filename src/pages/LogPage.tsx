import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function LogPage() {
  return (
    <>
      <PageHeader
        title="Logga träning"
        subtitle="Tid, aktivitet, kommentar och bildbevis – klart på under en minut."
      />
      <ComingSoon
        phase="Fas 4 – Träningsloggning & bildbevis"
        what="Formuläret för att registrera träning med privat bilduppladdning"
      />
    </>
  );
}
