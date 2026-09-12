import { env } from '@/lib/env';

/**
 * ROOT CAUSE (confirmed on a real iPhone, iOS Home Screen web app):
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
 *   NotificationsCard.tsx then collapsed straight to this synchronous
 *   boolean for the installed-iOS case:
 *     const canManagePush = push.supported && !showIosInstructions;
 *     // showIosInstructions is false once isStandalone() is true, so
 *     // canManagePush === push.supported === isPushSupported()
 *
 * WebKit (Safari 16.4+, including iOS/iPadOS Home Screen web apps) exposes
 * Web Push through `ServiceWorkerRegistration.prototype.pushManager` — a
 * property on an actual registration — and does not reliably expose a
 * global `window.PushManager` constructor the way Chromium/Gecko do. On a
 * real installed iOS Home Screen app this made `'PushManager' in window`
 * evaluate false, so `isPushSupported()` returned false and the UI showed
 * "Notiser stöds inte i den här webbläsaren ännu" permanently — even fully
 * installed, on a device Apple's own docs say supports Web Push.
 *
 * The check was also entirely SYNCHRONOUS: it could never distinguish "not
 * supported" from "the service worker hasn't finished registering yet",
 * which is a real, common race — main.tsx registers the service worker on
 * every app load, but on a fresh Home Screen launch that registration may
 * still be in flight when this component first renders.
 *
 * FIX: capability is now determined by (1) a small set of synchronous
 * pre-checks that can never flip from false to true later (secure context,
 * `serviceWorker` in navigator, `Notification` global, VAPID key
 * configured), then (2) waiting for `navigator.serviceWorker.ready` (bounded
 * by a timeout so a registration that never settles surfaces as a genuine
 * error instead of an infinite spinner) and checking
 * `'pushManager' in registration` — the actual, standards-based API surface
 * WebKit implements. `window.PushManager` is never required.
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
 * Basic synchronous pre-checks that can never come back true later if false
 * now — used to bail out of the async wait early for a browser that plainly
 * cannot ever do Web Push (e.g. no ServiceWorker API at all).
 */
function baseChecksPass(): boolean {
  return (
    hasSecureContext() &&
    hasServiceWorkerSupport() &&
    hasNotificationApi() &&
    Boolean(env.webPushVapidPublicKey)
  );
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
    currentPushSubscription,
  };
}
