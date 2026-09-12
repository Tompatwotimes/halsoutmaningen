// Hälsoutmaningen service worker — installability + Web Push only.
//
// Deliberately NOT an offline/caching service worker: no `fetch` handler, no
// Cache Storage use. This app iterates quickly and correctness (always the
// latest data/build) matters far more than an offline shell for v1 — adding
// a cache here would risk silently serving stale HTML/JS. Its only two jobs:
//
//   push             — show the OS notification from the JSON payload the
//                      notification-dispatcher Edge Function sent.
//   notificationclick — focus an already-open tab on the deep-link URL, or
//                      open a new one.
//
// Payload shape (kept in exact sync with the dispatcher and with
// src/features/push/payload.ts, which re-exports this parsing logic for unit
// testing — a service worker file itself cannot be imported by Vitest):
//   { title: string, body: string, url: string, tag: string }

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const title =
    typeof payload.title === 'string' && payload.title
      ? payload.title
      : 'Hälsoutmaningen';
  const body = typeof payload.body === 'string' ? payload.body : '';
  // `//evil.example` also starts with "/" but is protocol-relative and would
  // resolve off-origin below — reject it the same way the outbox's own
  // `url` CHECK constraint does, as a last line of defense against a
  // malformed/corrupted payload ever navigating away from the app.
  const url =
    typeof payload.url === 'string' &&
    payload.url.startsWith('/') &&
    !payload.url.startsWith('//')
      ? payload.url
      : '/';
  const tag =
    typeof payload.tag === 'string' && payload.tag ? payload.tag : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const target = new URL(url, self.location.origin).href;

      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(target);
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
