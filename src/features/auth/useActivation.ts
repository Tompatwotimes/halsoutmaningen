import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import {
  activationLinkErrorMessage,
  parseActivationLink,
  stripActivationParamsFromUrl,
} from './activationLink';

/**
 * State machine for the `/aktivera` landing page (Supabase invite /
 * password-reset email link).
 *
 *   resolving ──► ready ──► submitting ──► success
 *        │           ▲           │
 *        │           └───────────┘  (validation / update error → back to ready)
 *        ├──► link-error   (URL carried an explicit Supabase error, or the
 *        │                  invite hash could not be turned into a session)
 *        └──► no-session   (settled with no session — opened directly, or a
 *                           stale link whose tokens are already spent)
 *
 * "Email verified" is never treated as "password set": reaching `ready` only
 * means there is an authenticated invite session; the account is not considered
 * activated until `supabase.auth.updateUser({ password })` succeeds.
 */
export type ActivationStatus =
  | 'resolving'
  | 'ready'
  | 'submitting'
  | 'success'
  | 'link-error'
  | 'no-session';

export const activationPasswordSchema = z
  .object({
    password: z.string().min(8, 'Välj ett lösenord med minst 8 tecken.'),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: 'Lösenorden matchar inte.',
    path: ['confirm'],
  });

export interface Activation {
  status: ActivationStatus;
  /** Link error detail or inline form error, in Swedish. */
  message: string | null;
  submit: (password: string, confirm: string) => Promise<void>;
}

export function useActivation(): Activation {
  const { session, initializing, updatePassword } = useAuth();
  const [status, setStatus] = useState<ActivationStatus>('resolving');
  const [message, setMessage] = useState<string | null>(null);

  // Guards the one-shot URL consumption against React 18/19 StrictMode's
  // double-invoked mount effect, and tells the session-watch effect below to
  // stay in `resolving` while `setSession` is still in flight.
  const startedRef = useRef(false);
  const consumingHashRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const link = parseActivationLink();

    if (link.hasError) {
      setStatus('link-error');
      setMessage(activationLinkErrorMessage(link));
      return;
    }

    // Admin invite: implicit-grant hash the PKCE client will not consume.
    if (link.accessToken && link.refreshToken) {
      consumingHashRef.current = true;
      const accessToken = link.accessToken;
      const refreshToken = link.refreshToken;
      void (async () => {
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error || !data.session) {
            setStatus('link-error');
            setMessage(
              'Inbjudningslänken kunde inte verifieras. Be en administratör skicka en ny inbjudan.',
            );
            return;
          }
          setStatus('ready');
        } finally {
          consumingHashRef.current = false;
          stripActivationParamsFromUrl();
        }
      })();
      return;
    }

    // PKCE `?code=` recovery link or a storage-restored session: `supabase-js`
    // runs `detectSessionInUrl` at import time and strips `?code=` itself, so
    // there is nothing to consume here — the effect below promotes to `ready`
    // once AuthProvider reports the session.
  }, []);

  useEffect(() => {
    setStatus((current) => {
      // Never walk back out of a terminal / in-progress state.
      if (
        current === 'submitting' ||
        current === 'success' ||
        current === 'link-error'
      ) {
        return current;
      }
      if (consumingHashRef.current) return 'resolving';
      if (session) return 'ready';
      if (initializing) return 'resolving';
      return 'no-session';
    });
  }, [session, initializing]);

  const submit = useCallback(
    async (password: string, confirm: string) => {
      setMessage(null);

      const parsed = activationPasswordSchema.safeParse({ password, confirm });
      if (!parsed.success) {
        setMessage(parsed.error.issues[0]?.message ?? 'Ogiltigt lösenord.');
        return;
      }

      setStatus('submitting');
      const { error } = await updatePassword(parsed.data.password);
      if (error) {
        setStatus('ready');
        setMessage('Kunde inte spara lösenordet. Försök igen.');
        return;
      }

      setStatus('success');
    },
    [updatePassword],
  );

  return { status, message, submit };
}
