import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function AdminPage() {
  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Utmaningar, deltagare, korrigeringar och granskningslogg."
      />
      <ComingSoon
        phase="Fas 9 – Administration"
        what="Skapa/konfigurera utmaningar, hantera medlemskap och granska poster"
      />
    </>
  );
}
