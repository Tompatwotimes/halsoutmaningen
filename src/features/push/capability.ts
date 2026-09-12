import { env } from '@/lib/env';

/**
 * ROOT CAUSE #1 (confirmed on a real iPhone, iOS Home Screen web app):
 *
 *   OLD (src/features/push/push-api.ts, now removed):
 *     export function isPushSupported(): boolean {
 *       return (
 *         typeof navigator !== 'undefined' &&
 *         'serviceWorker' in navigator &&
 *         typeof window !== 'undefined' &&
 *         'PushManager' in window &&              // <-- fails on WebKit
 *         typeof Notification !== 'undefined' &&
 *         Boolean(env.webPushVapidPublicKey)
 *       );
 *     }
 *
 * WebKit exposes Web Push through `ServiceWorkerRegistration.prototype.
 * pushManager`, not a reliable global `window.PushManager`, and the check
 * was purely synchronous (couldn't distinguish "unsupported" from "the
 * service worker hasn't finished registering yet"). Fixed by making
 * detection async (waits for `navigator.serviceWorker.ready`, bounded by a
 * timeout) and checking `'pushManager' in registration` instead of the
 * global.
 *
 * ROOT CAUSE #2 (confirmed on a real iPhone AFTER fix #1, via the admin
 * diagnostics panel this module added): every diagnostic field reported
 * healthy (secureContext, standalone, serviceWorker*, notificationApi,
 * pushManagerOnRegistration all true) yet the UI still showed
 * "Notiser stöds inte i den här webbläsaren ännu." Root cause: this
 * function's own pre-check also required `Boolean(env.webPushVapidPublicKey)`
 * — a value baked in at FRONTEND BUILD TIME from `VITE_WEB_PUSH_VAPID_
 * PUBLIC_KEY`, confirmed absent from Cloudflare's production build
 * variables (no such literal exists anywhere in the shipped bundle) — and
 * folded a missing CONFIGURATION value into the exact same `'unsupported'`
 * result as a genuine BROWSER limitation, with no diagnostic field ever
 * surfacing which one actually happened. That is the client state / UI
 * mapping bug: two entirely different failure classes (platform can't do
 * this vs. we forgot to configure something) were indistinguishable both in
 * the returned state and in the diagnostics panel.
 *
 * Fixed by: (1) splitting the VAPID-key check out of the browser-capability
 * checks entirely — a missing key now resolves `'error'` (an operational
 * problem), never `'unsupported'` (a platform ceiling); (2) adding
 * `vapidPublicKeyConfigured` to the diagnostics so this exact class of bug
 * is visible on the very first read next time, instead of requiring bundle
 * archaeology to find. `currentPushSubscription` was, and remains, NEVER
 * part of the capability predicate — a device that supports push but has no
 * subscription YET is `'supported'`, not `'unsupported'` (see the
 * regression test using this exact real-device diagnostic snapshot).
 */

export type PushCapabilityState =
  'checking' | 'supported' | 'unsupported' | 'permission_denied' | 'error';

export interface PushDiagnostics {
  secureContext: boolean;
  /** Composite: true if EITHER of the two raw standalone signals below is true. */
  standalone: boolean;
  /** iOS Safari's legacy `navigator.standalone` flag. `null` where not applicable. */
  navigatorStandalone: boolean | null;
  /** The standards-based `(display-mode: standalone)` media query. */
  displayModeStandalone: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerRegistrationFound: boolean;
  /** Whether `navigator.serviceWorker.ready` resolved within the timeout. */
  serviceWorkerReady: boolean;
  /** Whether an active service worker already controls THIS page load. */
  serviceWorkerControllingPage: boolean;
  notificationApi: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  /** The real, standards-based check: `'pushManager' in registration`. */
  pushManagerOnRegistration: boolean;
  /** Diagnostic only — WebKit does not reliably expose this; never gate on it. */
  globalPushManager: boolean;
  /**
   * Whether VITE_WEB_PUSH_VAPID_PUBLIC_KEY was baked in at frontend build
   * time. `false` here means an app/deploy misconfiguration, not a browser
   * limitation — this is exactly the field root cause #2 above was missing.
   */
  vapidPublicKeyConfigured: boolean;
  /** NOT part of capability — a supported-but-unsubscribed device is still `'supported'`. */
  currentPushSubscription: boolean;
}

const SW_READY_TIMEOUT_MS = 4000;

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function hasSecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

function hasServiceWorkerSupport(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

function hasNotificationApi(): boolean {
  return typeof Notification !== 'undefined';
}

/**
 * Basic synchronous BROWSER capability pre-checks that can never come back
 * true later if false now — used to bail out of the async wait early for a
 * browser that plainly cannot ever do Web Push (e.g. no ServiceWorker API
 * at all). Deliberately does NOT include the VAPID public key: that is an
 * app configuration value, not a browser capability, and conflating the two
 * is exactly root cause #2 above.
 */
function baseChecksPass(): boolean {
  return (
    hasSecureContext() && hasServiceWorkerSupport() && hasNotificationApi()
  );
}

function hasVapidPublicKey(): boolean {
  return Boolean(env.webPushVapidPublicKey);
}

/**
 * Waits for an existing or in-flight service worker registration, bounded
 * by a timeout. Never registers a new one itself — main.tsx already does
 * that unconditionally on every app load; this only waits for it.
 */
async function waitForRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!hasServiceWorkerSupport()) return null;

  const existing = await navigator.serviceWorker
    .getRegistration()
    .catch(() => null);
  if (existing) return existing;

  return Promise.race([
    navigator.serviceWorker.ready,
    delay<ServiceWorkerRegistration | null>(SW_READY_TIMEOUT_MS, null),
  ]).catch(() => null);
}

/**
 * The authoritative async capability check. Never requests permission —
 * only reads `Notification.permission`. Never throws.
 */
export async function detectPushCapability(): Promise<PushCapabilityState> {
  if (!baseChecksPass()) return 'unsupported';
  if (!hasVapidPublicKey()) {
    // A missing VITE_WEB_PUSH_VAPID_PUBLIC_KEY is OUR deploy configuration
    // being incomplete, not a platform limitation — must never render as
    // "stöds inte i den här webbläsaren" (root cause #2 above).
    return 'error';
  }

  const registration = await waitForRegistration();
  if (!registration) {
    // ServiceWorker API exists but no registration ever became ready within
    // the timeout — a genuine anomaly (e.g. the SW script failed to
    // install), not a platform limitation. Never silently call this
    // "unsupported" — that would misdiagnose a fixable bug as a hard
    // platform ceiling.
    return 'error';
  }
  if (!('pushManager' in registration)) return 'unsupported';

  if (Notification.permission === 'denied') return 'permission_denied';
  return 'supported';
}

/** Full diagnostic snapshot for the admin-only troubleshooting panel. Never includes secrets. */
export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  const secureContext = hasSecureContext();
  const displayModeStandalone =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const rawNavigatorStandalone = (
    navigator as Navigator & { standalone?: boolean }
  ).standalone;
  const navigatorStandalone =
    typeof rawNavigatorStandalone === 'boolean' ? rawNavigatorStandalone : null;
  const standalone = displayModeStandalone || navigatorStandalone === true;

  const serviceWorkerSupported = hasServiceWorkerSupport();
  let registration: ServiceWorkerRegistration | null = null;
  let serviceWorkerReady = false;
  if (serviceWorkerSupported) {
    registration =
      (await navigator.serviceWorker.getRegistration().catch(() => null)) ??
      null;
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      delay<ServiceWorkerRegistration | null>(SW_READY_TIMEOUT_MS, null),
    ]).catch(() => null);
    if (readyRegistration) {
      serviceWorkerReady = true;
      registration ??= readyRegistration;
    }
  }

  const notificationApi = hasNotificationApi();
  const pushManagerOnRegistration = registration
    ? 'pushManager' in registration
    : false;
  const globalPushManager =
    typeof window !== 'undefined' && 'PushManager' in window;

  let currentPushSubscription = false;
  if (registration && pushManagerOnRegistration) {
    const subscription = await registration.pushManager
      .getSubscription()
      .catch(() => null);
    currentPushSubscription = subscription !== null;
  }

  return {
    secureContext,
    standalone,
    navigatorStandalone,
    displayModeStandalone,
    serviceWorkerSupported,
    serviceWorkerRegistrationFound: registration !== null,
    serviceWorkerReady,
    serviceWorkerControllingPage:
      serviceWorkerSupported && navigator.serviceWorker.controller !== null,
    notificationApi,
    notificationPermission: notificationApi
      ? Notification.permission
      : 'unsupported',
    pushManagerOnRegistration,
    globalPushManager,
    vapidPublicKeyConfigured: hasVapidPublicKey(),
    currentPushSubscription,
  };
}
