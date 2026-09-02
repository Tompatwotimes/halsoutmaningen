import { useMemo, useState, type SyntheticEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from './useAuth';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { BrandMark } from '@/components/layout/BrandMark';
import styles from './LoginPage.module.css';

const passwordSchema = z
  .object({
    password: z.string().min(8, 'Minst 8 tecken'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Lösenorden matchar inte',
    path: ['confirm'],
  });

/**
 * Reads an auth error handed back by Supabase on the redirect URL. Supabase
 * puts these on the hash fragment (implicit flow) or the query string (PKCE):
 * `error`, `error_code`, `error_description`. Returns Swedish copy for the
 * common cases, or `null` when the URL carries no error.
 */
function readAuthLinkError(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code =
    hash.get('error_code') ??
    query.get('error_code') ??
    hash.get('error') ??
    query.get('error');
  const description =
    hash.get('error_description') ?? query.get('error_description');
  if (!code && !description) return null;
  if (code === 'otp_expired' || /expired/i.test(description ?? '')) {
    return 'Länken har gått ut. Be en administratör skicka en ny inbjudan eller en ny återställningslänk.';
  }
  return 'Länken är ogiltig eller har redan använts. Be en administratör skicka en ny.';
}

/**
 * Landing page for the Supabase invite / password-reset email link. The link
 * establishes a session (handled by `detectSessionInUrl`); here the user
 * chooses a password and is sent into the app.
 */
export function ActivateAccountPage() {
  const { session, initializing, updatePassword } = useAuth();
  const linkError = useMemo(readAuthLinkError, []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (initializing) {
    return <Spinner label="Öppnar din inbjudan…" />;
  }

  if (!session) {
    return (
      <div className={styles.wrap}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} />
          <span className={styles.brandName}>Hälsoutmaningen</span>
        </div>
        <div className={styles.card}>
          <div className={styles.header}>
            <h1>Länken fungerar inte</h1>
            <p>
              {linkError ??
                'Öppna den här sidan via länken i din inbjudan eller i mejlet för att återställa lösenordet. Länken kan också ha gått ut.'}
            </p>
          </div>
          <Link to="/logga-in" className={styles.footLink}>
            Till inloggningen
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);

    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ogiltigt lösenord');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await updatePassword(parsed.data.password);
    setSubmitting(false);

    if (updateError) {
      setError('Kunde inte spara lösenordet. Försök igen.');
      return;
    }

    setDone(true);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.brand}>
        <BrandMark className={styles.brandMark} />
        <span className={styles.brandName}>Hälsoutmaningen</span>
      </div>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1>Välj ett lösenord</h1>
          <p>Sätt ett lösenord för att komma igång.</p>
        </div>
        <form
          className={styles.form}
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
        >
          <div className={styles.field}>
            <label htmlFor="password">Nytt lösenord</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="confirm">Upprepa lösenord</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Spara och fortsätt
          </Button>
        </form>
      </div>
    </div>
  );
}
