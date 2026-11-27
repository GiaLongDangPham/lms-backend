import type pg from 'pg';
import type { Principal } from '../b1/auth.js';

export type Db = pg.Pool | pg.PoolClient;

export interface AssessmentAssignmentRow {
  id: string;
  class_id: string;
  deadline_at: Date;
  results_published_at: Date | null;
  results_published_by: string | null;
  max_score: string;
}

export interface SubmissionGradeTargetRow {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  student_id: string;
}

export interface GradeRow {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  submission_id: string | null;
  graded_version_number: number | null;
  score: string;
  feedback: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  source: 'MANUAL' | 'AUTO_ZERO_NO_SUBMISSION';
  revision: number;
  graded_by: string;
  graded_at: Date;
  published_by: string | null;
  published_at: Date | null;
}

export interface GradeHistoryRow {
  version: number;
  score: string;
  feedback: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  source: 'MANUAL' | 'AUTO_ZERO_NO_SUBMISSION';
  changed_by: string;
  changed_at: Date;
}

export interface EnrollmentTargetRow {
  id: string;
  student_id: string;
}

export interface UserSummaryRow {
  id: string;
  school_code: string;
  full_name: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
}

export class AssessmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listAssignmentGrades(db: Db, assignmentId: string, after: string | null, limit: number): Promise<GradeRow[]> {
    return (await db.query<GradeRow>(`SELECT * FROM grades WHERE assignment_id=$1
      AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`, [assignmentId, after, limit])).rows;
  }

  db(): pg.Pool { return this.pool; }

  async findAssignment(db: Db, assignmentId: string, lock = false) {
    return (await db.query<AssessmentAssignmentRow>(`SELECT * FROM assignments
      WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [assignmentId])).rows[0];
  }

  async lockClass(db: Db, classId: string): Promise<boolean> {
    const result = await db.query('SELECT id FROM classes WHERE id=$1 FOR UPDATE', [classId]);
    return Boolean(result.rowCount);
  }

  async hasClassAccess(db: Db, principal: Principal, classId: string, lockMembership = false): Promise<boolean> {
    const { user } = principal;
    let sql: string;
    let values: string[];
    if (user.role === 'ADMIN') {
      sql = `SELECT c.id FROM classes c WHERE c.id=$1 ${lockMembership ? 'FOR KEY SHARE OF c' : ''}`;
      values = [classId];
    } else if (user.role === 'TEACHER') {
      sql = `SELECT c.id FROM classes c JOIN class_teachers ct ON ct.class_id=c.id
        WHERE c.id=$1 AND ct.teacher_id=$2 ${lockMembership ? 'FOR KEY SHARE OF c,ct' : ''}`;
      values = [classId, user.id];
    } else {
      sql = `SELECT c.id FROM classes c JOIN enrollments e ON e.class_id=c.id
        WHERE c.id=$1 AND e.student_id=$2 AND e.is_active
        ${lockMembership ? 'FOR KEY SHARE OF c,e' : ''}`;
      values = [classId, user.id];
    }
    const result = await db.query(sql, values);
    return Boolean(result.rowCount);
  }

  async findSubmissionTarget(db: Db, submissionId: string) {
    return (await db.query<SubmissionGradeTargetRow>(`SELECT s.id,s.assignment_id,s.enrollment_id,e.student_id
      FROM submissions s JOIN enrollments e ON e.id=s.enrollment_id WHERE s.id=$1`, [submissionId])).rows[0];
  }

  async findGradeBySubmission(db: Db, submissionId: string) {
    return (await db.query<GradeRow>('SELECT * FROM grades WHERE submission_id=$1', [submissionId])).rows[0];
  }

  async findGradedVersion(db: Db, submissionId: string): Promise<number> {
    const result = await db.query<{ n: number }>(`SELECT COALESCE(
      (SELECT graded_version_number FROM grades WHERE submission_id=$1),
      (SELECT max(version_number) FROM submission_versions WHERE submission_id=$1))::int AS n`, [submissionId]);
    return result.rows[0]!.n;
  }

  async saveSubmissionGrade(db: Db, input: { target: SubmissionGradeTargetRow; version: number;
    score: number; feedback: string | null; feedbackProvided: boolean; teacherId: string }) {
    const result = await db.query<GradeRow>(`INSERT INTO grades
      (assignment_id,enrollment_id,submission_id,graded_version_number,score,feedback,graded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(submission_id) DO UPDATE SET score=EXCLUDED.score,
      feedback=CASE WHEN $8::boolean THEN EXCLUDED.feedback ELSE grades.feedback END,
      graded_by=EXCLUDED.graded_by,graded_at=now(),source='MANUAL',
      published_by=CASE WHEN grades.status='PUBLISHED' THEN EXCLUDED.graded_by ELSE NULL END,
      published_at=CASE WHEN grades.status='PUBLISHED' THEN now() ELSE NULL END RETURNING *`,
    [input.target.assignment_id, input.target.enrollment_id, input.target.id, input.version, input.score,
      input.feedback, input.teacherId, input.feedbackProvided]);
    return result.rows[0]!;
  }

  async correctPublishedNoSubmissionGrade(db: Db, input: { assignmentId: string; studentId: string;
    score: number; feedback: string | null; feedbackProvided: boolean; teacherId: string }) {
    const result = await db.query<GradeRow>(`UPDATE grades g SET score=$3,
      feedback=CASE WHEN $5::boolean THEN $4 ELSE g.feedback END,source='MANUAL',graded_by=$6,
      graded_at=now(),published_by=$6,published_at=now()
      FROM enrollments e WHERE g.enrollment_id=e.id AND g.assignment_id=$1 AND e.student_id=$2
      AND g.status='PUBLISHED' AND g.submission_id IS NULL RETURNING g.*`,
    [input.assignmentId, input.studentId, input.score, input.feedback, input.feedbackProvided, input.teacherId]);
    return result.rows[0];
  }

  async publicationCohort(db: Db, classId: string) {
    return (await db.query<EnrollmentTargetRow>(`SELECT e.id,e.student_id FROM enrollments e
      JOIN users u ON u.id=e.student_id WHERE e.class_id=$1 AND e.is_active AND u.is_active
      ORDER BY e.id FOR SHARE OF e,u`, [classId])).rows;
  }

  async ungradedSubmissions(db: Db, assignmentId: string, enrollmentIds: string[]) {
    return (await db.query<{ id: string; student_id: string }>(`SELECT s.id,e.student_id FROM submissions s
      JOIN enrollments e ON e.id=s.enrollment_id WHERE s.assignment_id=$1 AND e.id=ANY($2::uuid[])
      AND NOT EXISTS(SELECT 1 FROM grades g WHERE g.submission_id=s.id) ORDER BY s.id`,
    [assignmentId, enrollmentIds])).rows;
  }

  async insertAutomaticZero(db: Db, assignmentId: string, enrollmentId: string, teacherId: string) {
    const result = await db.query(`INSERT INTO grades
      (assignment_id,enrollment_id,score,status,source,graded_by,published_by,published_at)
      SELECT $1,$2,0,'PUBLISHED','AUTO_ZERO_NO_SUBMISSION',$3,$3,now()
      WHERE NOT EXISTS(SELECT 1 FROM submissions WHERE assignment_id=$1 AND enrollment_id=$2)
      ON CONFLICT(assignment_id,enrollment_id) DO NOTHING`, [assignmentId, enrollmentId, teacherId]);
    return result.rowCount ?? 0;
  }

  async publishDraftGrades(db: Db, assignmentId: string, enrollmentIds: string[], teacherId: string) {
    await db.query(`UPDATE grades SET status='PUBLISHED',published_by=$3,published_at=now()
      WHERE assignment_id=$1 AND enrollment_id=ANY($2::uuid[]) AND status='DRAFT'`,
    [assignmentId, enrollmentIds, teacherId]);
  }

  async publishedResults(db: Db, assignmentId: string, enrollmentIds: string[]) {
    return (await db.query<GradeRow & { student_id: string }>(`SELECT g.*,e.student_id FROM grades g
      JOIN enrollments e ON e.id=g.enrollment_id WHERE g.assignment_id=$1
      AND e.id=ANY($2::uuid[]) AND g.status='PUBLISHED'`, [assignmentId, enrollmentIds])).rows;
  }

  async recordAssignmentPublication(db: Db, assignmentId: string, teacherId: string) {
    const result = await db.query<{ results_published_at: Date }>(`UPDATE assignments SET
      results_published_at=COALESCE(results_published_at,now()),
      results_published_by=COALESCE(results_published_by,$2)
      WHERE id=$1 RETURNING results_published_at`, [assignmentId, teacherId]);
    return result.rows[0]!.results_published_at;
  }

  async publishedAssignmentsForClass(db: Db, classId: string) {
    return (await db.query<{ id: string; results_published_by: string }>(`SELECT id,results_published_by FROM assignments
      WHERE class_id=$1 AND results_published_at IS NOT NULL AND results_published_by IS NOT NULL ORDER BY id`,
    [classId])).rows;
  }

  async insertEnrollmentAutomaticZero(db: Db, assignmentId: string, enrollmentId: string, publisherId: string) {
    return (await db.query<GradeRow>(`INSERT INTO grades
      (assignment_id,enrollment_id,submission_id,graded_version_number,score,status,source,graded_by,published_by,published_at)
      SELECT a.id,$2,NULL,NULL,0,'PUBLISHED','AUTO_ZERO_NO_SUBMISSION',a.results_published_by,
        a.results_published_by,a.results_published_at
      FROM assignments a WHERE a.id=$1 AND a.results_published_at IS NOT NULL
        AND a.results_published_by=$3
      ON CONFLICT(assignment_id,enrollment_id) DO NOTHING RETURNING *`,
    [assignmentId, enrollmentId, publisherId])).rows[0];
  }

  async findPublishedGrade(db: Db, assignmentId: string, studentId: string) {
    return (await db.query<GradeRow>(`SELECT g.* FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
      WHERE g.assignment_id=$1 AND e.student_id=$2 AND g.status='PUBLISHED'`,
    [assignmentId, studentId])).rows[0];
  }

  async findStudentGrade(db: Db, assignmentId: string, studentId: string) {
    return (await db.query<GradeRow>(`SELECT g.* FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
      WHERE g.assignment_id=$1 AND e.student_id=$2`, [assignmentId, studentId])).rows[0];
  }

  async gradeHistory(db: Db, gradeId: string, publishedOnly: boolean) {
    return (await db.query<GradeHistoryRow>(`SELECT version,score,feedback,status,source,changed_by,changed_at
      FROM grade_history WHERE grade_id=$1 ${publishedOnly ? "AND status='PUBLISHED'" : ''} ORDER BY version`,
    [gradeId])).rows;
  }

  async enrollmentStudentId(db: Db, enrollmentId: string) {
    return (await db.query<{ student_id: string }>('SELECT student_id FROM enrollments WHERE id=$1',
      [enrollmentId])).rows[0]!.student_id;
  }

  async userSummary(db: Db, userId: string) {
    return (await db.query<UserSummaryRow>(`SELECT id,school_code,full_name,role FROM users WHERE id=$1`,
      [userId])).rows[0]!;
  }

}
