import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { RequireAdmin } from '@/features/auth/RequireAdmin';
import { Spinner } from '@/components/ui/Spinner';

// Route-level code splitting. Heavier feature screens (matrix, image upload)
// added later benefit most; the pattern is set here.
const LoginPage = lazy(() =>
  import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const ActivateAccountPage = lazy(() =>
  import('@/features/auth/ActivateAccountPage').then((m) => ({
    default: m.ActivateAccountPage,
  })),
);
const HomePage = lazy(() =>
  import('@/pages/HomePage').then((m) => ({ default: m.HomePage })),
);
const LogPage = lazy(() =>
  import('@/pages/LogPage').then((m) => ({ default: m.LogPage })),
);
const GroupPage = lazy(() =>
  import('@/pages/GroupPage').then((m) => ({ default: m.GroupPage })),
);
const OverviewPage = lazy(() =>
  import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const RankingPage = lazy(() =>
  import('@/pages/RankingPage').then((m) => ({ default: m.RankingPage })),
);
const ProfilePage = lazy(() =>
  import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const AdminPage = lazy(() =>
  import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const ParticipantsPage = lazy(() =>
  import('@/pages/admin/ParticipantsPage').then((m) => ({
    default: m.ParticipantsPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

// DEV-only design-review harness. `import.meta.env.DEV` is statically false in
// production builds, so this route and its imports are tree-shaken away.
const PreviewFrame = lazy(() =>
  import('@/dev/PreviewFrame').then((m) => ({ default: m.PreviewFrame })),
);

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        {import.meta.env.DEV && (
          <Route path="/forhandsvisning" element={<PreviewFrame />}>
            <Route index element={<HomePage />} />
            <Route path="hem" element={<HomePage />} />
            <Route path="logga" element={<LogPage />} />
            <Route path="gruppen" element={<GroupPage />} />
            <Route path="oversikt" element={<OverviewPage />} />
            <Route path="ranking" element={<RankingPage />} />
            <Route path="profil" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        )}
        <Route path="/logga-in" element={<LoginPage />} />
        <Route path="/aktivera" element={<ActivateAccountPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="logga" element={<LogPage />} />
          <Route path="gruppen" element={<GroupPage />} />
          <Route path="oversikt" element={<OverviewPage />} />
          <Route path="ranking" element={<RankingPage />} />
          <Route path="profil" element={<ProfilePage />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/deltagare"
            element={
              <RequireAdmin>
                <ParticipantsPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
