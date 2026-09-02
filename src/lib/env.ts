import { z } from 'zod';

/**
 * Runtime validation of the browser-safe environment. Fails fast with a clear
 * message if the app is built/served without Supabase configuration.
 *
 * Only `VITE_`-prefixed, public values are read here. Secrets never reach the
 * client bundle (see docs/ARCHITECTURE.md §23).
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a valid URL'),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'VITE_SUPABASE_ANON_KEY is required'),
  // Optional. The canonical public origin of the deployed frontend, used to
  // build auth email redirect links (invite / password reset). When unset the
  // app falls back to `window.location.origin` at runtime, which is what local
  // development wants. Production sets this to the real HTTPS URL so links are
  // stable regardless of which host/preview the admin happens to be on.
  VITE_PUBLIC_SITE_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().url('VITE_PUBLIC_SITE_URL must be a valid URL').optional(),
  ),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      'Copy .env.example to .env and provide the Supabase project values.',
  );
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL,
  supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  publicSiteUrl: parsed.data.VITE_PUBLIC_SITE_URL ?? null,
} as const;

/**
 * Canonical origin (no trailing slash) for auth email redirect links.
 *
 * Prefers the build-time `VITE_PUBLIC_SITE_URL`; falls back to the current
 * browser origin so local development at `http://<dev-host>:5173` keeps working
 * without that value ever becoming a hardcoded production constant.
 */
export function siteUrl(): string {
  if (env.publicSiteUrl) {
    return env.publicSiteUrl.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return '';
}
