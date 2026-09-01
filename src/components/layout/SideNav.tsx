import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '@/config/navigation';
import { useProfile } from '@/features/profile/useProfile';
import { useAuth } from '@/features/auth/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { LogoutIcon } from '@/components/icons';
import { BrandMark } from './BrandMark';
import styles from './SideNav.module.css';

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Desktop-only left rail. Shows every destination with a visible label. */
export function SideNav() {
  const { isAdmin, profile } = useProfile();
  const { user, signOut } = useAuth();

  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
  const name = profile?.displayName ?? user?.email ?? 'Profil';

  return (
    <aside className={styles.rail}>
      <NavLink to="/" className={() => cx(styles.brand)} end>
        <BrandMark className={styles.mark} />
        <span>Hälsoutmaningen</span>
      </NavLink>

      <nav className={styles.nav} aria-label="Huvudnavigation">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end ?? false}
            className={({ isActive }) =>
              cx(styles.link, isActive && styles.active)
            }
          >
            <item.icon className={styles.icon} />
            <span>{item.fullLabel ?? item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.foot}>
        <NavLink to="/profil" className={() => cx(styles.account)}>
          <Avatar name={name} size="sm" />
          <span className={styles.accountName}>{name}</span>
        </NavLink>
        <button
          type="button"
          className={styles.signOut}
          onClick={() => void signOut()}
        >
          <LogoutIcon className={styles.icon} />
          <span>Logga ut</span>
        </button>
      </div>
    </aside>
  );
}
