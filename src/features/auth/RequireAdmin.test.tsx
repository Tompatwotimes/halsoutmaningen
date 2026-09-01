import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { useProfileMock } = vi.hoisted(() => ({
  useProfileMock: vi.fn<
    () => {
      isAdmin: boolean;
      isLoading: boolean;
      isError: boolean;
      refetch: () => void;
    }
  >(),
}));
vi.mock('@/features/profile/useProfile', () => ({
  useProfile: () => useProfileMock(),
}));

import { RequireAdmin } from './RequireAdmin';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<div>Hem</div>} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <div>Admin-innehåll</div>
            </RequireAdmin>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequireAdmin', () => {
  it('shows a loading state while the profile resolves', () => {
    useProfileMock.mockReturnValue({
      isAdmin: false,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Admin-innehåll')).not.toBeInTheDocument();
  });

  it('redirects a participant away from the admin route (fails closed)', () => {
    useProfileMock.mockReturnValue({
      isAdmin: false,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText('Hem')).toBeInTheDocument();
    expect(screen.queryByText('Admin-innehåll')).not.toBeInTheDocument();
  });

  it('does not grant access when the profile lookup errors', () => {
    useProfileMock.mockReturnValue({
      isAdmin: false,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.queryByText('Admin-innehåll')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the admin content for an active admin', () => {
    useProfileMock.mockReturnValue({
      isAdmin: true,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText('Admin-innehåll')).toBeInTheDocument();
  });
});
