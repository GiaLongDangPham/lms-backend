export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export type NotificationKind = 'ASSIGNMENT_CREATED' | 'DEADLINE_REMINDER' | 'GRADE_PUBLISHED';

export interface NotificationRow {
  id: string;
  recipient_id: string;
  assignment_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationListRow extends NotificationRow {
  cursor_created_at: string;
}

export interface NotificationDto {
  id: string;
  assignmentId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
import type pg from 'pg';

export type NotificationDb = pg.Pool | pg.PoolClient;


export interface AssignmentCreatedEvent {
  id: string;
  classId: string;
  title: string;
}

export interface GradePublishedEvent {
  id: string;
  assignmentId: string;
  revision: number;
}

export interface NotificationPublisher {
  assignmentCreated(db: NotificationDb, assignment: AssignmentCreatedEvent): Promise<number>;
  resultPublished(db: NotificationDb, grade: GradePublishedEvent, studentId: string): Promise<void>;
}
