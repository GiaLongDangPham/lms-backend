import type pg from 'pg';
import type { NotificationCursor, NotificationRow } from './notification.types.js';

export class NotificationRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listForRecipient(recipientId: string, cursor: NotificationCursor | null,
    limit: number): Promise<NotificationRow[]> {
    return (await this.pool.query<NotificationRow>(`SELECT id,recipient_id,assignment_id,kind,title,body,read_at,created_at
      FROM notifications WHERE recipient_id=$1
      AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $4`,
    [recipientId,cursor?.createdAt ?? null,cursor?.id ?? null,limit])).rows;
  }

  async markRead(recipientId: string, notificationId: string): Promise<NotificationRow | undefined> {
    return (await this.pool.query<NotificationRow>(`UPDATE notifications
      SET read_at=COALESCE(read_at,clock_timestamp())
      WHERE id=$1 AND recipient_id=$2
      RETURNING id,recipient_id,assignment_id,kind,title,body,read_at,created_at`,
    [notificationId,recipientId])).rows[0];
  }
}
