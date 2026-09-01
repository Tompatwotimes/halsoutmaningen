import { BrandMark } from '@/components/layout/BrandMark';
import styles from './AppLoading.module.css';

/** Full-screen branded splash for the initial auth/session/profile load. */
export function AppLoading({ label = 'Laddar…' }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status">
      <BrandMark className={styles.mark} />
      <span className={styles.bar} aria-hidden="true">
        <span className={styles.fill} />
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
