import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';

export function RankingPage() {
  return (
    <>
      <PageHeader
        title="Ranking"
        subtitle="Genomförandegrad, missade dagar och streak – rättvist för sena starter."
      />
      <ComingSoon
        phase="Fas 8 – Ranking"
        what="Topplistan (formeln fastställs innan den blir tävlingssanning)"
      />
    </>
  );
}
