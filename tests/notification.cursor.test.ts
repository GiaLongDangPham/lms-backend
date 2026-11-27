import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/modules/b1/common.js';
import { decodeNotificationCursor, encodeNotificationCursor } from '../src/modules/notifications/notification.cursor.js';

describe('notification cursor', () => {
  it('round-trips a notification cursor with timestamp, id, and scope', () => {
    const cursor = { createdAt: '2026-11-13T08:30:00.123456Z', id: randomUUID() };

    const encoded = encodeNotificationCursor(cursor, 'notifications:student-1');

    expect(decodeNotificationCursor(encoded, 'notifications:student-1')).toEqual(cursor);
  });

  it('rejects malformed cursors and cursors from another scope with VALIDATION_ERROR', () => {
    const cursor = encodeNotificationCursor({
      createdAt: '2026-11-13T08:30:00.123456Z',
      id: randomUUID(),
    }, 'notifications:student-1');

    for (const value of ['not-base64!', cursor]) {
      const scope = value === cursor ? 'notifications:student-2' : 'notifications:student-1';
      expect(() => decodeNotificationCursor(value, scope)).toThrowError(ApiError);
      try { decodeNotificationCursor(value, scope); } catch (error) {
        expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      }
    }
  });
});
