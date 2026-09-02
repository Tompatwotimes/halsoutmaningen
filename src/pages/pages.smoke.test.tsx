import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
import { HomePage } from './HomePage';
import { GroupPage } from './GroupPage';
import { LogPage } from './LogPage';
import { OverviewPage } from './OverviewPage';
import { RankingPage } from './RankingPage';
import { ProfilePage } from './ProfilePage';

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
    const entriesByDate = new Map(
      [...entryFixtures.values()]
        .filter((e) => e.userId === p.userId)
        .map((e) => [e.date, e] as const),
    );
    const evaluation = evaluateParticipant({
      challenge: activeChallenge,
      membership: p.membership,
      currentDate: today,
      entriesByDate,
    });
    for (const day of evaluation.days) {
      const entry = entriesByDate.get(day.date);
      rows.push({
        userId: p.userId,
        challengeDate: day.date,
        state: day.state,
        entryId: entry?.entryId ?? null,
        durationMinutes: entry?.durationMinutes ?? null,
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
  fetchEntryDetail: vi.fn(() => Promise.resolve(null)),
  createProofSignedUrl: vi.fn(() =>
    Promise.resolve('https://example.invalid/signed.jpg'),
  ),
}));

const auth: AuthContextValue = {
  initializing: false,
  session: { user: { id: SELF_USER_ID } } as AuthContextValue['session'],
  user: { id: SELF_USER_ID, email: 'j@example.se' } as AuthContextValue['user'],
  signInWithPassword: () => Promise.resolve({ error: null }),
  signOut: () => Promise.resolve(),
  requestPasswordReset: () => Promise.resolve({ error: null }),
  updatePassword: () => Promise.resolve({ error: null }),
};

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(profileQueryKey(SELF_USER_ID), {
    id: SELF_USER_ID,
    displayName: 'Johan Berg',
    avatarPath: null,
    role: 'admin',
    active: true,
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>{node}</MemoryRouter>
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
});
