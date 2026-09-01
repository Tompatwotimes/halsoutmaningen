import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useProfile } from '@/features/profile/useProfile';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Client-side gate for admin routes. This only hides UI — the real
 * enforcement lives in PostgreSQL RLS and security-definer functions
 * (CLAUDE.md §10).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useProfile();

  if (isLoading) {
    return <Spinner label="Kontrollerar behörighet…" />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
