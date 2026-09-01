import { useState, type SyntheticEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from './useAuth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
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
 * Landing page for the Supabase invite / password-reset email link. The link
 * establishes a session (handled by `detectSessionInUrl`); here the user
 * chooses a password and is sent into the app.
 */
export function ActivateAccountPage() {
  const { session, initializing, updatePassword } = useAuth();
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
        <Card className={styles.card}>
          <div className={styles.header}>
            <h1>Länken fungerar inte</h1>
            <p>
              Inbjudnings- eller återställningslänken är ogiltig eller har gått
              ut. Be en administratör skicka en ny.
            </p>
          </div>
          <Link to="/logga-in">Till inloggningen</Link>
        </Card>
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
      <Card className={styles.card}>
        <div className={styles.header}>
          <h1>Välj ett lösenord</h1>
          <p>Sätt ett lösenord för att komma igång med Hälsoutmaningen.</p>
        </div>
        <form
          className={styles.card}
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
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Sparar…' : 'Spara och fortsätt'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
