import { Card } from '@/components/ui/Card';
import { EmptyState } from './EmptyState';

/**
 * Marks a screen that is scaffolded but not yet implemented. Each of these maps
 * to a phase in docs/IMPLEMENTATION_PLAN.md.
 */
export function ComingSoon({ phase, what }: { phase: string; what: string }) {
  return (
    <Card>
      <EmptyState
        title="Byggs i nästa fas"
        body={
          <>
            {what} implementeras i <strong>{phase}</strong>.
          </>
        }
      />
    </Card>
  );
}
