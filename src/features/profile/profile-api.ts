import { supabase } from '@/lib/supabase';

export type Role = 'participant' | 'admin';

export interface Profile {
  id: string;
  displayName: string;
  avatarPath: string | null;
  role: Role;
  /** Admin-controlled. An inactive profile keeps its history but is blocked. */
  active: boolean;
}

function toRole(value: string): Role {
  return value === 'admin' ? 'admin' : 'participant';
}

/**
 * Load the authenticated user's application profile straight from the
 * `profiles` table. `role` / `active` are read from the database on every
 * load — never held or inferred client-side (CLAUDE.md §10, §17). RLS lets a
 * user read their own row unconditionally.
 */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_path, role, active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return {
    id: data.id,
    displayName: data.display_name,
    avatarPath: data.avatar_path,
    role: toRole(data.role),
    active: data.active,
  };
}
