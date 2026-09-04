import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchGameMasterArchive,
  fetchNextGameMasterEvent,
  markGameMasterEventSeen,
  requestGameMasterPulse,
} from './game-master-api';

/**
 * TanStack Query bindings for Game Master GM1.
 *
 * Every read here is defensive: `retry: false` + `throwOnError: false` so a
 * Game Master query failure never bubbles to the app-level `ErrorBoundary` and
 * never replaces the normal page with an error state. Game Master is optional
 * (spec §2) — if it is down, the app renders exactly as if there were no event.
 */

export const gameMasterKeys = {
  nextEvent: (challengeId: string, userId: string) =>
    ['game-master', 'next-event', challengeId, userId] as const,
  archive: (challengeId: string) =>
    ['game-master', 'archive', challengeId] as const,
};

const NEXT_EVENT_ROOT = ['game-master', 'next-event'] as const;

/** The one unseen/undismissed active event for the current user, if any. */
export function useNextGameMasterEvent(
  challengeId: string | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: gameMasterKeys.nextEvent(challengeId ?? '', userId ?? ''),
    queryFn: () => {
      if (challengeId === null || userId === null) {
        throw new Error('challengeId och userId krävs.');
      }
      return fetchNextGameMasterEvent(challengeId, userId);
    },
    enabled: challengeId !== null && userId !== null,
    staleTime: 15_000,
    retry: false,
    // A Game Master failure must never break the page it is mounted on.
    throwOnError: false,
  });
}

/** The public chronicle for a challenge (Arkivet). */
export function useGameMasterArchive(challengeId: string | null) {
  return useQuery({
    queryKey: gameMasterKeys.archive(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchGameMasterArchive(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
}

/**
 * Best-effort pulse request. Use `.mutate(challengeId)` (never `.mutateAsync`)
 * from a caller that does not await it — `.mutate` never throws, so a Game
 * Master failure stays contained. On a real emission the next-event query is
 * refreshed so the ambush can appear.
 */
export function useRequestGameMasterPulse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (challengeId: string) => requestGameMasterPulse(challengeId),
    onSuccess: (eventId) => {
      if (eventId) {
        void queryClient.invalidateQueries({ queryKey: NEXT_EVENT_ROOT });
      }
    },
  });
}

/** Mark the current user's view of an event (optionally dismissing it). */
export function useMarkGameMasterEventSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventId: string; dismiss: boolean }) =>
      markGameMasterEventSeen(vars.eventId, vars.dismiss),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NEXT_EVENT_ROOT });
    },
  });
}

/**
 * Fire at most one best-effort pulse per browser session per challenge, when
 * the authenticated app first becomes active. Server-side throttling is
 * authoritative; the `sessionStorage` guard just avoids needless noise. Never
 * throws — a missing/blocked `sessionStorage` still fires exactly one pulse.
 */
export function requestSessionStartPulse(challengeId: string): void {
  if (!challengeId) return;
  const key = `gm-session-pulse:${challengeId}`;
  try {
    if (sessionStorage.getItem(key) !== null) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode / non-browser) — fall through.
  }
  void requestGameMasterPulse(challengeId).catch(() => undefined);
}
