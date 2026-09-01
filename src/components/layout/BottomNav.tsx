import { NavLink } from 'react-router-dom';
import { BAR_ITEMS, CENTER_ITEM } from '@/config/navigation';
import styles from './BottomNav.module.css';

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Mobile primary navigation. Five destinations with the log action elevated
 * in the centre. Hidden on desktop (the rail replaces it).
 */
export function BottomNav() {
  const left = BAR_ITEMS.slice(0, 2);
  const right = BAR_ITEMS.slice(2);
  const CenterIcon = CENTER_ITEM.icon;

  return (
    <nav className={styles.nav} aria-label="Huvudnavigation">
      <div className={styles.row}>
        {left.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end ?? false}
            className={({ isActive }) => cx(styles.link, isActive && styles.active)}
          >
            <item.icon className={styles.icon} />
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        ))}

        <NavLink
          to={CENTER_ITEM.path}
          className={() => cx(styles.centerWrap)}
        >
          {({ isActive }) => (
            <>
              <span
                className={cx(styles.center, isActive && styles.centerActive)}
              >
                <CenterIcon className={styles.centerIcon} />
              </span>
              <span className={styles.centerLabel}>{CENTER_ITEM.label}</span>
            </>
          )}
        </NavLink>

        {right.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end ?? false}
            className={({ isActive }) => cx(styles.link, isActive && styles.active)}
          >
            <item.icon className={styles.icon} />
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
