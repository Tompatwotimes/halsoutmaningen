/**
 * Pure parsing/validation of a push payload — kept in exact behavioural sync
 * with `public/sw.js`'s inline parsing (a service worker file cannot be
 * imported by Vitest, so this is the unit-testable mirror; any change here
 * must be mirrored there by hand).
 */
export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string | undefined;
}

export function parseNotificationPayload(raw: unknown): NotificationPayload {
  const data =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title =
    typeof data.title === 'string' && data.title
      ? data.title
      : 'Hälsoutmaningen';
  const body = typeof data.body === 'string' ? data.body : '';
  const url =
    typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  return { title, body, url, tag };
}
