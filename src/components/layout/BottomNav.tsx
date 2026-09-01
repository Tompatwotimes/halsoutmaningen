import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '@/config/navigation';
import styles from './BottomNav.module.css';

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const items = NAV_ITEMS.filter(
    (item) => item.primary || (item.adminOnly && isAdmin),
  );

  return (
    <nav className={styles.nav} aria-label="Huvudnavigation">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              [styles.link, isActive && styles.active].filter(Boolean).join(' ')
            }
          >
            <Icon />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
