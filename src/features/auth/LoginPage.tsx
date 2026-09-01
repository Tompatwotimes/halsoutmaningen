import { useState, type SyntheticEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from './useAuth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import styles from './LoginPage.module.css';

const credentialsSchema = z.object({
  email: z.string().email('Ange en giltig e-postadress'),
  password: z.string().min(1, 'Ange ditt lösenord'),
});

const emailSchema = z.string().email('Ange en giltig e-postadress');

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { session, initializing, signInWithPassword, requestPasswordReset } =
    useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!initializing && session) {
    const state = location.state as LocationState | null;
    return <Navigate to={state?.from?.pathname ?? '/'} replace />;
  }

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ogiltiga uppgifter');
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await signInWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
    setSubmitting(false);

    if (signInError) {
      setError('Fel e-post eller lösenord.');
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setNotice(null);

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Fyll i din e-postadress först, så skickar vi en länk.');
      return;
    }

    setSubmitting(true);
    await requestPasswordReset(parsed.data);
    setSubmitting(false);
    // Always report success — never reveal whether an address has an account.
    setNotice(
      'Om adressen finns hos oss skickas en länk för att välja nytt lösenord.',
    );
  }

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <h1>Hälsoutmaningen</h1>
          <p>Logga in för att fortsätta.</p>
        </div>
        <form
          className={styles.card}
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
        >
          <div className={styles.field}>
            <label htmlFor="email">E-post</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Lösenord</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Loggar in…' : 'Logga in'}
          </Button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => void handleForgotPassword()}
            disabled={submitting}
          >
            Glömt lösenord?
          </button>
        </form>
      </Card>
    </div>
  );
}
