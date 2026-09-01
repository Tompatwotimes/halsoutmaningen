import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useProfile } from '@/features/profile/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/feedback/ErrorState';

/**
 * Client-side gate for admin routes. This only hides UI — the real enforcement
 * lives in PostgreSQL RLS, the security-definer `is_admin()` predicate and the
 * privileged Edge Function's own admin check (CLAUDE.md §10, §17).
 *
 * Fails closed: while the profile is loading the route is withheld, and a
 * profile-load error does not grant access.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading, isError, refetch } = useProfile();

  if (isLoading) {
    return <Spinner label="Kontrollerar behörighet…" />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Kunde inte kontrollera behörighet"
        message="Det gick inte att läsa din profil. Försök igen."
        onRetry={refetch}
      />
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
