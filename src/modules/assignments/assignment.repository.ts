import type pg from 'pg';

export type Db = pg.Pool | pg.PoolClient;

export interface AssignmentRow {
  id: string;
  class_id: string;
  title: string;
  description: string | null;
  deadline_at: Date;
  max_score: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  results_published_at: Date | null;
}

export interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: Date;
  uploaded_by?: string;
  lifecycle_status?: 'PENDING' | 'ATTACHED' | 'DELETE_PENDING';
}

export interface SubmissionRow {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  student_id: string;
  created_at: Date;
}

export class AssignmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  db(): pg.Pool { return this.pool; }

  async findAssignment(db: Db, id: string, lock = false): Promise<AssignmentRow | undefined> {
    const result = await db.query<AssignmentRow>(
      `SELECT * FROM assignments WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0];
  }

  async listAssignmentIds(db: Db, classId: string, after: string | null, limit: number) {
    return (await db.query<{ id: string }>(`SELECT id FROM assignments
      WHERE class_id = $1 AND ($2::uuid IS NULL OR id > $2)
      ORDER BY id LIMIT $3`, [classId, after, limit])).rows;
  }

  async createAssignment(db: Db, input: {
    classId: string; title: string; description: string | null; deadlineAt: Date;
    maxScore: number; createdBy: string;
  }): Promise<AssignmentRow> {
    const result = await db.query<AssignmentRow>(`INSERT INTO assignments
      (class_id, title, description, deadline_at, max_score, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.classId, input.title, input.description, input.deadlineAt, input.maxScore, input.createdBy]);
    return result.rows[0]!;
  }

  async updateAssignment(db: Db, current: AssignmentRow, input: {
    title?: string; description?: string | null; deadlineAt?: Date; maxScore?: number;
  }): Promise<AssignmentRow> {
    const result = await db.query<AssignmentRow>(`UPDATE assignments SET
      title = $2, description = $3, deadline_at = $4, max_score = $5
      WHERE id = $1 RETURNING *`, [current.id, input.title ?? current.title,
      input.description === undefined ? current.description : input.description,
      input.deadlineAt ?? current.deadline_at, input.maxScore ?? current.max_score]);
    return result.rows[0]!;
  }

  async assignmentFiles(db: Db, assignmentId: string): Promise<FileRow[]> {
    return (await db.query<FileRow>(`SELECT f.id,f.original_name,f.mime_type,f.size_bytes,f.created_at
      FROM assignment_files af JOIN files f ON f.id = af.file_id
      WHERE af.assignment_id = $1 ORDER BY f.id`, [assignmentId])).rows;
  }

  async pendingFiles(db: Db, fileIds: string[], ownerId: string): Promise<FileRow[]> {
    if (!fileIds.length) return [];
    return (await db.query<FileRow>(`SELECT id,original_name,mime_type,size_bytes,created_at,
      uploaded_by,lifecycle_status FROM files WHERE id = ANY($1::uuid[]) AND uploaded_by = $2
      ORDER BY id FOR UPDATE`, [fileIds, ownerId])).rows;
  }

  async assignmentFileIds(db: Db, assignmentId: string): Promise<string[]> {
    return (await db.query<{ file_id: string }>(
      'SELECT file_id FROM assignment_files WHERE assignment_id=$1 ORDER BY file_id', [assignmentId]))
      .rows.map(row => row.file_id);
  }

  async replaceAssignmentFiles(db: Db, assignmentId: string, fileIds: string[]): Promise<void> {
    const current = await this.assignmentFileIds(db, assignmentId);
    const removed = current.filter(id => !fileIds.includes(id));
    const added = fileIds.filter(id => !current.includes(id));
    if (removed.length) await db.query(
      'DELETE FROM assignment_files WHERE assignment_id=$1 AND file_id=ANY($2::uuid[])', [assignmentId, removed]);
    if (removed.length) await db.query(`UPDATE files SET lifecycle_status='DELETE_PENDING',
      attached_at=NULL,delete_attempted_at=clock_timestamp() WHERE id=ANY($1::uuid[])`,
    [removed]);
    if (added.length) await db.query(`INSERT INTO assignment_files(assignment_id,file_id)
      SELECT $1,unnest($2::uuid[])`, [assignmentId, added]);
  }

  async assignmentCounts(db: Db, assignmentId: string, classId: string) {
    const result = await db.query<{ submitted_count: number; student_count: number }>(`SELECT
      (SELECT count(*)::int FROM submissions WHERE assignment_id=$1) AS submitted_count,
      (SELECT count(*)::int FROM enrollments e JOIN users u ON u.id=e.student_id
        WHERE e.class_id=$2 AND e.is_active AND u.is_active) AS student_count`, [assignmentId, classId]);
    return result.rows[0]!;
  }

  async studentAssignmentState(db: Db, assignmentId: string, studentId: string) {
    return (await db.query<{ submitted_at: Date | null; deadline_at_submission: Date | null; graded: boolean }>(`SELECT
      v.submitted_at,v.deadline_at_submission,(g.id IS NOT NULL) AS graded
      FROM enrollments e
      LEFT JOIN submissions s ON s.enrollment_id=e.id AND s.assignment_id=$1
      LEFT JOIN LATERAL (SELECT submitted_at,deadline_at_submission FROM submission_versions
        WHERE submission_id=s.id ORDER BY version_number DESC LIMIT 1) v ON true
      LEFT JOIN grades g ON g.assignment_id=$1 AND g.enrollment_id=e.id
      WHERE e.student_id=$2 AND e.is_active`, [assignmentId, studentId])).rows[0];
  }

  async activeEnrollment(db: Db, classId: string, studentId: string, lock = false) {
    return (await db.query<{ id: string }>(`SELECT id FROM enrollments
      WHERE class_id=$1 AND student_id=$2 AND is_active ${lock ? 'FOR KEY SHARE' : ''}`,
    [classId, studentId])).rows[0];
  }

  async findSubmissionForStudent(db: Db, assignmentId: string, studentId: string, lock = false) {
    return (await db.query<SubmissionRow>(`SELECT s.*,e.student_id FROM submissions s
      JOIN enrollments e ON e.id=s.enrollment_id
      WHERE s.assignment_id=$1 AND e.student_id=$2 ${lock ? 'FOR UPDATE OF s' : ''}`,
    [assignmentId, studentId])).rows[0];
  }

  async findSubmission(db: Db, id: string): Promise<SubmissionRow | undefined> {
    return (await db.query<SubmissionRow>(`SELECT s.*,e.student_id FROM submissions s
      JOIN enrollments e ON e.id=s.enrollment_id WHERE s.id=$1`, [id])).rows[0];
  }

  async listSubmissionIds(db: Db, assignmentId: string, after: string | null, limit: number) {
    return (await db.query<{ id: string }>(`SELECT id FROM submissions WHERE assignment_id=$1
      AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`, [assignmentId, after, limit])).rows;
  }

  async hasGrade(db: Db, assignmentId: string, enrollmentId: string): Promise<boolean> {
    return (await db.query('SELECT 1 FROM grades WHERE assignment_id=$1 AND enrollment_id=$2',
      [assignmentId, enrollmentId])).rowCount !== 0;
  }

  async ensureSubmission(db: Db, assignmentId: string, enrollmentId: string): Promise<string> {
    await db.query(`INSERT INTO submissions(assignment_id,enrollment_id) VALUES($1,$2)
      ON CONFLICT(assignment_id,enrollment_id) DO NOTHING`, [assignmentId, enrollmentId]);
    const result = await db.query<{ id: string }>(`SELECT id FROM submissions
      WHERE assignment_id=$1 AND enrollment_id=$2 FOR UPDATE`, [assignmentId, enrollmentId]);
    return result.rows[0]!.id;
  }

  async nextVersion(db: Db, submissionId: string): Promise<number> {
    const result = await db.query<{ version: number }>(`SELECT
      COALESCE(max(version_number),0)::int+1 AS version FROM submission_versions
      WHERE submission_id=$1`, [submissionId]);
    return result.rows[0]!.version;
  }

  async insertVersion(db: Db, input: { submissionId: string; version: number; submittedAt: Date;
    deadlineAt: Date; fileIds: string[] }): Promise<void> {
    await db.query(`INSERT INTO submission_versions
      (submission_id,version_number,submitted_at,deadline_at_submission)
      VALUES($1,$2,$3,$4)`, [input.submissionId, input.version, input.submittedAt, input.deadlineAt]);
    await db.query(`INSERT INTO submission_files(submission_id,version_number,file_id)
      SELECT $1,$2,unnest($3::uuid[])`, [input.submissionId, input.version, input.fileIds]);
  }

  async serverTime(db: Db): Promise<Date> {
    return (await db.query<{ value: Date }>('SELECT clock_timestamp() AS value')).rows[0]!.value;
  }

  async submissionVersions(db: Db, submissionId: string) {
    return (await db.query<{ version_number: number; submitted_at: Date; deadline_at_submission: Date }>(
      `SELECT version_number,submitted_at,deadline_at_submission FROM submission_versions
       WHERE submission_id=$1 ORDER BY version_number`, [submissionId])).rows;
  }

  async submissionFiles(db: Db, submissionId: string): Promise<(FileRow & { version_number: number })[]> {
    return (await db.query<FileRow & { version_number: number }>(`SELECT sf.version_number,
      f.id,f.original_name,f.mime_type,f.size_bytes,f.created_at FROM submission_files sf
      JOIN files f ON f.id=sf.file_id WHERE sf.submission_id=$1 ORDER BY sf.version_number,f.id`,
    [submissionId])).rows;
  }

  async gradeSummary(db: Db, submissionId: string) {
    return (await db.query<{ score: string; status: 'DRAFT' | 'PUBLISHED'; source: string }>(
      'SELECT score,status,source FROM grades WHERE submission_id=$1', [submissionId])).rows[0];
  }

  async userSummary(db: Db, userId: string) {
    return (await db.query<{ id: string; school_code: string; full_name: string; role: string }>(
      'SELECT id,school_code,full_name,role FROM users WHERE id=$1', [userId])).rows[0]!;
  }
}
