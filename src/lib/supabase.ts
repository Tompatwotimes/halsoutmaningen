import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env } from './env';

/**
 * Single shared Supabase client for the browser.
 *
 * Auth session is persisted to localStorage and auto-refreshed. All data
 * access goes through this client and is constrained by Row Level Security in
 * PostgreSQL — the frontend is never the authoritative security layer.
 */
export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);
