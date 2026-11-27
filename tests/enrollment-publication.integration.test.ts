import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds } from '../scripts/lib/seed-data.js';

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 8 });
const app = createApp({ corsOrigins: ['http://localhost:5173'], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'enrollment', audience: 'enrollment',
    cookieSecure: false, cookieSameSite: 'lax', origins: ['http://localhost:5173'] } } });
const api = request(app);
const password = 'B1IntegrationPassword2026!';
let adminToken: string;
let teacherToken: string;

async function login(schoolCode: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode, password });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

async function fixture() {
  const suffix = randomBytes(5).toString('hex').toUpperCase();
  const classResponse = await api.post('/api/classes').auth(adminToken, { type: 'bearer' }).send({
    code: `ENR-${suffix}`, courseCode: `C-${suffix}`, name: 'Enrollment publication', term: '2026-HK1',
  });
  expect(classResponse.status).toBe(201);
  const classId = classResponse.body.id as string;
  const assigned = await api.post(`/api/classes/${classId}/teachers`).auth(adminToken, { type: 'bearer' })
    .send({ teacherId: seedIds.teacher1 });
  expect(assigned.status).toBe(201);
  const assignment = await pool.query<{ id: string }>(`INSERT INTO assignments
    (class_id,created_by,title,deadline_at,max_score) VALUES($1,$2,'Published result',now()+interval '1 day',10)
    RETURNING id`, [classId, seedIds.teacher1]);
  return { classId, assignmentId: assignment.rows[0]!.id };
}

async function enrollment(classId: string, studentId = seedIds.student2) {
  const response = await api.post(`/api/classes/${classId}/enrollments`).auth(adminToken, { type: 'bearer' })
    .send({ studentId });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function setActive(classId: string, enrollmentId: string, isActive: boolean) {
  return api.patch(`/api/classes/${classId}/enrollments/${enrollmentId}`).auth(adminToken, { type: 'bearer' })
    .send({ isActive });
}

async function setUserActive(userId: string, isActive: boolean) {
  return api.patch(`/api/users/${userId}`).auth(adminToken, { type: 'bearer' }).send({ isActive });
}

async function publish(assignmentId: string) {
  const response = await api.post(`/api/assignments/${assignmentId}/grades/publish`)
    .auth(teacherToken, { type: 'bearer' });
  expect(response.status).toBe(200);
  return response;
}

async function gradeFor(assignmentId: string, enrollmentId: string) {
  return (await pool.query<Record<string, unknown>>('SELECT * FROM grades WHERE assignment_id=$1 AND enrollment_id=$2',
    [assignmentId, enrollmentId])).rows[0];
}

async function gradeCount(assignmentId: string, enrollmentId: string) {
  return (await pool.query('SELECT 1 FROM grades WHERE assignment_id=$1 AND enrollment_id=$2',
    [assignmentId, enrollmentId])).rowCount;
}

async function historyCount(assignmentId: string, enrollmentId: string) {
  return (await pool.query(`SELECT h.version FROM grade_history h JOIN grades g ON g.id=h.grade_id
    WHERE g.assignment_id=$1 AND g.enrollment_id=$2`, [assignmentId, enrollmentId])).rowCount;
}

async function publicationNotificationCount(assignmentId: string, studentId: string) {
  return (await pool.query(`SELECT 1 FROM notifications WHERE assignment_id=$1 AND recipient_id=$2
    AND kind='GRADE_PUBLISHED'`, [assignmentId, studentId])).rowCount;
}

async function publicationFor(assignmentId: string) {
  return (await pool.query<{ results_published_at: Date; results_published_by: string }>(
    'SELECT results_published_at,results_published_by FROM assignments WHERE id=$1', [assignmentId])).rows[0]!;
}

async function expectPublishedAutomaticZero(assignmentId: string, enrollmentId: string) {
  const publication = await publicationFor(assignmentId);
  expect(await gradeFor(assignmentId, enrollmentId)).toMatchObject({
    score: '0.00', status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION',
    submission_id: null, graded_version_number: null, graded_by: publication.results_published_by,
    published_by: publication.results_published_by, published_at: publication.results_published_at,
  });
}

async function pendingFile(studentId: string) {
  const fileId = randomUUID();
  await pool.query(`INSERT INTO files(id,storage_provider,storage_container,object_key,original_name,mime_type,size_bytes,uploaded_by)
    VALUES($1,'TEST','private',$2,'answer.pdf','application/pdf',128,$3)`, [fileId, randomUUID(), studentId]);
  return fileId;
}

describe.skipIf(!target)('published results during enrollment and reactivation', () => {
  beforeAll(async () => {
    adminToken = await login('ADMIN001');
    teacherToken = await login('GV001');
  }, 30000);
  afterAll(async () => { await pool.end(); });

  it('backfills a correctly attributed zero when enrollment follows an empty-cohort publication', async () => {
    const { classId, assignmentId } = await fixture();
    await publish(assignmentId);
    const enrollmentId = await enrollment(classId);
    const grade = await gradeFor(assignmentId, enrollmentId);
    expect(grade).toMatchObject({ score: '0.00', status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION',
      submission_id: null, graded_version_number: null, graded_by: seedIds.teacher1, published_by: seedIds.teacher1 });
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(1);
    expect(await historyCount(assignmentId, enrollmentId)).toBe(1);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(1);
    const studentToken = await login('SV002');
    const attempt = await api.post(`/api/assignments/${assignmentId}/submissions`).auth(studentToken, { type: 'bearer' })
      .send({ fileIds: [await pendingFile(seedIds.student2)] });
    expect(attempt.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });

  it('reactivation preserves an existing grade and history without another notification', async () => {
    const { classId, assignmentId } = await fixture();
    const enrollmentId = await enrollment(classId);
    await publish(assignmentId);
    const beforeGrade = await gradeFor(assignmentId, enrollmentId);
    const beforeHistory = await pool.query(`SELECT h.* FROM grade_history h JOIN grades g ON g.id=h.grade_id
      WHERE g.assignment_id=$1 AND g.enrollment_id=$2 ORDER BY h.version`, [assignmentId, enrollmentId]);
    const notificationCount = await publicationNotificationCount(assignmentId, seedIds.student2);
    expect((await setActive(classId, enrollmentId, false)).status).toBe(200);
    expect((await setActive(classId, enrollmentId, true)).status).toBe(200);
    expect(await gradeFor(assignmentId, enrollmentId)).toEqual(beforeGrade);
    const afterHistory = await pool.query(`SELECT h.* FROM grade_history h JOIN grades g ON g.id=h.grade_id
      WHERE g.assignment_id=$1 AND g.enrollment_id=$2 ORDER BY h.version`, [assignmentId, enrollmentId]);
    expect(afterHistory.rows).toEqual(beforeHistory.rows);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(notificationCount);
  });

  it('reactivation converts a missing result with a historical ungraded submission into one locked zero', async () => {
    const { classId, assignmentId } = await fixture();
    const enrollmentId = await enrollment(classId);
    await pool.query('INSERT INTO submissions(assignment_id,enrollment_id) VALUES($1,$2)', [assignmentId, enrollmentId]);
    expect((await setActive(classId, enrollmentId, false)).status).toBe(200);
    await publish(assignmentId);
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(0);
    expect((await setActive(classId, enrollmentId, true)).status).toBe(200);
    const grade = await gradeFor(assignmentId, enrollmentId);
    expect(grade).toMatchObject({ score: '0.00', status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION',
      submission_id: null, graded_version_number: null, graded_by: seedIds.teacher1, published_by: seedIds.teacher1 });
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(1);
    expect(await historyCount(assignmentId, enrollmentId)).toBe(1);
    expect((await pool.query('SELECT 1 FROM submissions WHERE assignment_id=$1 AND enrollment_id=$2',
      [assignmentId, enrollmentId])).rowCount).toBe(1);
    const studentToken = await login('SV002');
    const attempt = await api.post(`/api/assignments/${assignmentId}/submissions`).auth(studentToken, { type: 'bearer' })
      .send({ fileIds: [await pendingFile(seedIds.student2)] });
    expect(attempt.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });

  it('backfills published results when an inactive student account is reactivated', async () => {
    const { classId, assignmentId: priorAssignmentId } = await fixture();
    const enrollmentId = await enrollment(classId);
    await publish(priorAssignmentId);
    const priorGrade = await gradeFor(priorAssignmentId, enrollmentId);
    const priorHistory = await pool.query(`SELECT h.* FROM grade_history h JOIN grades g ON g.id=h.grade_id
      WHERE g.assignment_id=$1 AND g.enrollment_id=$2 ORDER BY h.version`, [priorAssignmentId, enrollmentId]);
    const newAssignment = await pool.query<{ id: string }>(`INSERT INTO assignments
      (class_id,created_by,title,deadline_at,max_score) VALUES($1,$2,'Published while inactive',now()+interval '1 day',10)
      RETURNING id`, [classId, seedIds.teacher1]);
    const assignmentId = newAssignment.rows[0]!.id;

    expect((await setUserActive(seedIds.student2, false)).status).toBe(200);
    await publish(assignmentId);
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(0);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(0);

    expect((await setUserActive(seedIds.student2, true)).status).toBe(200);

    expect(await gradeCount(assignmentId, enrollmentId)).toBe(1);
    expect(await historyCount(assignmentId, enrollmentId)).toBe(1);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(1);
    expect(await gradeFor(assignmentId, enrollmentId)).toMatchObject({ score: '0.00', status: 'PUBLISHED',
      source: 'AUTO_ZERO_NO_SUBMISSION', submission_id: null, graded_version_number: null,
      graded_by: seedIds.teacher1, published_by: seedIds.teacher1 });
    expect(await gradeFor(priorAssignmentId, enrollmentId)).toEqual(priorGrade);
    const afterPriorHistory = await pool.query(`SELECT h.* FROM grade_history h JOIN grades g ON g.id=h.grade_id
      WHERE g.assignment_id=$1 AND g.enrollment_id=$2 ORDER BY h.version`, [priorAssignmentId, enrollmentId]);
    expect(afterPriorHistory.rows).toEqual(priorHistory.rows);

    const studentToken = await login('SV002');
    const result = await api.get(`/api/assignments/${assignmentId}/my-result`).auth(studentToken, { type: 'bearer' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ assignmentId, score: 0, status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION',
      submissionId: null, gradedVersionNumber: null });
    const attempt = await api.post(`/api/assignments/${assignmentId}/submissions`).auth(studentToken, { type: 'bearer' })
      .send({ fileIds: [await pendingFile(seedIds.student2)] });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });

  it('serializes account reactivation with assignment publication', async () => {
    const { classId, assignmentId } = await fixture();
    const enrollmentId = await enrollment(classId);
    expect((await setUserActive(seedIds.student2, false)).status).toBe(200);

    const [reactivated, published] = await Promise.all([
      setUserActive(seedIds.student2, true),
      api.post(`/api/assignments/${assignmentId}/grades/publish`).auth(teacherToken, { type: 'bearer' }),
    ]);

    expect(reactivated.status).toBe(200);
    expect(published.status).toBe(200);
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(1);
    expect(await historyCount(assignmentId, enrollmentId)).toBe(1);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(1);
    await expectPublishedAutomaticZero(assignmentId, enrollmentId);
    const studentToken = await login('SV002');
    const attempt = await api.post(`/api/assignments/${assignmentId}/submissions`)
      .auth(studentToken, { type: 'bearer' }).send({ fileIds: [await pendingFile(seedIds.student2)] });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });

  it('serializes concurrent publication and enrollment into one grade and one history revision', async () => {
    const { classId, assignmentId } = await fixture();
    const [published, enrolled] = await Promise.all([
      api.post(`/api/assignments/${assignmentId}/grades/publish`).auth(teacherToken, { type: 'bearer' }),
      api.post(`/api/classes/${classId}/enrollments`).auth(adminToken, { type: 'bearer' }).send({ studentId: seedIds.student2 }),
    ]);
    expect(published.status).toBe(200);
    expect(enrolled.status).toBe(201);
    const enrollmentId = enrolled.body.id as string;
    expect(await gradeCount(assignmentId, enrollmentId)).toBe(1);
    expect(await historyCount(assignmentId, enrollmentId)).toBe(1);
    expect(await publicationNotificationCount(assignmentId, seedIds.student2)).toBe(1);
    await expectPublishedAutomaticZero(assignmentId, enrollmentId);
    const studentToken = await login('SV002');
    const attempt = await api.post(`/api/assignments/${assignmentId}/submissions`)
      .auth(studentToken, { type: 'bearer' }).send({ fileIds: [await pendingFile(seedIds.student2)] });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });
});
