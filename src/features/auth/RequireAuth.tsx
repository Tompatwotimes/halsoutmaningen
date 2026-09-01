import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useProfile } from '@/features/profile/useProfile';
import { AppLoading } from '@/components/feedback/AppLoading';
import { AccountInactiveNotice } from './AccountInactiveNotice';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { initializing, session } = useAuth();
  const { profile, isLoading } = useProfile();
  const location = useLocation();

  if (initializing) {
    return <AppLoading label="Kontrollerar inloggning…" />;
  }

  if (!session) {
    return <Navigate to="/logga-in" replace state={{ from: location }} />;
  }

  if (isLoading) {
    return <AppLoading label="Laddar din profil…" />;
  }

  // Deactivated accounts keep their history but lose app access
  // (docs/IMPLEMENTATION_PLAN.md §1.3). A missing profile row is not treated as
  // inactive — RLS still constrains everything the session can reach.
  if (profile && !profile.active) {
    return <AccountInactiveNotice />;
  }

  return <>{children}</>;
}
