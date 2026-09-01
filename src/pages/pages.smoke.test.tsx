import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { profileQueryKey } from '@/features/profile/useProfile';
import { SELF_USER_ID } from '@/fixtures/participants';
import { HomePage } from './HomePage';
import { GroupPage } from './GroupPage';
import { LogPage } from './LogPage';
import { OverviewPage } from './OverviewPage';
import { RankingPage } from './RankingPage';
import { ProfilePage } from './ProfilePage';

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

describe('participant screens render from fixture data', () => {
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
