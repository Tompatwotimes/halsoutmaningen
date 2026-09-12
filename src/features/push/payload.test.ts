import { describe, expect, it } from 'vitest';
import { parseNotificationPayload } from './payload';

describe('parseNotificationPayload', () => {
  it('passes through a well-formed payload', () => {
    expect(
      parseNotificationPayload({
        title: 'T',
        body: 'B',
        url: '/gruppen',
        tag: 'x',
      }),
    ).toEqual({ title: 'T', body: 'B', url: '/gruppen', tag: 'x' });
  });

  it('falls back to a default title when missing/empty', () => {
    expect(
      parseNotificationPayload({ body: 'B', url: '/', tag: 'x' }).title,
    ).toBe('Hälsoutmaningen');
    expect(
      parseNotificationPayload({ title: '', body: 'B', url: '/', tag: 'x' })
        .title,
    ).toBe('Hälsoutmaningen');
  });

  it('falls back to an empty body when missing', () => {
    expect(
      parseNotificationPayload({ title: 'T', url: '/', tag: 'x' }).body,
    ).toBe('');
  });

  it('rejects a non-relative url, falling back to /', () => {
    expect(
      parseNotificationPayload({
        title: 'T',
        body: 'B',
        url: 'https://evil.example/',
        tag: 'x',
      }).url,
    ).toBe('/');
    expect(parseNotificationPayload({ title: 'T', body: 'B' }).url).toBe('/');
  });

  it('omits tag when missing/empty (no collapsing key)', () => {
    expect(
      parseNotificationPayload({ title: 'T', body: 'B', url: '/' }).tag,
    ).toBeUndefined();
    expect(
      parseNotificationPayload({ title: 'T', body: 'B', url: '/', tag: '' })
        .tag,
    ).toBeUndefined();
  });

  it('never throws on garbage input', () => {
    expect(() => parseNotificationPayload(null)).not.toThrow();
    expect(() => parseNotificationPayload(undefined)).not.toThrow();
    expect(() => parseNotificationPayload('not an object')).not.toThrow();
    expect(() => parseNotificationPayload(42)).not.toThrow();
  });
});
