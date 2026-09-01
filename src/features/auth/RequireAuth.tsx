import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Spinner } from '@/components/ui/Spinner';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { initializing, session } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <Spinner label="Kontrollerar inloggning…" />;
  }

  if (!session) {
    return <Navigate to="/logga-in" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
