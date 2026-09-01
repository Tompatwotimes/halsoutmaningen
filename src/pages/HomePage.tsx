import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function HomePage() {
  return (
    <>
      <PageHeader
        title="Hem"
        subtitle="Har du tränat idag? Så här ligger du och gruppen till."
      />
      <ComingSoon
        phase="Fas 5 – Idag & personlig status"
        what="Dagens status, streak, progress, skuld och grupphuvudet"
      />
    </>
  );
}
