import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';
import { GroupIcon } from '@/components/icons';
import { useProfile } from '@/features/profile/useProfile';

/**
 * Rendered when `useChallengeData()` resolves successfully but returns
 * `null` — the signed-in user has an account but no challenge membership yet
 * (CLAUDE.md §4). This is an expected state, not an error: a brand-new admin
 * account before they add themselves, or someone between challenges.
 */
export function NoMembershipState({ title }: { title: string }) {
  const { isAdmin } = useProfile();

  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={<GroupIcon />}
        title="Du är inte med i någon utmaning ännu"
        body={
          isAdmin
            ? 'Lägg till dig själv som deltagare under Administration → Deltagare för att komma igång.'
            : 'Be en administratör lägga till dig i en utmaning.'
        }
        action={
          isAdmin ? (
            <Link to="/admin/deltagare">
              <Button variant="secondary">Till Deltagare</Button>
            </Link>
          ) : undefined
        }
      />
    </>
  );
}
