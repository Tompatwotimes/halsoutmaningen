import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  usePushSubscriptionMock,
  useInstallPromptMock,
  isIosMock,
  isStandaloneMock,
} = vi.hoisted(() => ({
  usePushSubscriptionMock: vi.fn<() => Record<string, unknown>>(),
  useInstallPromptMock: vi.fn<() => Record<string, unknown>>(),
  isIosMock: vi.fn<() => boolean>(),
  isStandaloneMock: vi.fn<() => boolean>(),
}));

vi.mock('@/features/pwa/install', () => ({
  isIos: () => isIosMock(),
  isStandalone: () => isStandaloneMock(),
}));
vi.mock('@/features/pwa/useInstallPrompt', () => ({
  useInstallPrompt: () => useInstallPromptMock(),
}));
vi.mock('./usePush', () => ({
  usePushSubscription: () => usePushSubscriptionMock(),
  useSendSelfTestPush: () => ({ mutate: vi.fn(), isPending: false }),
  useNotificationPreferences: () => ({ data: undefined }),
  useUpdateNotificationPreferences: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import { NotificationsCard } from './NotificationsCard';

function primePush(over: Partial<Record<string, unknown>> = {}) {
  usePushSubscriptionMock.mockReturnValue({
    supported: true,
    permission: 'default',
    isActive: false,
    isLoading: false,
    enable: { mutate: vi.fn(), isPending: false },
    disable: { mutate: vi.fn(), isPending: false },
    ...over,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsCard — iOS install gating', () => {
  it('never shows the Aktivera button on iOS before install (would poison Notification permission)', () => {
    isIosMock.mockReturnValue(true);
    isStandaloneMock.mockReturnValue(false);
    useInstallPromptMock.mockReturnValue({
      installed: false,
      canPrompt: false,
      promptInstall: vi.fn(),
    });
    primePush();

    render(<NotificationsCard challengeId="c1" />);

    expect(screen.getByText(/Lägg till på hemskärmen/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktivera' }),
    ).not.toBeInTheDocument();
  });

  it('shows the Aktivera button once installed on iOS (standalone)', () => {
    isIosMock.mockReturnValue(true);
    isStandaloneMock.mockReturnValue(true);
    useInstallPromptMock.mockReturnValue({
      installed: true,
      canPrompt: false,
      promptInstall: vi.fn(),
    });
    primePush();

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Aktivera' }),
    ).toBeInTheDocument();
  });

  it('shows the Aktivera button on a non-iOS supported browser regardless of install state', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    useInstallPromptMock.mockReturnValue({
      installed: false,
      canPrompt: true,
      promptInstall: vi.fn(),
    });
    primePush();

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Aktivera' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Installera appen' }),
    ).toBeInTheDocument();
  });

  it('shows an unsupported message on a non-iOS browser without push support', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    useInstallPromptMock.mockReturnValue({
      installed: true,
      canPrompt: false,
      promptInstall: vi.fn(),
    });
    primePush({ supported: false });

    render(<NotificationsCard challengeId="c1" />);

    expect(screen.getByText(/Notiser stöds inte/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktivera' }),
    ).not.toBeInTheDocument();
  });

  it('shows "Stäng av" and the self-test button once a subscription is active', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    useInstallPromptMock.mockReturnValue({
      installed: true,
      canPrompt: false,
      promptInstall: vi.fn(),
    });
    primePush({ permission: 'granted', isActive: true });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Stäng av' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Skicka testnotis' }),
    ).toBeInTheDocument();
  });
});
