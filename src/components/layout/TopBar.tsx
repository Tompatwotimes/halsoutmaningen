import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { LogoutIcon } from '@/components/icons';
import styles from './TopBar.module.css';

export function TopBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    await navigate('/logga-in', { replace: true });
  }

  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.brand}>
        <svg
          className={styles.mark}
          viewBox="0 0 64 64"
          aria-hidden="true"
          fill="none"
        >
          <rect width="64" height="64" rx="14" fill="var(--c-surface-raised)" />
          <path
            d="M18 33h6l4-11 7 22 4-14 3 6h5"
            stroke="var(--c-accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Hälsoutmaningen
      </Link>
      <div className={styles.right}>
        {user && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void handleSignOut()}
            aria-label="Logga ut"
          >
            <LogoutIcon />
          </button>
        )}
      </div>
    </header>
  );
}
