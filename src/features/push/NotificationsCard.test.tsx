import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  usePushSubscriptionMock,
  useInstallPromptMock,
  isIosMock,
  isStandaloneMock,
  getPushDiagnosticsMock,
} = vi.hoisted(() => ({
  usePushSubscriptionMock: vi.fn<() => Record<string, unknown>>(),
  useInstallPromptMock: vi.fn<() => Record<string, unknown>>(),
  isIosMock: vi.fn<() => boolean>(),
  isStandaloneMock: vi.fn<() => boolean>(),
  getPushDiagnosticsMock: vi.fn<() => Promise<Record<string, unknown>>>(),
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
vi.mock('./capability', () => ({
  getPushDiagnostics: () => getPushDiagnosticsMock(),
}));

import { NotificationsCard } from './NotificationsCard';

function primePush(over: Partial<Record<string, unknown>> = {}) {
  usePushSubscriptionMock.mockReturnValue({
    capability: 'supported',
    permission: 'default',
    isActive: false,
    isLoading: false,
    enable: { mutate: vi.fn(), isPending: false },
    disable: { mutate: vi.fn(), isPending: false },
    ...over,
  });
}

function primeInstall(over: Partial<Record<string, unknown>> = {}) {
  useInstallPromptMock.mockReturnValue({
    installed: true,
    canPrompt: false,
    promptInstall: vi.fn(),
    ...over,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsCard — iOS platform gate', () => {
  it('never shows the Aktivera button on iOS before install (would poison Notification permission)', () => {
    isIosMock.mockReturnValue(true);
    isStandaloneMock.mockReturnValue(false);
    primeInstall({ installed: false });
    primePush();

    render(<NotificationsCard challengeId="c1" />);

    expect(screen.getByText(/Lägg till på hemskärmen/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktivera' }),
    ).not.toBeInTheDocument();
  });

  it('REGRESSION: shows the Aktivera button on an installed iOS Home Screen app once capability resolves "supported" — even though window.PushManager is never checked here', () => {
    isIosMock.mockReturnValue(true);
    isStandaloneMock.mockReturnValue(true);
    primeInstall({ installed: true });
    primePush({ capability: 'supported' });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Aktivera' }),
    ).toBeInTheDocument();
  });
});

describe('NotificationsCard — explicit async capability states', () => {
  it('shows a neutral checking message, never "unsupported", while capability is still being detected', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush({ capability: 'checking' });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByText(/Kontrollerar stöd för notiser/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/stöds inte/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktivera' }),
    ).not.toBeInTheDocument();
  });

  it('shows a distinct error message (not "unsupported") when capability detection itself fails', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush({ capability: 'error' });

    render(<NotificationsCard challengeId="c1" />);

    expect(screen.getByText(/Kunde inte kontrollera stöd/)).toBeInTheDocument();
    expect(
      screen.queryByText(/stöds inte i den här webbläsaren/),
    ).not.toBeInTheDocument();
  });

  it('shows the unsupported message only once capability conclusively resolves "unsupported"', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush({ capability: 'unsupported' });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByText(/Notiser stöds inte i den här webbläsaren ännu/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aktivera' }),
    ).not.toBeInTheDocument();
  });

  it('shows the management section (not "unsupported") when capability is "permission_denied", with a blocked explanation', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush({ capability: 'permission_denied', permission: 'denied' });

    render(<NotificationsCard challengeId="c1" />);

    expect(screen.getByText(/Blockerade i webbläsaren/)).toBeInTheDocument();
    expect(screen.queryByText(/stöds inte/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktivera' })).toBeDisabled();
  });

  it('shows the Aktivera button on a non-iOS supported browser regardless of install state', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall({ installed: false, canPrompt: true });
    primePush();

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Aktivera' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Installera appen' }),
    ).toBeInTheDocument();
  });

  it('shows "Stäng av" and the self-test button once a subscription is active', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush({ permission: 'granted', isActive: true });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Stäng av' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Skicka testnotis' }),
    ).toBeInTheDocument();
  });

  it('REAL-DEVICE REGRESSION: a supported-but-unsubscribed iOS Home Screen device (capability="supported", isActive=false) shows the Aktivera button, never "Notiser stöds inte"', () => {
    // Mirrors the exact real iPhone diagnostic snapshot that once produced
    // the wrong UI: every capability signal healthy, permission "default",
    // currentPushSubscription false. usePushSubscription() resolves this to
    // capability: 'supported' with isActive: false — the component must
    // render the activation affordance, never the unsupported message.
    isIosMock.mockReturnValue(true);
    isStandaloneMock.mockReturnValue(true);
    primeInstall({ installed: true });
    primePush({
      capability: 'supported',
      permission: 'default',
      isActive: false,
    });

    render(<NotificationsCard challengeId="c1" />);

    expect(
      screen.getByRole('button', { name: 'Aktivera' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Notiser stöds inte/)).not.toBeInTheDocument();
  });
});

describe('NotificationsCard — admin diagnostics panel', () => {
  it('is not rendered for a non-admin', () => {
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush();

    render(<NotificationsCard challengeId="c1" isAdmin={false} />);

    expect(screen.queryByText(/Visa diagnostik/)).not.toBeInTheDocument();
  });

  it('is rendered (collapsed) for an admin, and expands to show capability booleans without secrets', async () => {
    const user = userEvent.setup();
    isIosMock.mockReturnValue(false);
    isStandaloneMock.mockReturnValue(false);
    primeInstall();
    primePush();
    getPushDiagnosticsMock.mockResolvedValue({
      secureContext: true,
      standalone: false,
      navigatorStandalone: null,
      displayModeStandalone: false,
      serviceWorkerSupported: true,
      serviceWorkerRegistrationFound: true,
      serviceWorkerReady: true,
      serviceWorkerControllingPage: true,
      notificationApi: true,
      notificationPermission: 'default',
      pushManagerOnRegistration: true,
      globalPushManager: false,
      currentPushSubscription: false,
    });

    render(<NotificationsCard challengeId="c1" isAdmin />);

    const toggle = screen.getByText(/Visa diagnostik/);
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);

    expect(
      await screen.findByText('pushManagerOnRegistration'),
    ).toBeInTheDocument();
    expect(screen.getByText('secureContext')).toBeInTheDocument();
    expect(screen.queryByText(/endpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/p256dh/i)).not.toBeInTheDocument();
  });
});
