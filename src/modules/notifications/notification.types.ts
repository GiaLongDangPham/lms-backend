export interface NotificationCursor {
  createdAt: Date;
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

export interface NotificationDto {
  id: string;
  assignmentId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
