import type pg from 'pg';
import { hashPassword } from '../../src/security/password.js';
import { requireLocalDatabase } from './database.js';
import { migrationLock } from './migrations.js';
import { seedIds } from './seed-data.js';
export { domainTables, seedIds } from './seed-data.js';

export async function seedDevelopment(pool: pg.Pool, password: string, connectionString: string): Promise<number> {
  requireLocalDatabase(connectionString);
  if (password.length < 12 || password.length > 256) {
    throw new Error('Set SEED_PASSWORD to a local demo password of 12-256 characters.');
  }
  const client = await pool.connect();
  let locked = false;
  let transaction = false;
  let inserted = 0;
  async function insert(sql: string, values: unknown[]): Promise<void> {
    const result = await client.query(sql, values);
    inserted += result.rowCount ?? 0;
  }
  try {
    const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1) AS acquired', [migrationLock]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new Error('Another seed or migration process holds the database lock.');
    await client.query('SET search_path TO public');
    await client.query("SET lock_timeout TO '10s'");
    const schema = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS table_name");
    if (!schema.rows[0]?.table_name) throw new Error('Run npm run db:migrate before seeding.');
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = '0001_initial_schema.sql'");
    if (!applied.rowCount) throw new Error('Run npm run db:migrate before seeding.');
    await client.query('BEGIN');
    transaction = true;
    const users = [
      [seedIds.admin, 'ADMIN001', 'Admin Demo', 'ADMIN'],
      [seedIds.teacher1, 'GV001', 'Giáo viên Demo 1', 'TEACHER'],
      [seedIds.teacher2, 'GV002', 'Giáo viên Demo 2', 'TEACHER'],
      [seedIds.student1, 'SV001', 'Sinh viên Demo 1', 'STUDENT'],
      [seedIds.student2, 'SV002', 'Sinh viên Demo 2', 'STUDENT'],
      [seedIds.student3, 'SV003', 'Sinh viên Demo 3', 'STUDENT'],
    ] as const;
    const existing = await client.query<{ id: string; school_code: string; role: string }>(
      'SELECT id, school_code, role FROM users WHERE id = ANY($1::uuid[])', [users.map(([id]) => id)]);
    for (const [id, code, name, role] of users) {
      const previous = existing.rows.find((row) => row.id === id);
      if (previous) {
        if (previous.school_code !== code || previous.role !== role) {
          throw new Error('A fixture user ID is occupied by a different account; seed was rolled back.');
        }
        continue;
      }
      await insert(`INSERT INTO users(id, school_code, full_name, email, password_hash, role)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, code, name, `${code.toLowerCase()}@example.invalid`, await hashPassword(password), role]);
    }
    for (const [id, code, name] of [
      [seedIds.classA, 'LMS-DEMO-A', 'Lớp Demo A'], [seedIds.classB, 'LMS-DEMO-B', 'Lớp Demo B'],
    ]) {
      await insert(`INSERT INTO classes(id, code, name, term, created_by, course_code)
        VALUES ($1, $2, $3, '2026-HK1', $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, code, name, seedIds.admin, id === seedIds.classA ? 'DEMO-COURSE-A' : 'DEMO-COURSE-B']);
    }
    for (const [classId, teacher] of [
      [seedIds.classA, seedIds.teacher1], [seedIds.classA, seedIds.teacher2], [seedIds.classB, seedIds.teacher2],
    ]) {
      await insert(`INSERT INTO class_teachers(class_id, teacher_id, assigned_by)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [classId, teacher, seedIds.admin]);
    }
    for (const [id, classId, student] of [
      [seedIds.enrollment1, seedIds.classA, seedIds.student1],
      [seedIds.enrollment2, seedIds.classA, seedIds.student2],
      [seedIds.enrollment3, seedIds.classB, seedIds.student3],
    ]) {
      await insert(`INSERT INTO enrollments(id, class_id, student_id, enrolled_by)
        VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [id, classId, student, seedIds.admin]);
    }
    for (const [id, classId, teacher, title] of [
      [seedIds.materialA, seedIds.classA, seedIds.teacher1, 'Tài liệu mẫu lớp A'],
      [seedIds.materialB, seedIds.classB, seedIds.teacher2, 'Tài liệu mẫu lớp B'],
    ]) {
      await insert(`INSERT INTO materials(id, class_id, created_by, title)
        VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [id, classId, teacher, title]);
    }
    // Fixed fixture dates make before/after-deadline assertions reproducible.
    for (const [id, classId, teacher, title, deadline] of [
      [seedIds.assignmentA, seedIds.classA, seedIds.teacher1, 'Bài mẫu có lịch sử nộp', '2026-10-27T10:00:00Z'],
      [seedIds.assignmentLate, seedIds.classA, seedIds.teacher1, 'Bài mẫu nộp trễ', '2026-10-19T10:00:00Z'],
      [seedIds.assignmentB, seedIds.classB, seedIds.teacher2, 'Bài mẫu lớp B chưa nộp', '2026-10-27T10:00:00Z'],
    ]) {
      await insert(`INSERT INTO assignments(id, class_id, created_by, title, deadline_at, max_score)
        VALUES ($1, $2, $3, $4, $5, 10) ON CONFLICT (id) DO NOTHING`, [id, classId, teacher, title, deadline]);
    }
    for (const [id, assignment, enrollment] of [
      [seedIds.submission1, seedIds.assignmentA, seedIds.enrollment1],
      [seedIds.submission2, seedIds.assignmentA, seedIds.enrollment2],
      [seedIds.submissionLate, seedIds.assignmentLate, seedIds.enrollment1],
    ]) {
      await insert(`INSERT INTO submissions(id, assignment_id, enrollment_id)
        VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [id, assignment, enrollment]);
    }
    for (const [submission, version, time, deadline] of [
      [seedIds.submission1, 1, '2026-10-20T09:00:00Z', '2026-10-27T10:00:00Z'],
      [seedIds.submission1, 2, '2026-10-20T10:00:00Z', '2026-10-27T10:00:00Z'],
      [seedIds.submission2, 1, '2026-10-20T09:30:00Z', '2026-10-27T10:00:00Z'],
      [seedIds.submissionLate, 1, '2026-10-20T10:00:00Z', '2026-10-19T10:00:00Z'],
    ]) {
      await insert(`INSERT INTO submission_versions(submission_id, version_number, submitted_at, deadline_at_submission)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [submission, version, time, deadline]);
    }
    const fileId = (number: number): string => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
    for (let number = 1; number <= 8; number++) {
      const owner = number === 8 ? seedIds.teacher2 : number === 6 ? seedIds.student2 :
        number >= 3 && number <= 7 ? seedIds.student1 : seedIds.teacher1;
      await insert(`INSERT INTO files(id, storage_provider, storage_container, object_key,
        original_name, mime_type, size_bytes, uploaded_by)
        VALUES ($1, 'fixture', 'lms-local-fixtures', $2, $3, 'application/pdf', 128, $4)
        ON CONFLICT (id) DO NOTHING`, [fileId(number), `demo/file-${number}.pdf`, `file-${number}.pdf`, owner]);
    }
    for (const [material, file] of [[seedIds.materialA, fileId(1)], [seedIds.materialB, fileId(8)]]) {
      await insert('INSERT INTO material_files VALUES ($1, $2) ON CONFLICT DO NOTHING', [material, file]);
    }
    await insert('INSERT INTO assignment_files VALUES ($1, $2) ON CONFLICT DO NOTHING', [seedIds.assignmentA, fileId(2)]);
    for (const [submission, version, number] of [
      [seedIds.submission1, 1, 3], [seedIds.submission1, 1, 4], [seedIds.submission1, 2, 5],
      [seedIds.submission2, 1, 6], [seedIds.submissionLate, 1, 7],
    ] as const) {
      await insert('INSERT INTO submission_files VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [submission, version, fileId(number)]);
    }
    await insert(`INSERT INTO grades(submission_id, assignment_id, enrollment_id, graded_version_number, score, feedback, graded_by)
      VALUES ($1, $3, $4, 2, 8.5, 'Feedback Draft giả lập; chưa hiển thị cho SV', $2)
      ON CONFLICT (submission_id) DO NOTHING`, [seedIds.submission1, seedIds.teacher1, seedIds.assignmentA, seedIds.enrollment1]);
    await insert(`INSERT INTO grades(submission_id, assignment_id, enrollment_id, graded_version_number, score, feedback,
      status, graded_by, published_by, published_at)
      VALUES ($1, $4, $5, 1, 9, 'Feedback Published giả lập', 'PUBLISHED', $2, $3, '2026-10-20T11:00:00Z')
      ON CONFLICT (submission_id) DO NOTHING`, [seedIds.submission2, seedIds.teacher1, seedIds.teacher2, seedIds.assignmentA, seedIds.enrollment2]);
    await insert(`INSERT INTO notifications(id, recipient_id, assignment_id, kind, title, body, deduplication_key)
      VALUES ('80000000-0000-4000-8000-000000000001', $1, $2, 'ASSIGNMENT_CREATED',
      'Bài tập mẫu mới', 'Có bài tập mẫu trong lớp A.', 'fixture-assignment-a') ON CONFLICT DO NOTHING`,
    [seedIds.student1, seedIds.assignmentA]);
    await insert(`INSERT INTO notifications(id, recipient_id, assignment_id, kind, title, body, deduplication_key, read_at)
      VALUES ('80000000-0000-4000-8000-000000000002', $1, $2, 'GRADE_PUBLISHED',
      'Kết quả mẫu đã công bố', 'Kết quả mẫu có thể được xem qua API có kiểm tra quyền.',
      'fixture-published-sv002', '2026-10-20T12:00:00Z') ON CONFLICT DO NOTHING`,
    [seedIds.student2, seedIds.assignmentA]);
    await insert(`INSERT INTO comments(id, author_id, assignment_id, body)
      VALUES ('90000000-0000-4000-8000-000000000001', $1, $2, 'Câu hỏi mẫu trên bài tập')
      ON CONFLICT (id) DO NOTHING`, [seedIds.student1, seedIds.assignmentA]);
    await insert(`INSERT INTO comments(id, author_id, submission_id, body)
      VALUES ('90000000-0000-4000-8000-000000000002', $1, $2, 'Phản hồi mẫu trên kết quả')
      ON CONFLICT (id) DO NOTHING`, [seedIds.teacher2, seedIds.submission2]);
    await client.query('COMMIT');
    transaction = false;
    return inserted;
  } finally {
    let destroy = false;
    try {
      if (transaction) await client.query('ROLLBACK');
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
    } catch {
      destroy = true;
    } finally {
      client.release(destroy);
    }
  }
}
