import { z } from 'zod';
import { ApiError } from '../b1/common.js';
import type { NotificationCursor } from './notification.types.js';

const payload = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  scope: z.string().min(1),
}).strict();

export function encodeNotificationCursor(cursor: NotificationCursor, scope: string): string {
  return Buffer.from(JSON.stringify({
    createdAt: cursor.createdAt,
    id: cursor.id,
    scope,
  })).toString('base64url');
}

export function decodeNotificationCursor(value: string | undefined, scope: string): NotificationCursor | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
    const decoded = payload.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (decoded.scope !== scope) throw new Error('Invalid scope');
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Cursor is invalid for this list.');
  }
}
