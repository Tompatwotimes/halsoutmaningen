import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  AuthContext,
  type AuthContextValue,
} from '@/features/auth/auth-context';
import { profileQueryKey } from '@/features/profile/useProfile';
import { evaluateParticipant } from '@/domain/liability';
import { currentPlainDateInTimeZone } from '@/domain/time';
import type { DayStateRow } from '@/features/challenge/challenge-api';
import type { RosterMember } from '@/features/challenge/roster-api';
import type { SelfEntry } from '@/features/challenge/types';
import { activeChallenge } from '@/fixtures/challenge';
import { participantFixtures, SELF_USER_ID } from '@/fixtures/participants';
import { buildEntryMap } from '@/fixtures/entries';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAdmin } from '@/features/auth/RequireAdmin';
import { fetchNextGameMasterEvent } from '@/features/game-master/game-master-api';
import {
  fetchRecentChatMessages,
  fetchUnreadCount,
} from '@/features/chat/chat-api';
import { HomePage } from './HomePage';
import { GroupPage } from './GroupPage';
import { LogPage } from './LogPage';
import { OverviewPage } from './OverviewPage';
import { RankingPage } from './RankingPage';
import { ProfilePage } from './ProfilePage';
import { GameMasterArchivePage } from './GameMasterArchivePage';
import { GameMasterPage } from './admin/GameMasterPage';

/**
 * These are integration-ish smoke tests over the real Supabase-backed data
 * layer: only the three API modules that actually call Supabase are mocked
 * (`challenge-api`, `roster-api`, `entries-api`), with canned responses built
 * from the same fixtures the design-preview harness uses. `useChallengeData`,
 * every domain aggregation (`streaks`, `liability`, `membershipState`) and
 * every screen component run for real.
 */

const entryFixtures = buildEntryMap();

function buildRoster(): RosterMember[] {
  return participantFixtures.map((p, i) => ({
    membershipId: `m-${p.userId}`,
    userId: p.userId,
    displayName: p.displayName,
    avatarPath: null,
    role: p.role,
    profileActive: p.profileActive,
    participationStartDate: p.membership.participationStartDate,
    participationEndDate: p.membership.participationEndDate,
    membershipActive: p.membership.active,
    createdAt: new Date(2026, 6, 1 + i).toISOString(),
  }));
}

// Real clock, matching what `useChallengeData` itself computes — avoids the
// friction of faking global timers under Testing Library's `waitFor`/`findBy*`.
const today = currentPlainDateInTimeZone(activeChallenge.timeZone);

function buildDayStateRows(): DayStateRow[] {
  const rows: DayStateRow[] = [];
  for (const p of participantFixtures) {
    const sessionsByDate = new Map(
      [...entryFixtures.values()]
        .filter((e) => e.userId === p.userId)
        .map((e) => [e.date, [e]] as const),
    );
    const evaluation = evaluateParticipant({
      challenge: activeChallenge,
      membership: p.membership,
      currentDate: today,
      sessionsByDate,
    });
    for (const day of evaluation.days) {
      const session = sessionsByDate.get(day.date)?.[0];
      rows.push({
        userId: p.userId,
        challengeDate: day.date,
        state: day.state,
        sessionCount: session ? 1 : 0,
        validSessionCount: session ? 1 : 0,
        totalValidMinutes: session?.durationMinutes ?? 0,
        requiredMinutes: activeChallenge.requiredMinutes,
        requiredSessions: 1,
        minMinutesPerSession: 0,
        penaltyType: null,
        penaltyDisplayName: null,
        penaltyFromUserId: null,
      });
    }
  }
  return rows;
}

function buildSelfEntries(userId: string): SelfEntry[] {
  return [...entryFixtures.values()]
    .filter((e) => e.userId === userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({
      entryId: e.entryId,
      date: e.date,
      sessionSeq: 1,
      durationMinutes: e.durationMinutes,
      activity: e.activity,
      note: e.note,
      hasProof: e.hasProof,
      submittedAt: e.submittedAt,
      status: 'active' as const,
    }));
}

vi.mock('@/features/challenge/challenge-api', () => ({
  fetchMyPrimaryChallenge: vi.fn((userId: string) => {
    const p = participantFixtures.find((f) => f.userId === userId);
    if (!p) return Promise.resolve(null);
    return Promise.resolve({
      challenge: activeChallenge,
      membership: p.membership,
    });
  }),
  fetchDayStates: vi.fn(() => Promise.resolve(buildDayStateRows())),
}));

vi.mock('@/features/challenge/roster-api', () => ({
  fetchChallengeRoster: vi.fn(() => Promise.resolve(buildRoster())),
}));

vi.mock('@/features/challenge/entries-api', () => ({
  fetchSelfEntries: vi.fn((_challengeId: string, userId: string) =>
    Promise.resolve(buildSelfEntries(userId)),
  ),
  fetchDaySessions: vi.fn(() => Promise.resolve([])),
  createProofSignedUrl: vi.fn(() =>
    Promise.resolve('https://example.invalid/signed.jpg'),
  ),
}));

vi.mock('@/features/straffbanken/straffbank-api', () => ({
  fetchEarnedPenalties: vi.fn(() => Promise.resolve([])),
  fetchPenaltyDefinitions: vi.fn(() => Promise.resolve([])),
  fetchPenaltyAssignments: vi.fn(() => Promise.resolve([])),
}));

// Game Master is an isolated, optional subsystem — the shell's Ambush and the
// Arkivet page both read through this adapter. Stub the whole transport: the
// pulse/next-event paths stay silent, the archive returns a couple of frozen
// public events.
vi.mock('@/features/game-master/game-master-api', () => ({
  fetchGameMasterArchive: vi.fn(() =>
    Promise.resolve([
      {
        id: 'gm-2',
        challengeId: 'challenge-1',
        family: 'kassan',
        visibility: 'public',
        subjectUserId: null,
        title: 'KASSAN VÄXER',
        body: 'Gruppen har gemensamt misslyckats ihop till 3 000 kr.',
        severity: 3,
        archive: true,
        startsAt: '2026-09-03T18:00:00Z',
        expiresAt: null,
        status: 'active',
        firstSeenAt: null,
        dismissedAt: null,
      },
      {
        id: 'gm-1',
        challengeId: 'challenge-1',
        family: 'streak_long',
        visibility: 'public',
        subjectUserId: null,
        title: 'STATUS',
        body: 'Någon ligger farligt långt före sin dokumenterade förmåga.',
        severity: 2,
        archive: true,
        startsAt: '2026-09-02T06:00:00Z',
        expiresAt: null,
        status: 'active',
        firstSeenAt: null,
        dismissedAt: null,
      },
    ]),
  ),
  fetchNextGameMasterEvent: vi.fn(() => Promise.resolve(null)),
  requestGameMasterPulse: vi.fn(() => Promise.resolve(null)),
  markGameMasterEventSeen: vi.fn(() => Promise.resolve()),
}));

// Shared chat — the AppShell mounts a floating <ChatBubble/>. Stub the
// transport the same way: the bubble reads the unread count on mount, the
// panel loads messages only once opened.
vi.mock('@/features/chat/chat-api', () => ({
  ChatError: class ChatError extends Error {},
  fetchUnreadCount: vi.fn(() => Promise.resolve(0)),
  fetchRecentChatMessages: vi.fn(() => Promise.resolve([])),
  fetchOlderChatMessages: vi.fn(() => Promise.resolve([])),
  postChatMessage: vi.fn(() => Promise.resolve(null)),
  markChatRead: vi.fn(() => Promise.resolve()),
}));

// `/admin/game-master` (RequireAdmin-gated) needs the active challenge lookup
// the rest of the admin area shares.
vi.mock('@/features/admin/challenges-api', () => {
  const challenges = [activeChallenge];
  const noopRefetch = vi.fn();
  return {
    fetchChallenges: vi.fn(() => Promise.resolve(challenges)),
    useChallenges: () => ({
      data: challenges,
      isLoading: false,
      isError: false,
      refetch: noopRefetch,
    }),
  };
});

// Game Master's own admin surface (settings + run/event observability). Stub
// the hooks directly — the panels only read `.data/.isLoading/.isError/...`
// and `.mutate`, so no real react-query machinery is needed here. `.data` and
// `.refetch` must be REFERENTIALLY STABLE across renders: GameMasterSettingsPanel
// seeds its form from a `useEffect` keyed on `query.data`, so a fresh object/fn
// on every call would re-fire that effect every render and loop forever.
vi.mock('@/features/admin/game-master-admin-api', () => {
  const settings = {
    challengeId: activeChallenge.id,
    enabled: true,
    privateRoastsEnabled: true,
    publicRoastsEnabled: true,
    archiveEnabled: true,
    intensity: 'normal',
  };
  const noRuns: unknown[] = [];
  const noEvents: unknown[] = [];
  const noopRefetch = vi.fn();

  return {
    fetchGameMasterSettings: vi.fn(() => Promise.resolve(settings)),
    fetchGameMasterRuns: vi.fn(() => Promise.resolve(noRuns)),
    fetchRecentGameMasterEvents: vi.fn(() => Promise.resolve(noEvents)),
    updateGameMasterSettings: vi.fn(() => Promise.resolve()),
    cancelGameMasterEvent: vi.fn(() => Promise.resolve()),
    useGameMasterSettings: () => ({
      data: settings,
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: noopRefetch,
    }),
    useGameMasterRuns: () => ({
      data: noRuns,
      isLoading: false,
      isError: false,
      refetch: noopRefetch,
    }),
    useRecentGameMasterEvents: () => ({
      data: noEvents,
      isLoading: false,
      isError: false,
      refetch: noopRefetch,
    }),
    useUpdateGameMasterSettings: () => ({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
    useCancelGameMasterEvent: () => ({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

const auth: AuthContextValue = {
  initializing: false,
  session: { user: { id: SELF_USER_ID } } as AuthContextValue['session'],
  user: { id: SELF_USER_ID, email: 'j@example.se' } as AuthContextValue['user'],
  signInWithPassword: () => Promise.resolve({ error: null }),
  signOut: () => Promise.resolve(),
  requestPasswordReset: () => Promise.resolve({ error: null }),
  updatePassword: () => Promise.resolve({ error: null }),
};

function wrap(
  node: ReactNode,
  options?: { role?: 'admin' | 'participant'; initialEntries?: string[] },
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(profileQueryKey(SELF_USER_ID), {
    id: SELF_USER_ID,
    displayName: 'Johan Berg',
    avatarPath: null,
    role: options?.role ?? 'admin',
    active: true,
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={options?.initialEntries ?? ['/']}>
          {node}
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('participant screens render from mocked Supabase data', () => {
  it('Hem shows the group-today headline', async () => {
    wrap(<HomePage />);
    expect(await screen.findByText(/har tränat idag/i)).toBeInTheDocument();
  });

  it('Gruppen shows the recent-days grid', async () => {
    wrap(<GroupPage />);
    expect(
      await screen.findByLabelText(/Träningsstatus de senaste dagarna/i),
    ).toBeInTheDocument();
  });

  it('Logga shows the duration control and submit', async () => {
    wrap(<LogPage />);
    expect(
      await screen.findByRole('button', { name: /Registrera passet/i }),
    ).toBeInTheDocument();
  });

  it('Översikt renders the matrix with a jump-to-today control', async () => {
    wrap(<OverviewPage />);
    expect(
      await screen.findByRole('button', { name: /Hoppa till idag/i }),
    ).toBeInTheDocument();
  });

  it('Ranking shows the provisional disclaimer', async () => {
    wrap(<RankingPage />);
    expect(await screen.findByText(/Preliminär ordning/i)).toBeInTheDocument();
  });

  it('Profil shows streak stats', async () => {
    wrap(<ProfilePage />);
    await waitFor(() =>
      expect(screen.getByText(/Nuvarande streak/i)).toBeInTheDocument(),
    );
  });

  it('Arkivet renders the chronicle', async () => {
    wrap(<GameMasterArchivePage />);
    expect(await screen.findByText('KASSAN VÄXER')).toBeInTheDocument();
    expect(screen.getByText('STATUS')).toBeInTheDocument();
    // Arkivet is a chronicle, not a feed — no composer, likes or comments.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /gilla|kommentera|svara/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Game Master GM1 — final integration (Task 10)', () => {
  function renderShell(page: ReactNode) {
    return wrap(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={page} />
        </Route>
      </Routes>,
    );
  }

  it('the authenticated shell renders a normal page with no Game Master event and no overlay', async () => {
    renderShell(<HomePage />);
    expect(await screen.findByText(/har tränat idag/i)).toBeInTheDocument();
    // No ambush surface mounted anywhere — no dialog (Sheet ambush) and no
    // "SYSTEMET" micro banner.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Systemmeddelande')).not.toBeInTheDocument();
  });

  it('a Game Master query failure does not replace the page with an error state', async () => {
    vi.mocked(fetchNextGameMasterEvent).mockRejectedValueOnce(
      new Error('boom'),
    );
    renderShell(<HomePage />);
    // The normal page still renders in full …
    expect(await screen.findByText(/har tränat idag/i)).toBeInTheDocument();
    // … and the Game Master surface stays silent rather than showing an
    // error state (GameMasterAmbush uses retry:false + throwOnError:false).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('/admin/game-master is denied to a participant', async () => {
    wrap(
      <Routes>
        <Route path="/" element={<div>Hem</div>} />
        <Route
          path="/admin/game-master"
          element={
            <RequireAdmin>
              <GameMasterPage />
            </RequireAdmin>
          }
        />
      </Routes>,
      { role: 'participant', initialEntries: ['/admin/game-master'] },
    );
    expect(await screen.findByText('Hem')).toBeInTheDocument();
    expect(
      screen.queryByText(/Autonomt överraskningslager/i),
    ).not.toBeInTheDocument();
  });

  it('/admin/game-master renders for an admin', async () => {
    wrap(
      <Routes>
        <Route path="/" element={<div>Hem</div>} />
        <Route
          path="/admin/game-master"
          element={
            <RequireAdmin>
              <GameMasterPage />
            </RequireAdmin>
          }
        />
      </Routes>,
      { role: 'admin', initialEntries: ['/admin/game-master'] },
    );
    expect(
      await screen.findByText(/Autonomt överraskningslager/i),
    ).toBeInTheDocument();
  });
});

describe('Shared chat — AppShell integration (Task 9)', () => {
  function renderShell(page: ReactNode) {
    return wrap(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={page} />
        </Route>
      </Routes>,
    );
  }

  it('mounts the floating chat bubble on the authenticated shell with no panel open', async () => {
    renderShell(<HomePage />);
    expect(await screen.findByText(/har tränat idag/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chatt/i })).toBeInTheDocument();
    // Closed by default — no dialog, no composer.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a chat load failure never replaces the host page with an error state', async () => {
    vi.mocked(fetchUnreadCount).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(fetchRecentChatMessages).mockRejectedValueOnce(new Error('boom'));
    renderShell(<HomePage />);
    expect(await screen.findByText(/har tränat idag/i)).toBeInTheDocument();

    // Opening the panel while its query is failing shows an understated
    // in-panel notice, never a page-level alert.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /chatt/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/har tränat idag/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
