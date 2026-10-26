import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIds as id } from '../scripts/lib/seed-data.js';
import { createApp } from '../src/app.js';

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 8 });
const app = createApp({ corsOrigins: ['http://localhost:5173'], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'assessment-publication', audience: 'assessment-publication',
    cookieSecure: false, cookieSameSite: 'lax', origins: ['http://localhost:5173'] } } });
const api = request(app);
const password = 'B1IntegrationPassword2026!';
let teacher: string;
let teacher2: string;
let student: string;

async function login(schoolCode: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode, password });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

async function ensureTeacherAssignment(teacherId: string = id.teacher1) {
  await pool.query(`INSERT INTO class_teachers(class_id,teacher_id,assigned_by)
    VALUES($1,$2,$3) ON CONFLICT(class_id,teacher_id) DO NOTHING`, [id.classA, teacherId, id.admin]);
}

async function assignmentFixture() {
  return (await pool.query<{ id: string }>(`INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by)
    VALUES($1,'B4 assessment fixture',now()+interval '1 day',10,$2) RETURNING id`,
  [id.classA, id.teacher1])).rows[0]!.id;
}

async function pendingFile() {
  const fileId = randomUUID();
  await pool.query(`INSERT INTO files(id,storage_provider,storage_container,object_key,
    original_name,mime_type,size_bytes,uploaded_by) VALUES($1,'TEST','private',$2,'answer.pdf',
    'application/pdf',128,$3)`, [fileId, randomUUID(), id.student1]);
  return fileId;
}

async function submit(assignmentId: string, token = student) {
  return api.post(`/api/assignments/${assignmentId}/submissions`).auth(token, { type: 'bearer' })
    .send({ fileIds: [await pendingFile()] });
}

async function saveGrade(submissionId: string, token: string, body: Record<string, unknown>) {
  return api.put(`/api/submissions/${submissionId}/grade`).auth(token, { type: 'bearer' }).send(body);
}

async function publish(assignmentId: string, token = teacher) {
  return api.post(`/api/assignments/${assignmentId}/grades/publish`).auth(token, { type: 'bearer' });
}

async function gradeCount(assignmentId: string) {
  return (await pool.query('SELECT 1 FROM grades WHERE assignment_id=$1', [assignmentId])).rowCount;
}

async function gradeRows(assignmentId: string) {
  return (await pool.query<{ status: string; score: string; source: string }>(
    'SELECT status,score,source FROM grades WHERE assignment_id=$1 ORDER BY enrollment_id', [assignmentId])).rows;
}

async function historyCount(assignmentId: string, publishedOnly = false) {
  return (await pool.query(`SELECT 1 FROM grade_history h JOIN grades g ON g.id=h.grade_id
    WHERE g.assignment_id=$1 ${publishedOnly ? "AND h.status='PUBLISHED'" : ''}`, [assignmentId])).rowCount;
}

async function notificationCount(assignmentId: string, recipientId?: string) {
  return (await pool.query(`SELECT 1 FROM notifications WHERE assignment_id=$1
    AND ($2::uuid IS NULL OR recipient_id=$2)`, [assignmentId, recipientId ?? null])).rowCount;
}

async function gradeSnapshot(assignmentId: string, studentId = id.student1) {
  return (await pool.query(`SELECT g.* FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
    WHERE g.assignment_id=$1 AND e.student_id=$2`, [assignmentId, studentId])).rows;
}

async function historySnapshot(assignmentId: string, studentId = id.student1) {
  return (await pool.query(`SELECT h.* FROM grade_history h JOIN grades g ON g.id=h.grade_id
    JOIN enrollments e ON e.id=g.enrollment_id WHERE g.assignment_id=$1 AND e.student_id=$2
    ORDER BY h.version`, [assignmentId, studentId])).rows;
}

async function publicationState(assignmentId: string) {
  const row = (await pool.query<{ results_published_at: Date | null; results_published_by: string | null }>(
    'SELECT results_published_at,results_published_by FROM assignments WHERE id=$1', [assignmentId])).rows[0]!;
  return { resultsPublishedAt: row.results_published_at, resultsPublishedBy: row.results_published_by };
}

async function waitForBlockedQuery(queryFragment: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const blocked = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1`, [`%${queryFragment}%`]);
    if (blocked.rowCount) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for blocked query containing: ${queryFragment}`);
}

async function revokeTeacherWhileRequestWaits(run: () => Promise<request.Response>) {
  const guard = await pool.connect();
  let committed = false;
  try {
    await guard.query('BEGIN');
    await guard.query(`SELECT 1 FROM class_teachers WHERE class_id=$1 AND teacher_id=$2 FOR UPDATE`,
      [id.classA, id.teacher1]);
    const pending = run();
    await waitForBlockedQuery('JOIN class_teachers ct');
    await guard.query('DELETE FROM class_teachers WHERE class_id=$1 AND teacher_id=$2', [id.classA, id.teacher1]);
    await guard.query('COMMIT');
    committed = true;
    return await pending;
  } finally {
    if (!committed) await guard.query('ROLLBACK');
    guard.release();
    await ensureTeacherAssignment();
  }
}

describe.skipIf(!target)('B4 assessment publication', () => {
  beforeAll(async () => {
    await ensureTeacherAssignment(id.teacher1);
    await ensureTeacherAssignment(id.teacher2);
    teacher = await login('GV001');
    teacher2 = await login('GV002');
    student = await login('SV001');
    expect(teacher2).toBeTruthy();
  }, 30000);

  afterAll(async () => { await pool.end(); });

  it('rejects grading when the teacher assignment is removed while authorization waits', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);

    const response = await revokeTeacherWhileRequestWaits(() => saveGrade(submission.body.id, teacher, {
      gradedVersionNumber: 1, score: 8,
    }));

    expect(response.status).toBe(404);
    expect(await gradeCount(assignmentId)).toBe(0);
    expect(await notificationCount(assignmentId)).toBe(0);
  });

  it('rejects publication when the teacher assignment is removed while authorization waits', async () => {
    const assignmentId = await assignmentFixture();

    const response = await revokeTeacherWhileRequestWaits(() => publish(assignmentId));

    expect(response.status).toBe(404);
    expect(await gradeCount(assignmentId)).toBe(0);
    expect(await publicationState(assignmentId)).toEqual({ resultsPublishedAt: null, resultsPublishedBy: null });
    expect(await notificationCount(assignmentId)).toBe(0);
  });

  it('keeps every Draft value out of student responses, errors, and notifications', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);
    const draft = await saveGrade(submission.body.id, teacher, {
      gradedVersionNumber: 1, score: 8, feedback: 'B4_PRIVATE_DRAFT_MARKER',
    });
    expect(draft.status).toBe(200);

    const mySubmission = await api.get(`/api/assignments/${assignmentId}/my-submission`)
      .auth(student, { type: 'bearer' });
    expect(mySubmission.body).not.toHaveProperty('grade');
    expect(mySubmission.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
    const myResult = await api.get(`/api/assignments/${assignmentId}/my-result`).auth(student, { type: 'bearer' });
    expect(myResult.status).toBe(404);
    expect(myResult.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
    const myHistory = await api.get(`/api/assignments/${assignmentId}/my-result/history`)
      .auth(student, { type: 'bearer' });
    expect(myHistory.status).toBe(404);
    expect(myHistory.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
    const blocked = await submit(assignmentId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
    expect(blocked.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
    expect(blocked.body.error).not.toHaveProperty('score');
    expect(await notificationCount(assignmentId)).toBe(0);
  });

  it('rolls back every publication write when notification creation fails', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);
    expect((await saveGrade(submission.body.id, teacher, { gradedVersionNumber: 1, score: 8 })).status).toBe(200);
    await pool.query(`CREATE FUNCTION b4_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'B4 injected notification failure' USING ERRCODE='P0001'; END $$`);
    await pool.query(`CREATE TRIGGER b4_notification_failure BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION b4_fail_notification()`);
    try {
      const response = await publish(assignmentId);
      expect(response.status).toBe(500);
      expect(response.text).not.toContain('P0001');
      expect(await gradeRows(assignmentId)).toEqual([{ status: 'DRAFT', score: '8.00', source: 'MANUAL' }]);
      expect(await historyCount(assignmentId, true)).toBe(0);
      expect(await publicationState(assignmentId)).toEqual({ resultsPublishedAt: null, resultsPublishedBy: null });
      expect(await notificationCount(assignmentId)).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS b4_notification_failure ON notifications');
      await pool.query('DROP FUNCTION IF EXISTS b4_fail_notification()');
    }
  });

  it('serializes simultaneous publication without duplicate results, history, or notifications', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);
    expect((await saveGrade(submission.body.id, teacher, { gradedVersionNumber: 1, score: 8 })).status).toBe(200);

    const responses = await Promise.all([publish(assignmentId, teacher), publish(assignmentId, teacher2)]);

    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses.map(response => response.body.automaticZeroCount).sort()).toEqual([0, 1]);
    expect(new Set(responses.map(response => response.body.publishedAt)).size).toBe(1);
    expect(await gradeCount(assignmentId)).toBe(2);
    expect(await historyCount(assignmentId)).toBe(3);
    expect(await notificationCount(assignmentId)).toBe(2);
    const firstPublisherIndex = responses.findIndex(response => response.body.automaticZeroCount === 1);
    expect((await publicationState(assignmentId)).resultsPublishedBy)
      .toBe(firstPublisherIndex === 0 ? id.teacher1 : id.teacher2);

    const before = {
      grades: await gradeCount(assignmentId),
      history: await historyCount(assignmentId),
      notifications: await notificationCount(assignmentId),
      publication: await publicationState(assignmentId),
    };
    expect((await publish(assignmentId, teacher)).status).toBe(200);
    expect({
      grades: await gradeCount(assignmentId),
      history: await historyCount(assignmentId),
      notifications: await notificationCount(assignmentId),
      publication: await publicationState(assignmentId),
    }).toEqual(before);
  });

  it('rejects invalid grade mutations without changing the grade or history', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);
    expect((await saveGrade(submission.body.id, teacher, {
      gradedVersionNumber: 1, score: 8, feedback: 'keep this feedback',
    })).status).toBe(200);
    const gradeBefore = await gradeSnapshot(assignmentId);
    const historyBefore = await historySnapshot(assignmentId);
    const invalidDrafts = [
      { gradedVersionNumber: 1, score: -1 },
      { gradedVersionNumber: 1, score: 10.001 },
      { gradedVersionNumber: 1, score: 11 },
      { gradedVersionNumber: 1, score: 8, feedback: 'x'.repeat(5001) },
      { gradedVersionNumber: 1, score: 8, unexpected: true },
    ];
    for (const body of invalidDrafts) {
      expect((await saveGrade(submission.body.id, teacher, body)).status).toBe(400);
      expect(await gradeSnapshot(assignmentId)).toEqual(gradeBefore);
      expect(await historySnapshot(assignmentId)).toEqual(historyBefore);
    }

    const automaticAssignmentId = await assignmentFixture();
    expect((await publish(automaticAssignmentId)).status).toBe(200);
    const automaticBefore = await gradeSnapshot(automaticAssignmentId);
    const automaticHistoryBefore = await historySnapshot(automaticAssignmentId);
    const invalidCorrections = [
      { score: -1 },
      { score: 8.001 },
      { score: 11 },
      { score: 8, feedback: 'x'.repeat(5001) },
      { score: 8, unexpected: true },
    ];
    for (const body of invalidCorrections) {
      const response = await api.put(`/api/assignments/${automaticAssignmentId}/grades/${id.student1}`)
        .auth(teacher, { type: 'bearer' }).send(body);
      expect(response.status).toBe(400);
      expect(await gradeSnapshot(automaticAssignmentId)).toEqual(automaticBefore);
      expect(await historySnapshot(automaticAssignmentId)).toEqual(automaticHistoryBefore);
    }
  });

  it('rejects a stale first graded version without writing a grade or history', async () => {
    const assignmentId = await assignmentFixture();
    const first = await submit(assignmentId);
    expect(first.status).toBe(201);
    expect((await submit(assignmentId)).status).toBe(201);

    const response = await saveGrade(first.body.id, teacher, { gradedVersionNumber: 1, score: 8 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STALE_SUBMISSION_VERSION');
    expect(await gradeCount(assignmentId)).toBe(0);
    expect(await historyCount(assignmentId)).toBe(0);
  });

  it('preserves omitted feedback, clears explicit null, and exposes only Published history to students', async () => {
    const assignmentId = await assignmentFixture();
    const submission = await submit(assignmentId);
    expect(submission.status).toBe(201);
    const originalFeedback = 'B4 feedback retained until explicitly cleared';
    expect((await saveGrade(submission.body.id, teacher, {
      gradedVersionNumber: 1, score: 8, feedback: originalFeedback,
    })).status).toBe(200);
    expect((await publish(assignmentId)).status).toBe(200);

    const omitted = await saveGrade(submission.body.id, teacher, { gradedVersionNumber: 1, score: 9 });
    expect(omitted.body).toMatchObject({ status: 'PUBLISHED', feedback: originalFeedback });
    const cleared = await saveGrade(submission.body.id, teacher, {
      gradedVersionNumber: 1, score: 9.5, feedback: null,
    });
    expect(cleared.body).toMatchObject({ status: 'PUBLISHED', feedback: null });

    const teacherHistory = await api.get(`/api/assignments/${assignmentId}/grades/${id.student1}/history`)
      .auth(teacher, { type: 'bearer' });
    const studentHistory = await api.get(`/api/assignments/${assignmentId}/my-result/history`)
      .auth(student, { type: 'bearer' });
    expect(teacherHistory.status).toBe(200);
    expect(studentHistory.status).toBe(200);
    expect(teacherHistory.body.items.map((item: { status: string }) => item.status))
      .toEqual(['DRAFT', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    expect(studentHistory.body.items.map((item: { status: string }) => item.status))
      .toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    expect(new Set(teacherHistory.body.items.map((item: { version: number }) => item.version)).size).toBe(4);
    expect(await notificationCount(assignmentId, id.student1)).toBe(3);
  });
});
