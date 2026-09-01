import { useAuth } from './useAuth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import styles from './LoginPage.module.css';

/**
 * Shown when the authenticated user's profile is `active = false`. Their data
 * is preserved; they simply cannot use the app until an admin reactivates them.
 */
export function AccountInactiveNotice() {
  const { signOut } = useAuth();

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <h1>Kontot är pausat</h1>
          <p>
            Ditt konto är inaktiverat just nu. Kontakta en administratör om du
            tror att det är ett misstag.
          </p>
        </div>
        <Button fullWidth variant="secondary" onClick={() => void signOut()}>
          Logga ut
        </Button>
      </Card>
    </div>
  );
}
