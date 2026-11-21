import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';
const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target });
const api = request(createApp({ corsOrigins: [], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 't4', audience: 't4',
    origins: [], cookieSameSite: 'lax', cookieSecure: false } } }));
let teacher: string, student: string, admin: string;
const get = (path: string, token = teacher) => api.get('/api' + path).auth(token, { type: 'bearer' });
async function assignment() {
  const result = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher, { type: 'bearer' })
    .send({ title: 'T4 fixture', maxScore: 10, deadlineAt: new Date(Date.now() + 86400000).toISOString() });
  expect(result.status).toBe(201); return result.body.id as string;
}
async function submit(assignmentId: string) {
  const fileId = randomUUID();
  await pool.query(`INSERT INTO files(id,storage_provider,storage_container,object_key,original_name,mime_type,size_bytes,uploaded_by)
    VALUES($1,'TEST','private',$2,'answer.pdf','application/pdf',128,$3)`, [fileId, randomUUID(), id.student1]);
  return api.post(`/api/assignments/${assignmentId}/submissions`).auth(student, { type: 'bearer' }).send({ fileIds: [fileId] });
}
describe.skipIf(!target)('T4 QA regression', () => {
  beforeAll(async () => {
    const tokens = [];
    for (const schoolCode of ['GV001', 'SV001', 'ADMIN001']) {
      const response = await api.post('/api/auth/login').send({ schoolCode, password: 'B1IntegrationPassword2026!' });
      expect(response.status).toBe(200); tokens.push(response.body.accessToken as string);
    }
    [teacher, student, admin] = tokens as [string, string, string];
  }, 30000);
  afterAll(async () => { await pool.end(); });
  it('accepts late resubmission with immutable history but still locks after Draft grading', async () => {
    const a = await assignment(), first = await submit(a); expect(first.status).toBe(201);
    const old = first.body.versions[0];
    await pool.query("UPDATE assignments SET deadline_at=now()-interval '1 hour' WHERE id=$1", [a]);
    const next = await submit(a); expect(next.status).toBe(201);
    expect(next.body.versions[0]).toEqual(old);
    expect(next.body).toMatchObject({ currentVersionNumber: 2, canSubmit: true, lockedReason: null });
    expect(next.body.versions[1].isLate).toBe(true);
    expect((await api.put(`/api/submissions/${first.body.id}/grade`).auth(teacher, { type: 'bearer' })
      .send({ gradedVersionNumber: 2, score: 8, feedback: 'Draft secret' })).status).toBe(200);
    expect((await submit(a)).body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
    expect((await get(`/assignments/${a}/my-result`, student)).status).toBe(404);
  });
  it('rejects past creation deadline before persisting assignment or notification', async () => {
    const response = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher, { type: 'bearer' })
      .send({ title: 'T4 past deadline must reject', maxScore: 10, deadlineAt: '2000-01-01T00:00:00Z' });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await pool.query("SELECT 1 FROM assignments WHERE title='T4 past deadline must reject'")).rowCount).toBe(0);
  });
  it('returns teacher aggregate zero/corrections with scoped paging, while students cannot list grades', async () => {
    const a = await assignment();
    expect((await api.post(`/api/assignments/${a}/grades/publish`).auth(teacher, { type: 'bearer' })).status).toBe(200);
    const first = await get(`/assignments/${a}/grades?limit=1`); expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1); expect(first.body.items[0]).toMatchObject({ score: 0, source: 'AUTO_ZERO_NO_SUBMISSION' });
    const second = await get(`/assignments/${a}/grades?limit=1&cursor=${first.body.page.nextCursor}`);
    expect(second.status).toBe(200); expect(second.body.items[0].student.id).not.toBe(first.body.items[0].student.id);
    expect(second.body.page.nextCursor).toBeNull();
    for (const token of [student, admin]) expect((await get(`/assignments/${a}/grades`, token)).status).toBe(403);
    expect((await get(`/assignments/${id.assignmentB}/grades`)).status).toBe(404);
    expect((await get(`/assignments/${id.assignmentA}/grades?cursor=${first.body.page.nextCursor}`)).status).toBe(400);
    expect((await api.put(`/api/assignments/${a}/grades/${id.student1}`).auth(teacher, { type: 'bearer' })
      .send({ score: 2.5, feedback: 'Correction' })).status).toBe(200);
    const result = await get(`/assignments/${a}/my-result`, student); expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ score: 2.5, gradedBy: { id: id.teacher1 } });
    expect(result.body).not.toHaveProperty('gradedAt');
    expect((await get(`/assignments/${a}/grades`)).body.items.find((x: { student: { id: string } }) => x.student.id === id.student1))
      .toMatchObject({ score: 2.5, source: 'MANUAL' });
    expect((await submit(a)).body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
  });
});
