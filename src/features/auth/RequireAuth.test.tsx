import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { useAuthMock, useProfileMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => Record<string, unknown>>(),
  useProfileMock: vi.fn<() => Record<string, unknown>>(),
}));

vi.mock('./useAuth', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/features/profile/useProfile', () => ({
  useProfile: () => useProfileMock(),
}));

import { RequireAuth } from './RequireAuth';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>Skyddat innehåll</div>
            </RequireAuth>
          }
        />
        <Route path="/logga-in" element={<div>Inloggning</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequireAuth', () => {
  it('redirects to the login page when there is no session', () => {
    useAuthMock.mockReturnValue({ initializing: false, session: null });
    useProfileMock.mockReturnValue({ profile: null, isLoading: false });
    renderAt();
    expect(screen.getByText('Inloggning')).toBeInTheDocument();
  });

  it('waits while the initial session lookup runs', () => {
    useAuthMock.mockReturnValue({ initializing: true, session: null });
    useProfileMock.mockReturnValue({ profile: null, isLoading: true });
    renderAt();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders children for an authenticated, active user', () => {
    useAuthMock.mockReturnValue({
      initializing: false,
      session: { user: { id: 'u1' } },
    });
    useProfileMock.mockReturnValue({
      profile: { id: 'u1', active: true },
      isLoading: false,
    });
    renderAt();
    expect(screen.getByText('Skyddat innehåll')).toBeInTheDocument();
  });

  it('blocks a deactivated account with a notice instead of the app', () => {
    useAuthMock.mockReturnValue({
      initializing: false,
      session: { user: { id: 'u2' } },
      signOut: vi.fn(),
    });
    useProfileMock.mockReturnValue({
      profile: { id: 'u2', active: false },
      isLoading: false,
    });
    renderAt();
    expect(screen.queryByText('Skyddat innehåll')).not.toBeInTheDocument();
    expect(screen.getByText('Kontot är pausat')).toBeInTheDocument();
  });
});
