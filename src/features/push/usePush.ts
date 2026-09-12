import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disablePush,
  enablePush,
  hasActivePushSubscription,
  isPushSupported,
  notificationPermission,
  sendSelfTestPush,
} from './push-api';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferencesPatch,
} from './preferences-api';

const preferencesKey = (challengeId: string) =>
  ['notification-preferences', challengeId] as const;

/** Subscription state + actions for the Profil → Notiser card. */
export function usePushSubscription() {
  const [permission, setPermission] = useState(notificationPermission());
  const activeQuery = useQuery({
    queryKey: ['push-subscription-active'],
    queryFn: hasActivePushSubscription,
    staleTime: 10_000,
    retry: false,
  });

  const refreshPermission = useCallback(() => {
    setPermission(notificationPermission());
  }, []);

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: () => {
      refreshPermission();
      void activeQuery.refetch();
    },
  });

  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      void activeQuery.refetch();
    },
  });

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  return {
    supported: isPushSupported(),
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
