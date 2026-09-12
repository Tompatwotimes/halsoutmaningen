import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { webPushVapidPublicKey: 'BFakeVapidPublicKeyBase64Url' },
}));

import { detectPushCapability, getPushDiagnostics } from './capability';

function stubBaseGlobals(
  overrides: {
    isSecureContext?: boolean;
    hasServiceWorker?: boolean;
    hasNotification?: boolean;
  } = {},
) {
  const {
    isSecureContext = true,
    hasServiceWorker = true,
    hasNotification = true,
  } = overrides;

  vi.stubGlobal('window', {
    isSecureContext,
    matchMedia: (query: string) => ({ matches: !query.includes('standalone') }),
    // Deliberately no `PushManager` key at all — WebKit does not reliably
    // expose a global constructor (setting it to `undefined` would still
    // make `'PushManager' in window` true, which defeats the point).
  });
  if (hasNotification) {
    vi.stubGlobal('Notification', {
      permission: 'default' as NotificationPermission,
    });
  } else {
    vi.stubGlobal('Notification', undefined);
  }
  if (!hasServiceWorker) {
    vi.stubGlobal('navigator', { userAgent: 'test' });
  }
}

/** A registration whose pushManager exists ONLY as a property — no global window.PushManager. */
function makeRegistrationWithPushManager() {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectPushCapability — the exact iOS regression this replaces', () => {
  it('REGRESSION: resolves "supported" via registration.pushManager even when window.PushManager is absent (real iOS Home Screen behaviour)', async () => {
    stubBaseGlobals();
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });
    // Sanity: this is exactly the condition the OLD `'PushManager' in window`
    // check relied on, and it is false here — proving the fix does not need it.
    expect(typeof window !== 'undefined' && 'PushManager' in window).toBe(
      false,
    );

    await expect(detectPushCapability()).resolves.toBe('supported');
  });

  it('REGRESSION: first launch after install — getRegistration() returns null, .ready resolves shortly after — still "supported"', async () => {
    stubBaseGlobals();
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(null),
        ready: Promise.resolve(registration),
      },
    });

    await expect(detectPushCapability()).resolves.toBe('supported');
  });

  it('a supported desktop/Android-style browser (would also have window.PushManager, but detection does not depend on it) resolves "supported"', async () => {
    stubBaseGlobals();
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    await expect(detectPushCapability()).resolves.toBe('supported');
  });

  it('a genuinely unsupported browser (no ServiceWorker API at all) resolves "unsupported" without waiting', async () => {
    stubBaseGlobals({ hasServiceWorker: false });
    await expect(detectPushCapability()).resolves.toBe('unsupported');
  });

  it('a registration that exists but has no pushManager resolves "unsupported"', async () => {
    stubBaseGlobals();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({}),
        ready: Promise.resolve({}),
      },
    });

    await expect(detectPushCapability()).resolves.toBe('unsupported');
  });

  it('no secure context resolves "unsupported"', async () => {
    stubBaseGlobals({ isSecureContext: false });
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: { getRegistration: vi.fn(), ready: Promise.resolve({}) },
    });
    await expect(detectPushCapability()).resolves.toBe('unsupported');
  });

  it('no Notification API resolves "unsupported"', async () => {
    stubBaseGlobals({ hasNotification: false });
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: { getRegistration: vi.fn(), ready: Promise.resolve({}) },
    });
    await expect(detectPushCapability()).resolves.toBe('unsupported');
  });

  it('permission "denied" with a real pushManager resolves "permission_denied", never "unsupported"', async () => {
    stubBaseGlobals();
    vi.stubGlobal('Notification', {
      permission: 'denied' as NotificationPermission,
    });
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    await expect(detectPushCapability()).resolves.toBe('permission_denied');
  });

  it('permission "granted" with a real pushManager resolves "supported"', async () => {
    stubBaseGlobals();
    vi.stubGlobal('Notification', {
      permission: 'granted' as NotificationPermission,
    });
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    await expect(detectPushCapability()).resolves.toBe('supported');
  });

  it('a registration that never settles resolves "error", never a silent "unsupported"', async () => {
    vi.useFakeTimers();
    stubBaseGlobals();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(null),
        ready: new Promise(() => {
          /* never resolves — simulates a stuck registration */
        }),
      },
    });

    const resultPromise = detectPushCapability();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(resultPromise).resolves.toBe('error');
    vi.useRealTimers();
  });

  it('never calls Notification.requestPermission() itself', async () => {
    stubBaseGlobals();
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', {
      permission: 'default' as NotificationPermission,
      requestPermission,
    });
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    await detectPushCapability();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('getPushDiagnostics', () => {
  it('reports the real capability booleans and never a secret field', async () => {
    stubBaseGlobals();
    vi.stubGlobal('Notification', {
      permission: 'granted' as NotificationPermission,
    });
    const registration = makeRegistrationWithPushManager();
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
        controller: null,
      },
      standalone: true,
    });

    const diagnostics = await getPushDiagnostics();

    expect(diagnostics.secureContext).toBe(true);
    expect(diagnostics.serviceWorkerSupported).toBe(true);
    expect(diagnostics.serviceWorkerRegistrationFound).toBe(true);
    expect(diagnostics.pushManagerOnRegistration).toBe(true);
    expect(diagnostics.globalPushManager).toBe(false);
    expect(diagnostics.notificationPermission).toBe('granted');
    expect(diagnostics.navigatorStandalone).toBe(true);
    expect(diagnostics.standalone).toBe(true);
    expect(diagnostics.currentPushSubscription).toBe(false);

    const keys = Object.keys(diagnostics);
    for (const forbidden of [
      'endpoint',
      'p256dh',
      'auth',
      'key',
      'token',
      'secret',
    ]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});
