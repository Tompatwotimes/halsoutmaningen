import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthResult {
  error: string | null;
}

export interface AuthContextValue {
  /** True until the initial session lookup completes. */
  initializing: boolean;
  session: Session | null;
  user: User | null;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Send a password-reset / set-password email (also used for expired invites). */
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  /** Set a new password for the currently authenticated user. */
  updatePassword: (password: string) => Promise<AuthResult>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
