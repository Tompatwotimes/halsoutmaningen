import { useAuth } from './useAuth';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/layout/BrandMark';
import styles from './LoginPage.module.css';

/**
 * Shown when the authenticated user's profile is `active = false`. Their data
 * is preserved; they simply cannot use the app until an admin reactivates them.
 */
export function AccountInactiveNotice() {
  const { signOut } = useAuth();

  return (
    <div className={styles.wrap}>
      <div className={styles.brand}>
        <BrandMark className={styles.brandMark} />
        <span className={styles.brandName}>Hälsoutmaningen</span>
      </div>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1>Kontot är pausat</h1>
          <p>
            Ditt konto är inaktiverat just nu. All din historik finns kvar.
            Kontakta en administratör om du tror att det är ett misstag.
          </p>
        </div>
        <Button fullWidth variant="secondary" onClick={() => void signOut()}>
          Logga ut
        </Button>
      </div>
    </div>
  );
}
