import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchMyProfile, useAuthMock } = vi.hoisted(() => ({
  fetchMyProfile: vi.fn<(id: string) => Promise<unknown>>(),
  useAuthMock:
    vi.fn<() => { user: { id: string } | null; initializing: boolean }>(),
}));

vi.mock('./profile-api', () => ({
  fetchMyProfile: (id: string) => fetchMyProfile(id),
}));
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

import { useProfile } from './useProfile';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProfile', () => {
  it('is not admin and not loading when there is no user', () => {
    useAuthMock.mockReturnValue({ user: null, initializing: false });
    const { result } = renderHook(() => useProfile(), { wrapper });
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(fetchMyProfile).not.toHaveBeenCalled();
  });

  it('derives isAdmin from the database row (role=admin, active)', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, initializing: false });
    fetchMyProfile.mockResolvedValue({
      id: 'u1',
      displayName: 'Chef',
      avatarPath: null,
      role: 'admin',
      active: true,
    });

    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetchMyProfile).toHaveBeenCalledWith('u1');
    expect(result.current.isAdmin).toBe(true);
  });

  it('does not treat a participant row as admin', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u2' }, initializing: false });
    fetchMyProfile.mockResolvedValue({
      id: 'u2',
      displayName: 'Deltagare',
      avatarPath: null,
      role: 'participant',
      active: true,
    });

    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => {
      expect(result.current.profile).not.toBeNull();
    });
    expect(result.current.isAdmin).toBe(false);
  });

  it('does not treat an inactive admin as admin (mirrors is_admin())', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u3' }, initializing: false });
    fetchMyProfile.mockResolvedValue({
      id: 'u3',
      displayName: 'Gammal Chef',
      avatarPath: null,
      role: 'admin',
      active: false,
    });

    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => {
      expect(result.current.profile).not.toBeNull();
    });
    expect(result.current.isAdmin).toBe(false);
  });
});
