import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env } from './env';

/**
 * The one production Supabase project this repo has ever had (no separate
 * dev/staging project exists — egress forensics, 2026-09). Comparing against
 * it below is not a secret: the URL is public and already baked into every
 * build. `npm run dev` reads the same `.env` as a real deploy, so a local
 * session against this project makes REAL requests against REAL production
 * Storage/Postgres — proof images and chat media downloaded while browsing
 * locally cost real production egress exactly like a real user's session.
 */
const PRODUCTION_SUPABASE_HOST = 'offvlyflactysibrssco.supabase.co';

if (import.meta.env.DEV && env.supabaseUrl.includes(PRODUCTION_SUPABASE_HOST)) {
  console.warn(
    '[dev] This local session is connected to PRODUCTION Supabase — ' +
      'training proofs and chat media you view here download real ' +
      'production Storage bytes, the same as a real user opening the app. ' +
      'Prefer /forhandsvisning (fixture data, no backend) for UI work; if ' +
      'you do need real data, avoid opening Chat/Gruppen/Översikt repeatedly ' +
      'or scrolling through many training-proof images.',
  );
}

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
