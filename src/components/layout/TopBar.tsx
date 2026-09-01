import { Link } from 'react-router-dom';
import { useProfile } from '@/features/profile/useProfile';
import { useAuth } from '@/features/auth/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { BrandMark } from './BrandMark';
import styles from './TopBar.module.css';

/** Mobile-only top bar: brand and a route to the profile via the avatar. */
export function TopBar() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const name = profile?.displayName ?? user?.email ?? 'Profil';

  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.brand}>
        <BrandMark className={styles.mark} />
        <span>Hälsoutmaningen</span>
      </Link>
      <Link to="/profil" className={styles.avatarLink} aria-label="Din profil">
        <Avatar name={name} size="sm" />
      </Link>
    </header>
  );
}
