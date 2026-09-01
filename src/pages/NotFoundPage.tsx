import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';
import { ImageOffIcon } from '@/components/icons';

export function NotFoundPage() {
  return (
    <div style={{ paddingTop: 'var(--sp-8)' }}>
      <EmptyState
        icon={<ImageOffIcon />}
        title="Sidan hittades inte"
        body="Länken kan vara gammal eller felstavad."
        action={
          <Link to="/">
            <Button variant="secondary">Till startsidan</Button>
          </Link>
        }
      />
    </div>
  );
}
