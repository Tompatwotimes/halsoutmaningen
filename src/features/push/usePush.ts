import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disablePush,
  enablePush,
  hasActivePushSubscription,
  notificationPermission,
  sendSelfTestPush,
} from './push-api';
import { detectPushCapability, type PushCapabilityState } from './capability';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferencesPatch,
} from './preferences-api';

const preferencesKey = (challengeId: string) =>
  ['notification-preferences', challengeId] as const;

/**
 * Subscription state + actions for the Profil → Notiser card.
 *
 * `capability` is deliberately an explicit async state
 * (checking/supported/unsupported/permission_denied/error) rather than a
 * synchronous boolean — see src/features/push/capability.ts for why a
 * synchronous `'PushManager' in window` check produced a false
 * "unsupported" on a real installed iOS Home Screen app. The UI must never
 * flash "unsupported" while this is still `'checking'`.
 */
export function usePushSubscription() {
  const [permission, setPermission] = useState(notificationPermission());
  const [capability, setCapability] = useState<PushCapabilityState>('checking');
  const mountedRef = useRef(true);

  const activeQuery = useQuery({
    queryKey: ['push-subscription-active'],
    queryFn: hasActivePushSubscription,
    staleTime: 10_000,
    retry: false,
  });

  const refreshPermission = useCallback(() => {
    setPermission(notificationPermission());
  }, []);

  const refreshCapability = useCallback(() => {
    setCapability('checking');
    void detectPushCapability().then((result) => {
      if (mountedRef.current) setCapability(result);
    });
  }, []);

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: () => {
      refreshPermission();
      refreshCapability();
      void activeQuery.refetch();
    },
    onError: () => {
      refreshPermission();
      refreshCapability();
    },
  });

  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      void activeQuery.refetch();
    },
  });

  useEffect(() => {
    mountedRef.current = true;
    refreshPermission();
    refreshCapability();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshPermission, refreshCapability]);

  return {
    capability,
    permission,
    isActive: activeQuery.data ?? false,
    isLoading: activeQuery.isLoading,
    enable,
    disable,
  };
}

export function useSendSelfTestPush() {
  return useMutation({ mutationFn: sendSelfTestPush });
}

export function useNotificationPreferences(challengeId: string | null) {
  return useQuery({
    queryKey: preferencesKey(challengeId ?? ''),
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchNotificationPreferences(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationPreferences(challengeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPreferencesPatch) => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return updateNotificationPreferences(challengeId, patch);
    },
    onSuccess: (data) => {
      if (challengeId !== null) {
        queryClient.setQueryData(preferencesKey(challengeId), data);
      }
    },
  });
}
