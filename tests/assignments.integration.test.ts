import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 8 });
const app = createApp({ corsOrigins: [], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'assignments', audience: 'assignments',
    cookieSecure: false, cookieSameSite: 'lax', origins: [] } } });
const api = request(app);
const password = 'B1IntegrationPassword2026!';
let teacher: string; let student: string; let foreignStudent: string;

async function login(code: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode: code, password });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

async function assignment(classId: string = id.classA) {
  return (await pool.query<{ id: string }>(`INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by)
    VALUES($1,'Assignment boundary fixture',now()+interval '1 day',10,$2) RETURNING id`,
  [classId, classId === id.classA ? id.teacher1 : id.teacher2])).rows[0]!.id;
}

async function pendingFile(owner: string = id.student1, size: number = 128) {
  const fileId = randomUUID();
  await pool.query(`INSERT INTO files(id,storage_provider,storage_container,object_key,original_name,mime_type,size_bytes,uploaded_by)
    VALUES($1,'TEST','private',$2,'answer.pdf','application/pdf',$3,$4)`, [fileId, randomUUID(), size, owner]);
  return fileId;
}

const submit = (assignmentId: string, token = student, fileIds?: string[]) => api
  .post(`/api/assignments/${assignmentId}/submissions`).auth(token, { type: 'bearer' })
  .send({ fileIds: fileIds ?? [] });

async function fileStatus(fileIds: string[]) {
  return (await pool.query<{ id: string; lifecycle_status: string }>(
    'SELECT id,lifecycle_status FROM files WHERE id=ANY($1::uuid[]) ORDER BY id', [fileIds])).rows;
}

describe.skipIf(!target)('assignment and submission boundaries', () => {
  beforeAll(async () => {
    teacher = await login('GV001');
    student = await login('SV001');
    foreignStudent = await login('SV002');
  }, 30000);
  afterAll(async () => { await pool.end(); });

  it('keeps assignment and submission access scoped to the assigned class and owner', async () => {
    const own = await assignment();
    const foreign = await assignment(id.classB);
    expect((await api.patch(`/api/assignments/${own}`).auth(teacher, { type: 'bearer' })
      .send({ title: 'Assigned teacher update' })).status).toBe(200);
    const submitted = await submit(own, student, [await pendingFile()]);
    expect(submitted.status).toBe(201);
    expect((await api.get(`/api/submissions/${submitted.body.id}`).auth(foreignStudent, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/assignments/${foreign}`).auth(teacher, { type: 'bearer' })).status).toBe(404);
    expect((await api.patch(`/api/assignments/${foreign}`).auth(teacher, { type: 'bearer' })
      .send({ title: 'No access' })).status).toBe(404);
  });

  it('rejects malformed and cross-list cursors', async () => {
    const malformed = await api.get(`/api/classes/${id.classA}/assignments`).query({ cursor: 'not-a-cursor' })
      .auth(student, { type: 'bearer' });
    expect(malformed.status).toBe(400);
    const cursor = Buffer.from(JSON.stringify({ id: randomUUID(), scope: `assignments:${id.classB}` })).toString('base64url');
    const crossList = await api.get(`/api/classes/${id.classA}/assignments`).query({ cursor }).auth(student, { type: 'bearer' });
    expect(crossList.status).toBe(400);
  });

  it('rejects invalid file sets without creating a version or changing candidate lifecycle', async () => {
    const assignmentId = await assignment();
    const duplicate = await pendingFile();
    const foreign = await pendingFile(id.student2);
    const attached = await pendingFile();
    const attachedSubmission = await submit(assignmentId, student, [attached]);
    expect(attachedSubmission.status).toBe(201);
    const submissionId = attachedSubmission.body.id as string;
    const missing = randomUUID();
    const cases: Array<{ ids: string[]; status: number; code: string }> = [
      { ids: [duplicate, duplicate], status: 400, code: 'VALIDATION_ERROR' },
      { ids: [missing], status: 400, code: 'INVALID_FILES' },
      { ids: [foreign], status: 400, code: 'INVALID_FILES' },
      { ids: [attached], status: 400, code: 'INVALID_FILES' },
      { ids: await Promise.all(Array.from({ length: 11 }, () => pendingFile())), status: 400, code: 'VALIDATION_ERROR' },
      { ids: await Promise.all(Array.from({ length: 5 }, () => pendingFile(id.student1, 25 * 1024 * 1024))),
        status: 413, code: 'PAYLOAD_TOO_LARGE' },
    ];
    for (const testCase of cases) {
      const before = await pool.query<{ count: string }>('SELECT count(*) FROM submissions WHERE assignment_id=$1', [assignmentId]);
      const versionsBefore = await pool.query<{ count: string }>(
        'SELECT count(*) FROM submission_versions WHERE submission_id=$1', [submissionId]);
      const response = await submit(assignmentId, student, testCase.ids);
      expect(response.status).toBe(testCase.status);
      expect(response.body.error.code).toBe(testCase.code);
      const after = await pool.query<{ count: string }>('SELECT count(*) FROM submissions WHERE assignment_id=$1', [assignmentId]);
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
      const versionsAfter = await pool.query<{ count: string }>(
        'SELECT count(*) FROM submission_versions WHERE submission_id=$1', [submissionId]);
      expect(versionsAfter.rows[0]!.count).toBe(versionsBefore.rows[0]!.count);
      const candidates = testCase.ids.filter(idValue => idValue !== attached);
      expect((await fileStatus(candidates)).every(file => file.lifecycle_status === 'PENDING')).toBe(true);
    }
  });

  it('serializes concurrent first submissions into one submission with consecutive versions', async () => {
    const assignmentId = await assignment();
    const fileIds = await Promise.all([pendingFile(), pendingFile()]);
    const responses = await Promise.all(fileIds.map(fileId => submit(assignmentId, student, [fileId])));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(new Set(responses.map(response => response.body.id)).size).toBe(1);
    const versions = await pool.query<{ version_number: number }>(`SELECT version_number FROM submission_versions
      WHERE submission_id=$1 ORDER BY version_number`, [responses[0]!.body.id]);
    expect(versions.rows.map(row => row.version_number)).toEqual([1, 2]);
  });

  it('keeps deadline snapshots immutable and only reopens ungraded work after extension', async () => {
    const assignmentId = await assignment();
    await pool.query("UPDATE assignments SET deadline_at=now()-interval '1 hour' WHERE id=$1", [assignmentId]);
    const first = await submit(assignmentId, student, [await pendingFile()]);
    expect(first.status).toBe(201);
    expect(first.body.versions[0].isLate).toBe(true);
    const oldSnapshot = first.body.versions[0].deadlineAtSubmission;
    expect((await submit(assignmentId, student, [await pendingFile()])).body.error.code).toBe('DEADLINE_LOCKS_RESUBMISSION');
    const deadlineAt = new Date(Date.now() + 60_000).toISOString();
    expect((await api.patch(`/api/assignments/${assignmentId}`).auth(teacher, { type: 'bearer' })
      .send({ deadlineAt })).status).toBe(200);
    const reopened = await submit(assignmentId, student, [await pendingFile()]);
    expect(reopened.status).toBe(201);
    expect(reopened.body.versions.map((version: { deadlineAtSubmission: string }) => version.deadlineAtSubmission))
      .toEqual([oldSnapshot, deadlineAt]);
  });

  it('locks Draft, Published, and assignment-wide publication without exposing Draft grade data', async () => {
    const draftAssignment = await assignment();
    const draftSubmission = await submit(draftAssignment, student, [await pendingFile()]);
    expect(draftSubmission.status).toBe(201);
    expect((await api.put(`/api/submissions/${draftSubmission.body.id}/grade`).auth(teacher, { type: 'bearer' })
      .send({ gradedVersionNumber: 1, score: 8, feedback: 'private draft' })).status).toBe(200);
    await pool.query("UPDATE assignments SET deadline_at=now()-interval '1 hour' WHERE id=$1", [draftAssignment]);
    const draftDto = await api.get(`/api/submissions/${draftSubmission.body.id}`).auth(student, { type: 'bearer' });
    expect(draftDto.body).toMatchObject({ canSubmit: false, lockedReason: 'GRADED' });
    expect(draftDto.text).not.toContain('private draft');
    expect(draftDto.body).not.toHaveProperty('grade');
    expect((await api.patch(`/api/assignments/${draftAssignment}`).auth(teacher, { type: 'bearer' })
      .send({ deadlineAt: new Date(Date.now() + 60_000).toISOString() })).status).toBe(200);
    const afterExtension = await submit(draftAssignment, student, [await pendingFile()]);
    expect(afterExtension.status).toBe(409);
    expect(afterExtension.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');

    const publishedAssignment = await assignment();
    const publishedSubmission = await submit(publishedAssignment, student, [await pendingFile()]);
    expect((await api.put(`/api/submissions/${publishedSubmission.body.id}/grade`).auth(teacher, { type: 'bearer' })
      .send({ gradedVersionNumber: 1, score: 8 })).status).toBe(200);
    expect((await api.post(`/api/assignments/${publishedAssignment}/grades/publish`).auth(teacher, { type: 'bearer' })).status)
      .toBe(200);
    const publishedDto = await api.get(`/api/submissions/${publishedSubmission.body.id}`).auth(student, { type: 'bearer' });
    expect(publishedDto.body).toMatchObject({ canSubmit: false, lockedReason: 'GRADED' });

    const classWide = await assignment();
    expect((await api.post(`/api/assignments/${classWide}/grades/publish`).auth(teacher, { type: 'bearer' })).status).toBe(200);
    const autoZeroSubmissionId = (await pool.query<{ id: string }>(`INSERT INTO submissions(assignment_id,enrollment_id)
      VALUES($1,$2) RETURNING id`, [classWide, id.enrollment1])).rows[0]!.id;
    expect((await api.get(`/api/submissions/${autoZeroSubmissionId}`).auth(student, { type: 'bearer' })).body)
      .toMatchObject({ canSubmit: false, lockedReason: 'GRADED' });
  });

  it('locks a historical ungraded submission after publication and enrollment reactivation', async () => {
    const assignmentId = await assignment();
    const enrollmentId = id.enrollment1;
    const submissionId = (await pool.query<{ id: string }>(`INSERT INTO submissions(assignment_id,enrollment_id)
      VALUES($1,$2) RETURNING id`, [assignmentId, enrollmentId])).rows[0]!.id;
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1', [enrollmentId]);
    expect((await api.post(`/api/assignments/${assignmentId}/grades/publish`).auth(teacher, { type: 'bearer' })).status).toBe(200);
    await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1', [enrollmentId]);
    const response = await api.get(`/api/submissions/${submissionId}`).auth(student, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ canSubmit: false, lockedReason: 'GRADED' });
    expect(response.body).not.toHaveProperty('grade');
  });
});
