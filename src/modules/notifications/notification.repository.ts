import type pg from 'pg';
import type { AssignmentCreatedEvent, GradePublishedEvent, NotificationCursor, NotificationDb,
  NotificationListRow, NotificationRow } from './notification.types.js';

export class NotificationRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listForRecipient(recipientId: string, cursor: NotificationCursor | null,
    limit: number): Promise<NotificationListRow[]> {
    return (await this.pool.query<NotificationListRow>(`SELECT id,recipient_id,assignment_id,kind,title,body,read_at,created_at,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
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

  async countUnread(recipientId: string): Promise<number> {
    return (await this.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications
      WHERE recipient_id=$1 AND read_at IS NULL`,[recipientId])).rows[0]!.count;
  }

  async insertAssignmentCreated(db: NotificationDb, assignment: AssignmentCreatedEvent): Promise<number> {
    const result = await db.query(`INSERT INTO notifications
      (recipient_id,assignment_id,kind,title,body,deduplication_key)
      SELECT e.student_id,$1,'ASSIGNMENT_CREATED','Bài tập mới',
        'Bài tập "' || $3 || '" của lớp "' || c.name || '" có hạn nộp lúc ' ||
          to_char($4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY') ||
          ' (giờ Việt Nam).',$5
      FROM enrollments e JOIN users u ON u.id=e.student_id
      JOIN classes c ON c.id=e.class_id
      WHERE e.class_id=$2 AND e.is_active AND u.is_active
      ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`,
    [assignment.id,assignment.classId,assignment.title,assignment.deadlineAt,
      `assignment-created:${assignment.id}`]);
    return result.rowCount ?? 0;
  }

  async insertGradePublished(db: NotificationDb, grade: GradePublishedEvent, studentId: string): Promise<void> {
    await db.query(`INSERT INTO notifications(recipient_id,assignment_id,kind,title,body,deduplication_key)
      SELECT $1,a.id,'GRADE_PUBLISHED','Kết quả bài tập',
        'Kết quả bài tập "' || a.title || '" đã được cập nhật.',$3
      FROM assignments a WHERE a.id=$2
      ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`,
    [studentId,grade.assignmentId,`grade:${grade.id}:${grade.revision}`]);
  }

  async dispatchDeadlineReminders(): Promise<number> {
    const result = await this.pool.query(`WITH dispatch_time AS (
        SELECT clock_timestamp() AS captured_at
      )
      INSERT INTO notifications(recipient_id,assignment_id,kind,title,body,deduplication_key)
      SELECT e.student_id,a.id,'DEADLINE_REMINDER','Sắp đến hạn nộp bài',
        'Bài tập "' || a.title || '" của lớp "' || c.name || '" sẽ hết hạn lúc ' ||
          to_char(a.deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY') ||
          ' (giờ Việt Nam).',
        'deadline-reminder:' || a.id || ':' ||
          to_char(a.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM dispatch_time dt
      JOIN assignments a ON a.deadline_at>dt.captured_at
        AND a.deadline_at<=dt.captured_at+interval '24 hours'
        AND a.results_published_at IS NULL
      JOIN classes c ON c.id=a.class_id
      JOIN enrollments e ON e.class_id=a.class_id AND e.is_active
      JOIN users u ON u.id=e.student_id AND u.is_active
      WHERE NOT EXISTS(SELECT 1 FROM submissions s
        WHERE s.assignment_id=a.id AND s.enrollment_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM grades g
        WHERE g.assignment_id=a.id AND g.enrollment_id=e.id)
      ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`);
    return result.rowCount ?? 0;
  }
}
