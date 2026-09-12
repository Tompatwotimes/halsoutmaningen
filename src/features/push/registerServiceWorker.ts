/**
 * Registers the minimal installability/push service worker (`/sw.js`).
 * A no-op wherever the API is unavailable (unsupported browser, or a test
 * environment) — this must never throw and never block app startup.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}
