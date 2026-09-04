import { Outlet } from 'react-router-dom';
import { GameMasterAmbush } from '@/features/game-master/GameMasterAmbush';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import styles from './AppShell.module.css';

export function AppShell() {
  return (
    <div className={styles.shell}>
      <SideNav />
      <div className={styles.frame}>
        <TopBar />
        <main className={styles.main}>
          <Outlet />
          {/* Game Master GM1 ambushes. Mounted once inside the authenticated
              shell (never on /logga-in or /aktivera). Isolated and optional —
              a Game Master failure renders nothing and never blocks the app. */}
          <GameMasterAmbush />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
