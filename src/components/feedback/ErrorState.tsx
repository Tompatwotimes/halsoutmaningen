import styles from './EmptyState.module.css';
import { Button } from '@/components/ui/Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Något gick fel',
  message = 'Det gick inte att hämta informationen. Försök igen.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={styles.wrap} role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{message}</p>
      {onRetry && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onRetry}>
            Försök igen
          </Button>
        </div>
      )}
    </div>
  );
}
