import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { RequireAdmin } from '@/features/auth/RequireAdmin';
import { AppLoading } from '@/components/feedback/AppLoading';

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
const StraffbankenPage = lazy(() =>
  import('@/pages/StraffbankenPage').then((m) => ({
    default: m.StraffbankenPage,
  })),
);
const GameMasterArchivePage = lazy(() =>
  import('@/pages/GameMasterArchivePage').then((m) => ({
    default: m.GameMasterArchivePage,
  })),
);
const AdminPage = lazy(() =>
  import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const ParticipantsPage = lazy(() =>
  import('@/pages/admin/ParticipantsPage').then((m) => ({
    default: m.ParticipantsPage,
  })),
);
const AdminChallengesPage = lazy(() =>
  import('@/pages/admin/ChallengesPage').then((m) => ({
    default: m.ChallengesPage,
  })),
);
const CreateChallengePage = lazy(() =>
  import('@/pages/admin/CreateChallengePage').then((m) => ({
    default: m.CreateChallengePage,
  })),
);
const ChallengeDetailPage = lazy(() =>
  import('@/pages/admin/ChallengeDetailPage').then((m) => ({
    default: m.ChallengeDetailPage,
  })),
);
const AuditPage = lazy(() =>
  import('@/pages/admin/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const RetroactiveRequestsPage = lazy(() =>
  import('@/pages/admin/RetroactiveRequestsPage').then((m) => ({
    default: m.RetroactiveRequestsPage,
  })),
);
const GameMasterPage = lazy(() =>
  import('@/pages/admin/GameMasterPage').then((m) => ({
    default: m.GameMasterPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

// DEV-only design-review harness. The dynamic import sits inside the
// `import.meta.env.DEV` branch so the chunk is dropped from production builds.
const PreviewFrame = import.meta.env.DEV
  ? lazy(() =>
      import('@/dev/PreviewFrame').then((m) => ({ default: m.PreviewFrame })),
    )
  : () => null;

export function AppRoutes() {
  return (
    <Suspense fallback={<AppLoading />}>
      <Routes>
        {import.meta.env.DEV && (
          <Route path="/forhandsvisning" element={<PreviewFrame />}>
            <Route index element={<HomePage />} />
            <Route path="hem" element={<HomePage />} />
            <Route path="logga" element={<LogPage />} />
            <Route path="gruppen" element={<GroupPage />} />
            <Route path="oversikt" element={<OverviewPage />} />
            <Route path="ranking" element={<RankingPage />} />
            <Route path="straffbanken" element={<StraffbankenPage />} />
            <Route path="arkivet" element={<GameMasterArchivePage />} />
            <Route path="profil" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin-utmaningar" element={<AdminChallengesPage />} />
            <Route path="admin-granskningslogg" element={<AuditPage />} />
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
          <Route path="straffbanken" element={<StraffbankenPage />} />
          <Route path="arkivet" element={<GameMasterArchivePage />} />
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
          <Route
            path="admin/utmaningar"
            element={
              <RequireAdmin>
                <AdminChallengesPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/utmaningar/ny"
            element={
              <RequireAdmin>
                <CreateChallengePage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/utmaningar/:challengeId"
            element={
              <RequireAdmin>
                <ChallengeDetailPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/granskningslogg"
            element={
              <RequireAdmin>
                <AuditPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/efterregistreringar"
            element={
              <RequireAdmin>
                <RetroactiveRequestsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/game-master"
            element={
              <RequireAdmin>
                <GameMasterPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
