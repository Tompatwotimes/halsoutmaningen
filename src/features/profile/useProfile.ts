import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { fetchMyProfile, type Profile } from './profile-api';

export type { Profile, Role } from './profile-api';

export interface UseProfileResult {
  profile: Profile | null;
  /** True only when the DB row says role='admin' AND active — mirrors is_admin(). */
  isAdmin: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function profileQueryKey(userId: string | null) {
  return ['profile', userId] as const;
}

/**
 * Loads the authenticated user's application profile via TanStack Query.
 *
 * The role is authoritative only from the database — the client never trusts a
 * held value for authorization (CLAUDE.md §10, §17). UI guards built on this
 * only hide controls; PostgreSQL RLS is the real enforcement.
 */
export function useProfile(): UseProfileResult {
  const { user, initializing } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: profileQueryKey(userId),
    queryFn: () => {
      if (userId === null) {
        throw new Error('Ingen inloggad användare.');
      }
      return fetchMyProfile(userId);
    },
    enabled: userId !== null,
    staleTime: 60_000,
  });

  const profile = query.data ?? null;

  return {
    profile,
    isAdmin: profile?.role === 'admin' && profile.active,
    isLoading: initializing || (userId !== null && query.isLoading),
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
