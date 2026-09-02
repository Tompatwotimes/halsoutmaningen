import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useActivation } from './useActivation';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { BrandMark } from '@/components/layout/BrandMark';
import styles from './LoginPage.module.css';

/** Delay before the success state hands the now-authenticated user to the app. */
const SUCCESS_REDIRECT_MS = 1500;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.brand}>
        <BrandMark className={styles.brandMark} />
        <span className={styles.brandName}>Hälsoutmaningen</span>
      </div>
      <div className={styles.card}>{children}</div>
    </div>
  );
}

/**
 * Landing page for the Supabase invite / password-reset email link.
 *
 * The link arrives as an implicit-grant hash (admin invite) or a PKCE `?code=`
 * (password reset); `useActivation` resolves either into an authenticated
 * session, then the user explicitly chooses a password via
 * `supabase.auth.updateUser({ password })` and is sent into the app. This route
 * is public and never wrapped in `RequireAuth`, so nothing redirects away while
 * the session is being established.
 */
export function ActivateAccountPage() {
  const { status, message, submit } = useActivation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (status !== 'success') return;
    const timer = setTimeout(() => {
      void navigate('/', { replace: true });
    }, SUCCESS_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [status, navigate]);

  if (status === 'resolving') {
    return (
      <Frame>
        <Spinner label="Öppnar din inbjudan…" />
      </Frame>
    );
  }

  if (status === 'link-error' || status === 'no-session') {
    return (
      <Frame>
        <div className={styles.header}>
          <h1>Länken fungerar inte</h1>
          <p>
            {message ??
              'Öppna den här sidan via länken i din inbjudan eller i mejlet för att återställa lösenordet. Länken kan också ha gått ut.'}
          </p>
        </div>
        <Link to="/logga-in" className={styles.footLink}>
          Till inloggningen
        </Link>
      </Frame>
    );
  }

  if (status === 'success') {
    return (
      <Frame>
        <div className={styles.header}>
          <h1>Kontot är aktiverat</h1>
          <p>Ditt lösenord är sparat.</p>
        </div>
        <p className={styles.notice} role="status">
          Klart! Du skickas vidare till appen.
        </p>
        <Button
          size="lg"
          fullWidth
          onClick={() => void navigate('/', { replace: true })}
        >
          Fortsätt till appen
        </Button>
      </Frame>
    );
  }

  const submitting = status === 'submitting';

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    void submit(password, confirm);
  }

  return (
    <Frame>
      <div className={styles.header}>
        <h1>Välj ett lösenord</h1>
        <p>Sätt ett lösenord för att aktivera ditt konto.</p>
      </div>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="password">Välj lösenord</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="confirm">Bekräfta lösenord</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </div>
        {message && (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Aktivera konto
        </Button>
      </form>
    </Frame>
  );
}
