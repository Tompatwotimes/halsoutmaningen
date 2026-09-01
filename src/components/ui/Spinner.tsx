import styles from './Spinner.module.css';

export function Spinner({ label = 'Laddar…' }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
