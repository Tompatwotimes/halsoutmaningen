import { APP_VERSION } from '@/lib/version';
import styles from './AppFooter.module.css';

/**
 * Discreet version marker at the true bottom of a page's own content flow —
 * never sticky/fixed, never a card. Rendered once per surface (inside the
 * authenticated shell's scrollable main, and on the login page), not as a
 * single global singleton, so it always sits after that surface's own last
 * piece of content rather than floating independently of layout changes.
 */
export function AppFooter() {
  return <p className={styles.footer}>Hälsoutmaningen · v{APP_VERSION}</p>;
}
