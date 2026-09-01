import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import {
  AuthContext,
  type AuthContextValue,
} from '@/features/auth/auth-context';
import { profileQueryKey } from '@/features/profile/useProfile';
import type { Profile } from '@/features/profile/profile-api';
import { SideNav } from '@/components/layout/SideNav';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { SELF_USER_ID } from '@/fixtures/participants';
import shell from '@/components/layout/AppShell.module.css';
import styles from './PreviewFrame.module.css';

/**
 * DEV-ONLY. A design-review harness that renders the real, fixture-driven
 * screens with the app shell but without Supabase auth. Never bundled in a
 * production build (guarded by `import.meta.env.DEV` at the route level).
 */

const FAKE_USER = {
  id: SELF_USER_ID,
  email: 'johan.berg@example.se',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-07-20T10:00:00Z',
} as unknown as User;

const FAKE_SESSION = {
  access_token: 'preview',
  refresh_token: 'preview',
  expires_in: 3600,
  token_type: 'bearer',
  user: FAKE_USER,
} as unknown as Session;

const FAKE_PROFILE: Profile = {
  id: SELF_USER_ID,
  displayName: 'Johan Berg',
  avatarPath: null,
  role: 'admin',
  active: true,
};

const SCREENS = [
  { path: 'hem', label: 'Hem' },
  { path: 'gruppen', label: 'Gruppen' },
  { path: 'logga', label: 'Logga' },
  { path: 'oversikt', label: 'Översikt' },
  { path: 'ranking', label: 'Ranking' },
  { path: 'profil', label: 'Profil' },
  { path: 'admin', label: 'Admin' },
];

function PreviewAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      initializing: false,
      session: FAKE_SESSION,
      user: FAKE_USER,
      signInWithPassword: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve(),
      requestPasswordReset: () => Promise.resolve({ error: null }),
      updatePassword: () => Promise.resolve({ error: null }),
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function PreviewFrame() {
  const queryClient = useQueryClient();
  const location = useLocation();

  useEffect(() => {
    queryClient.setQueryData(profileQueryKey(SELF_USER_ID), FAKE_PROFILE);
  }, [queryClient]);

  const current = location.pathname.split('/').pop() ?? '';

  return (
    <PreviewAuthProvider>
      <div className={styles.banner}>
        <span className={styles.tag}>Förhandsvisning</span>
        <nav className={styles.switcher}>
          {SCREENS.map((s) => (
            <Link
              key={s.path}
              to={`/forhandsvisning/${s.path}`}
              className={current === s.path ? styles.linkActive : styles.link}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className={shell.shell}>
        <SideNav />
        <div className={shell.frame}>
          <TopBar />
          <main className={shell.main}>
            <Outlet />
          </main>
        </div>
        <BottomNav />
      </div>
    </PreviewAuthProvider>
  );
}
