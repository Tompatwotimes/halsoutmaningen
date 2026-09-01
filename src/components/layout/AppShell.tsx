import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { useProfile } from '@/features/profile/useProfile';
import styles from './AppShell.module.css';

export function AppShell() {
  const { isAdmin } = useProfile();

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav isAdmin={isAdmin} />
    </div>
  );
}
