import type pg from 'pg';
import type { AssignmentCreatedEvent, GradePublishedEvent, NotificationCursor, NotificationDb,
  NotificationRow } from './notification.types.js';

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

  async insertAssignmentCreated(db: NotificationDb, assignment: AssignmentCreatedEvent): Promise<number> {
    const result = await db.query(`INSERT INTO notifications
      (recipient_id,assignment_id,kind,title,body,deduplication_key)
      SELECT e.student_id,$1,'ASSIGNMENT_CREATED','Bài tập mới',$3,$4
      FROM enrollments e JOIN users u ON u.id=e.student_id
      WHERE e.class_id=$2 AND e.is_active AND u.is_active
      ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`,
    [assignment.id,assignment.classId,`Bài tập "${assignment.title}" đã được giao.`,
      `assignment-created:${assignment.id}`]);
    return result.rowCount ?? 0;
  }

  async insertGradePublished(db: NotificationDb, grade: GradePublishedEvent, studentId: string): Promise<void> {
    await db.query(`INSERT INTO notifications(recipient_id,assignment_id,kind,title,body,deduplication_key)
      VALUES($1,$2,'GRADE_PUBLISHED','Kết quả bài tập','Kết quả bài tập đã được cập nhật.',$3)
      ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`,
    [studentId,grade.assignmentId,`grade:${grade.id}:${grade.revision}`]);
  }
}
