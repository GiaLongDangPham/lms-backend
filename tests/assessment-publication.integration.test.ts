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

async function notificationCount(assignmentId: string) {
  return (await pool.query('SELECT 1 FROM notifications WHERE assignment_id=$1', [assignmentId])).rowCount;
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
});
