import type pg from 'pg';

type Db = pg.Pool | pg.PoolClient;
export interface CommentTarget { kind: 'assignment' | 'submission'; id: string }
export interface CommentRow {
  id: string; assignment_id: string | null; submission_id: string | null; body: string; created_at: Date;
  author_id: string; school_code: string; full_name: string; role: 'TEACHER' | 'STUDENT';
}
const columns = `c.id,c.assignment_id,c.submission_id,c.body,c.created_at,
  u.id AS author_id,u.school_code,u.full_name,u.role`;

export class CommentRepository {
  constructor(readonly pool: pg.Pool) {}

  async target(db: Db, target: CommentTarget) {
    if (target.kind === 'assignment') {
      return (await db.query<{ class_id: string; student_id: string | null }>(
        'SELECT class_id,NULL::uuid AS student_id FROM assignments WHERE id=$1', [target.id])).rows[0];
    }
    return (await db.query<{ class_id: string; student_id: string }>(`SELECT a.class_id,e.student_id
      FROM submissions s JOIN assignments a ON a.id=s.assignment_id
      JOIN enrollments e ON e.id=s.enrollment_id WHERE s.id=$1`, [target.id])).rows[0];
  }

  // FOR KEY SHARE alone does not block an UPDATE of is_active. SHARE does.
  async lockActiveEnrollment(db: Db, classId: string, studentId: string): Promise<boolean> {
    const result = await db.query(`SELECT id FROM enrollments
      WHERE class_id=$1 AND student_id=$2 AND is_active FOR SHARE`, [classId, studentId]);
    return !!result.rowCount;
  }

  async list(db: Db, target: CommentTarget, after: string | null, limit: number): Promise<CommentRow[]> {
    const column = target.kind === 'assignment' ? 'assignment_id' : 'submission_id';
    return (await db.query<CommentRow>(`SELECT ${columns} FROM comments c JOIN users u ON u.id=c.author_id
      WHERE c.${column}=$1 AND ($2::uuid IS NULL OR c.id>$2) ORDER BY c.id LIMIT $3`,
    [target.id, after, limit + 1])).rows;
  }

  async create(db: Db, target: CommentTarget, authorId: string, body: string): Promise<CommentRow> {
    const result = await db.query<CommentRow>(`WITH c AS (
      INSERT INTO comments(author_id,assignment_id,submission_id,body) VALUES($1,$2,$3,$4) RETURNING *)
      SELECT ${columns} FROM c JOIN users u ON u.id=c.author_id`,
    [authorId, target.kind === 'assignment' ? target.id : null,
      target.kind === 'submission' ? target.id : null, body]);
    return result.rows[0]!;
  }
}
