import { Outlet } from 'react-router-dom';
import { GameMasterAmbush } from '@/features/game-master/GameMasterAmbush';
import { ChatBubble } from '@/features/chat/ChatBubble';
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
          {/* Shared chat. A floating entry point — deliberately NOT a sixth
              bottom-nav item, so the five-item nav is untouched. Renders
              nothing until there is a challenge and a signed-in user; a chat
              failure never blocks the shell. */}
          <ChatBubble />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
