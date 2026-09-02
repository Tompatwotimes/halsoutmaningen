import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import styles from './ConfirmSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  disabled?: boolean;
  /** Optional extra content (e.g. a mandatory reason input). */
  children?: ReactNode;
}

/** A consistent confirm dialog for consequential admin actions. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Avbryt',
  danger = false,
  loading = false,
  error,
  onConfirm,
  disabled = false,
  children,
}: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className={styles.body}>{body}</div>
      {children}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={loading}
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
