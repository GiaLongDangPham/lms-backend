import type pg from 'pg';
import { userColumns, type EnrollmentRow, type User } from './common.js';

export class EnrollmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  db(): pg.Pool { return this.pool; }

  async lockClass(db: pg.PoolClient, classId: string): Promise<boolean> {
    const result = await db.query('SELECT id FROM classes WHERE id=$1 FOR UPDATE', [classId]);
    return Boolean(result.rowCount);
  }

  async findActiveStudent(db: pg.PoolClient, studentId: string): Promise<User | undefined> {
    return (await db.query<User>(`SELECT ${userColumns} FROM users WHERE id=$1 FOR SHARE`, [studentId])).rows[0];
  }

  async upsertEnrollment(db: pg.PoolClient, classId: string, studentId: string, enrolledBy: string) {
    return (await db.query<EnrollmentRow>(`INSERT INTO enrollments(class_id,student_id,enrolled_by)
      VALUES($1,$2,$3) ON CONFLICT(class_id,student_id) DO UPDATE SET is_active=true,enrolled_by=EXCLUDED.enrolled_by
      WHERE NOT enrollments.is_active RETURNING *`, [classId, studentId, enrolledBy])).rows[0];
  }

  async findEnrollment(db: pg.PoolClient, classId: string, enrollmentId: string) {
    return (await db.query<EnrollmentRow>(`SELECT * FROM enrollments WHERE class_id=$1 AND id=$2 FOR UPDATE`,
      [classId, enrollmentId])).rows[0];
  }

  async setEnrollmentActive(db: pg.PoolClient, classId: string, enrollmentId: string, isActive: boolean) {
    return (await db.query<EnrollmentRow>(`UPDATE enrollments SET is_active=$3
      WHERE class_id=$1 AND id=$2 RETURNING *`, [classId, enrollmentId, isActive])).rows[0];
  }
}
