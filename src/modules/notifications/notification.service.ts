import type { Principal } from '../b1/auth.js';
import { ApiError } from '../b1/common.js';
import { decodeNotificationCursor, encodeNotificationCursor } from './notification.cursor.js';
import { NotificationRepository } from './notification.repository.js';
import type { AssignmentCreatedEvent, GradePublishedEvent, NotificationDb, NotificationDto, NotificationPublisher,
  NotificationRow } from './notification.types.js';

export class NotificationService implements NotificationPublisher {
  constructor(private readonly repository: NotificationRepository) {}

  private studentOnly(principal: Principal): void {
    if (principal.user.role !== 'STUDENT') {
      throw new ApiError(403, 'FORBIDDEN', 'Student access is required.');
    }
  }

  private dto(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      assignmentId: row.assignment_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      readAt: row.read_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  async list(principal: Principal, cursorValue: string | undefined, limit: number) {
    this.studentOnly(principal);
    const scope = `notifications:${principal.user.id}`;
    const cursor = decodeNotificationCursor(cursorValue, scope);
    const rows = await this.repository.listForRecipient(principal.user.id, cursor, limit + 1);
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(row => this.dto(row)),
      page: { nextCursor: rows.length > limit && last
        ? encodeNotificationCursor({ createdAt: last.created_at, id: last.id }, scope) : null },
    };
  }

  async markRead(principal: Principal, notificationId: string): Promise<NotificationDto> {
    this.studentOnly(principal);
    const row = await this.repository.markRead(principal.user.id, notificationId);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Notification was not found.');
    return this.dto(row);
  }

  async assignmentCreated(db: NotificationDb, assignment: AssignmentCreatedEvent): Promise<number> {
    return this.repository.insertAssignmentCreated(db, assignment);
  }

  async resultPublished(db: NotificationDb, grade: GradePublishedEvent, studentId: string): Promise<void> {
    await this.repository.insertGradePublished(db, grade, studentId);
  }
}
