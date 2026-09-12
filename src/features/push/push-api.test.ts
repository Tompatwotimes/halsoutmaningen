import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();
const detectPushCapabilityMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpc(fn, args) },
}));
vi.mock('@/lib/env', () => ({
  env: { webPushVapidPublicKey: 'BFakeVapidPublicKeyBase64Url' },
}));
vi.mock('./capability', () => ({
  detectPushCapability: detectPushCapabilityMock,
}));

import {
  disablePush,
  enablePush,
  hasActivePushSubscription,
  notificationPermission,
  PushError,
} from './push-api';

afterEach(() => {
  vi.unstubAllGlobals();
  rpc.mockReset();
  detectPushCapabilityMock.mockReset();
});

describe('notificationPermission', () => {
  it('reports "unsupported" when Notification does not exist', () => {
    vi.stubGlobal('Notification', undefined);
    expect(notificationPermission()).toBe('unsupported');
  });

  it('reports the current permission otherwise', () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    expect(notificationPermission()).toBe('granted');
  });
});

function makeSubscription(overrides: Partial<PushSubscription> = {}) {
  return {
    endpoint: 'https://push.example/ep1',
    toJSON: () => ({ keys: { p256dh: 'p256', auth: 'auth' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as PushSubscription;
}

describe('enablePush', () => {
  beforeEach(() => {
    detectPushCapabilityMock.mockResolvedValue('supported');
    vi.stubGlobal('window', {});
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
  });

  it('throws when push capability detection says unsupported', async () => {
    detectPushCapabilityMock.mockResolvedValue('unsupported');
    vi.stubGlobal('navigator', {});
    await expect(enablePush()).rejects.toThrow(PushError);
  });

  it('throws a distinct message when capability detection itself errors (never mislabels as unsupported)', async () => {
    detectPushCapabilityMock.mockResolvedValue('error');
    vi.stubGlobal('navigator', {});
    await expect(enablePush()).rejects.toThrow(/Kunde inte kontrollera stöd/);
  });

  it('throws when the user denies permission', async () => {
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });
    vi.stubGlobal('navigator', { serviceWorker: {} });
    await expect(enablePush()).rejects.toThrow('tillåta notiser');
  });

  it('subscribes and registers the subscription server-side', async () => {
    const subscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    };
    const registration = { pushManager };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve(registration),
        register: vi.fn().mockResolvedValue(registration),
      },
      userAgent: 'test-agent',
    });
    rpc.mockResolvedValue({ data: {}, error: null });

    await enablePush();

    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(rpc).toHaveBeenCalledWith('register_push_subscription', {
      p_endpoint: 'https://push.example/ep1',
      p_p256dh: 'p256',
      p_auth_key: 'auth',
      p_user_agent: 'test-agent',
    });
  });

  it('reuses an existing subscription instead of creating a second one', async () => {
    const subscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn(),
    };
    const registration = { pushManager };
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve(registration) },
      userAgent: 'test-agent',
    });
    rpc.mockResolvedValue({ data: {}, error: null });

    await enablePush();

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
  });

  it('throws a PushError when the server rejects the subscription', async () => {
    const subscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(subscription),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager }) },
      userAgent: 'test-agent',
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(enablePush()).rejects.toThrow('db down');
  });
});

describe('disablePush', () => {
  it('unsubscribes and unregisters when a subscription exists', async () => {
    const subscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(subscription),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({ pushManager }),
      },
    });
    rpc.mockResolvedValue({ data: null, error: null });

    await disablePush();

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('unregister_push_subscription', {
      p_endpoint: 'https://push.example/ep1',
    });
  });

  it('is a silent no-op when there is no registration', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue(null) },
    });
    await expect(disablePush()).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is a silent no-op when there is no active subscription', async () => {
    const pushManager = { getSubscription: vi.fn().mockResolvedValue(null) };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({ pushManager }),
      },
    });
    await expect(disablePush()).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('hasActivePushSubscription', () => {
  it('is true when a subscription exists', async () => {
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(makeSubscription()),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({ pushManager }),
      },
    });
    expect(await hasActivePushSubscription()).toBe(true);
  });

  it('is false without a service worker registration', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue(null) },
    });
    expect(await hasActivePushSubscription()).toBe(false);
  });
});
