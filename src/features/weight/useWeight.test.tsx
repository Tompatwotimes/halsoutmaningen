import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  setStartWeight,
  logWeightEntry,
  setWeightHidden,
  fetchMyWeightProfile,
  fetchMyWeightEntries,
  fetchWeightPublicRanking,
  fetchWeightFinalResult,
} = vi.hoisted(() => ({
  setStartWeight: vi.fn(),
  logWeightEntry: vi.fn(),
  setWeightHidden: vi.fn(),
  fetchMyWeightProfile: vi.fn(),
  fetchMyWeightEntries: vi.fn(),
  fetchWeightPublicRanking: vi.fn(),
  fetchWeightFinalResult: vi.fn(),
}));

vi.mock('./weight-api', () => ({
  WeightError: class WeightError extends Error {},
  setStartWeight,
  logWeightEntry,
  setWeightHidden,
  fetchMyWeightProfile,
  fetchMyWeightEntries,
  fetchWeightPublicRanking,
  fetchWeightFinalResult,
}));

import {
  weightKeys,
  useLogWeightEntry,
  useMyWeightEntries,
  useMyWeightProfile,
  useSetStartWeight,
  useSetWeightHidden,
  useWeightPublicRanking,
} from './useWeight';

afterEach(() => vi.clearAllMocks());

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

describe('weight queries — enabled gating', () => {
  it('useMyWeightProfile does not fetch without both ids', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useMyWeightProfile(null, 'u1'), { wrapper });
    renderHook(() => useMyWeightProfile('c1', null), { wrapper });
    expect(fetchMyWeightProfile).not.toHaveBeenCalled();
  });

  it('useMyWeightEntries does not fetch without both ids', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useMyWeightEntries('c1', null), { wrapper });
    expect(fetchMyWeightEntries).not.toHaveBeenCalled();
  });

  it('useWeightPublicRanking does not fetch without a challenge id', () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useWeightPublicRanking(null), { wrapper });
    expect(fetchWeightPublicRanking).not.toHaveBeenCalled();
  });

  it('useMyWeightProfile fetches once both ids are present', async () => {
    fetchMyWeightProfile.mockResolvedValue(null);
    const { wrapper } = makeWrapper();
    renderHook(() => useMyWeightProfile('c1', 'u1'), { wrapper });
    await waitFor(() =>
      expect(fetchMyWeightProfile).toHaveBeenCalledWith('c1', 'u1'),
    );
  });
});

describe('weight mutations — cache invalidation', () => {
  it('useSetStartWeight invalidates the profile query', async () => {
    setStartWeight.mockResolvedValue({});
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useSetStartWeight(), { wrapper });
    result.current.mutate({ challengeId: 'c1', weightKg: 80 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({
      queryKey: weightKeys.profileRoot('c1'),
    });
  });

  it('useSetWeightHidden invalidates BOTH the profile and the ranking', async () => {
    setWeightHidden.mockResolvedValue(undefined);
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useSetWeightHidden(), { wrapper });
    result.current.mutate({ challengeId: 'c1', hidden: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({
      queryKey: weightKeys.profileRoot('c1'),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: weightKeys.ranking('c1') });
  });

  it('useLogWeightEntry invalidates BOTH the entries and the ranking', async () => {
    logWeightEntry.mockResolvedValue({});
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => useLogWeightEntry(), { wrapper });
    result.current.mutate({ challengeId: 'c1', weightKg: 79 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({
      queryKey: weightKeys.entriesRoot('c1'),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: weightKeys.ranking('c1') });
  });
});
