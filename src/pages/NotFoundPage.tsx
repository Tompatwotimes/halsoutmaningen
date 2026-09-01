import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Sidan hittades inte" />
      <EmptyState
        title="404"
        body="Sidan du letar efter finns inte."
        action={
          <Link to="/">
            <Button variant="secondary">Till startsidan</Button>
          </Link>
        }
      />
    </>
  );
}
