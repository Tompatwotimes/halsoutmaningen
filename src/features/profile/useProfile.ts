import { useAuth } from '@/features/auth/useAuth';

export type Role = 'participant' | 'admin';

export interface Profile {
  id: string;
  displayName: string;
  avatarPath: string | null;
  role: Role;
}

export interface UseProfileResult {
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
}

/**
 * Loads the authenticated user's application profile.
 *
 * Placeholder until the `profiles` table and RLS exist (Supabase schema/auth
 * phase). The role is authoritative only from the database — never trust a
 * client-held value for authorization (CLAUDE.md §10, §17). This hook exists so
 * the shell can already branch on `isAdmin` without that logic scattering.
 */
export function useProfile(): UseProfileResult {
  const { user, initializing } = useAuth();

  if (!user) {
    return { profile: null, isAdmin: false, isLoading: initializing };
  }

  // TODO(schema-phase): query `profiles` via TanStack Query + supabase.
  return { profile: null, isAdmin: false, isLoading: false };
}
