import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyWeightEntries,
  fetchMyWeightProfile,
  fetchWeightFinalResult,
  fetchWeightPublicRanking,
  logWeightEntry,
  setStartWeight,
  setWeightHidden,
} from './weight-api';

/**
 * TanStack Query bindings for Weight Tracking. All reads are defensive
 * (`retry: false`, `throwOnError: false`) so a weight failure renders inline in
 * the Profile weight section and never replaces ProfilePage. A privacy toggle
 * or a new entry invalidates the ranking too — the toggling user may now
 * appear/disappear from it on their own next read.
 */

const PROFILE = ['weight', 'profile'] as const;
const ENTRIES = ['weight', 'entries'] as const;
const RANKING = ['weight', 'ranking'] as const;
const FINAL = ['weight', 'final'] as const;

export const weightKeys = {
  profile: (challengeId: string, userId: string) =>
    [...PROFILE, challengeId, userId] as const,
  profileRoot: (challengeId: string) => [...PROFILE, challengeId] as const,
  entries: (challengeId: string, userId: string) =>
    [...ENTRIES, challengeId, userId] as const,
  entriesRoot: (challengeId: string) => [...ENTRIES, challengeId] as const,
  ranking: (challengeId: string) => [...RANKING, challengeId] as const,
  final: (challengeId: string) => [...FINAL, challengeId] as const,
};

export function useMyWeightProfile(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: weightKeys.profile(challengeId ?? '', userId ?? ''),
    enabled: challengeId !== null && userId !== null,
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challengeId och userId krävs.');
      }
      return fetchMyWeightProfile(challengeId, userId);
    },
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
}

export function useMyWeightEntries(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: weightKeys.entries(challengeId ?? '', userId ?? ''),
    enabled: challengeId !== null && userId !== null,
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challengeId och userId krävs.');
      }
      return fetchMyWeightEntries(challengeId, userId);
    },
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
}

export function useWeightPublicRanking(challengeId: string | null) {
  return useQuery({
    queryKey: weightKeys.ranking(challengeId ?? ''),
    enabled: challengeId !== null,
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchWeightPublicRanking(challengeId);
    },
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });
}

export function useWeightFinalResult(challengeId: string | null) {
  return useQuery({
    queryKey: weightKeys.final(challengeId ?? ''),
    enabled: challengeId !== null,
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchWeightFinalResult(challengeId);
    },
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });
}

interface StartWeightVars {
  challengeId: string;
  weightKg: number;
}

export function useSetStartWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: StartWeightVars) =>
      setStartWeight(vars.challengeId, vars.weightKg),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: weightKeys.profileRoot(vars.challengeId),
      });
    },
  });
}

interface LogEntryVars {
  challengeId: string;
  weightKg: number;
}

export function useLogWeightEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: LogEntryVars) =>
      logWeightEntry(vars.challengeId, vars.weightKg),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: weightKeys.entriesRoot(vars.challengeId),
      });
      void queryClient.invalidateQueries({
        queryKey: weightKeys.ranking(vars.challengeId),
      });
    },
  });
}

interface HiddenVars {
  challengeId: string;
  hidden: boolean;
}

export function useSetWeightHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: HiddenVars) =>
      setWeightHidden(vars.challengeId, vars.hidden),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: weightKeys.profileRoot(vars.challengeId),
      });
      void queryClient.invalidateQueries({
        queryKey: weightKeys.ranking(vars.challengeId),
      });
    },
  });
}
