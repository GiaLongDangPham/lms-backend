import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 4 });
const api = request(createApp({ corsOrigins: [], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'comments', audience: 'comments',
    cookieSecure: false, cookieSameSite: 'lax', origins: [] } } }));
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
ajv.addSchema({ ...JSON.parse(readFileSync('docs/openapi.json', 'utf8')), $id: 'contract' });
function contract(name: string, data: unknown) {
  const validate = ajv.compile({ $ref: `contract#/components/schemas/${name}` });
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
}
const assignmentPath = (value: string = id.assignmentA) => `/api/assignments/${value}/comments`;
const submissionPath = (value: string = id.submission1) => `/api/submissions/${value}/comments`;
let teacher: string; let student: string; let peer: string; let outsider: string; let admin: string;
async function login(schoolCode: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode, password: 'B1IntegrationPassword2026!' });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}
const get = (path: string, token = student) => api.get(path).auth(token, { type: 'bearer' });
const post = (path: string, token = student, body: object = { body: 'Câu hỏi về bài tập' }) =>
  api.post(path).auth(token, { type: 'bearer' }).send(body);

describe.skipIf(!target)('B6 comments HTTP, persistence and authorization', () => {
  beforeAll(async () => {
    teacher = await login('GV001'); student = await login('SV001'); peer = await login('SV002');
    outsider = await login('SV003'); admin = await login('ADMIN001');
  }, 30000);
  afterAll(async () => { await pool.end(); });

  it('persists assignment discussion from the authenticated student and assigned teacher', async () => {
    const body = 'Em có thể nộp hai file không ạ?';
    const created = await post(assignmentPath(), student, { body: `  ${body}\n` });
    expect(created.status).toBe(201); contract('Comment', created.body);
    expect(created.body).toMatchObject({ assignmentId: id.assignmentA, submissionId: null, body,
      author: { id: id.student1, schoolCode: 'SV001', role: 'STUDENT' } });
    expect(Object.keys(created.body.author).sort()).toEqual(['fullName', 'id', 'role', 'schoolCode']);
    expect(created.headers['cache-control']).toBe('no-store');
    const stored = (await pool.query('SELECT author_id,assignment_id,submission_id,body FROM comments WHERE id=$1',
      [created.body.id])).rows[0];
    expect(stored).toEqual({ author_id: id.student1, assignment_id: id.assignmentA, submission_id: null, body });
    expect((await post(assignmentPath(), teacher)).status).toBe(201);
    const listed = await get(assignmentPath(), peer);
    expect(listed.status).toBe(200); contract('CommentPage', listed.body);
    expect(listed.body.items).toContainEqual(created.body);
    expect(listed.headers['cache-control']).toBe('no-store');
  });

  it('keeps submission discussion private to owner and assigned teachers', async () => {
    const created = await post(submissionPath());
    expect(created.status).toBe(201); contract('SubmissionComment', created.body);
    expect(created.body).toMatchObject({ assignmentId: null, submissionId: id.submission1,
      author: { id: id.student1 } });
    expect((await post(submissionPath(), teacher)).status).toBe(201);
    for (const token of [student, teacher]) {
      const listed = await get(submissionPath(), token);
      expect(listed.status).toBe(200); contract('SubmissionCommentPage', listed.body);
      expect(listed.body.items).toContainEqual(created.body);
      for (const item of listed.body.items) {
        expect(Object.keys(item).sort()).toEqual(['assignmentId', 'author', 'body', 'createdAt', 'id', 'submissionId']);
      }
    }
    const before = (await pool.query('SELECT count(*) FROM comments')).rows[0].count;
    for (const token of [peer, outsider]) {
      expect((await get(submissionPath(), token)).status).toBe(404);
      expect((await post(submissionPath(), token)).status).toBe(404);
    }
    expect((await pool.query('SELECT count(*) FROM comments')).rows[0].count).toBe(before);
  });

  it('denies outsiders and unassigned teachers without revealing target existence', async () => {
    for (const [path, token] of [
      [assignmentPath(), outsider], [assignmentPath(id.assignmentB), teacher],
      [assignmentPath(id.assignmentB), student], [assignmentPath(randomUUID()), student],
      [submissionPath(randomUUID()), teacher],
    ] as const) {
      for (const response of [await get(path, token), await post(path, token)]) {
        expect(response.status).toBe(404); expect(response.body.error.code).toBe('NOT_FOUND');
      }
    }
  });

  it('requires authentication, changed passwords and the contract roles', async () => {
    for (const path of [assignmentPath(), submissionPath()]) {
      expect((await api.get(path)).status).toBe(401);
      expect((await api.post(path).send({ body: 'Unauthenticated' })).status).toBe(401);
      expect((await get(path, 'invalid-token')).status).toBe(401);
      expect((await get(path, admin)).status).toBe(403);
      expect((await post(path, admin)).status).toBe(403);
    }
    await pool.query('UPDATE users SET must_change_password=true WHERE id=$1', [id.student1]);
    try {
      for (const path of [assignmentPath(), submissionPath()]) {
        expect((await get(path)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
        expect((await post(path)).status).toBe(403);
      }
    } finally { await pool.query('UPDATE users SET must_change_password=false WHERE id=$1', [id.student1]); }
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [id.student1]);
    try {
      expect((await get(assignmentPath())).status).toBe(401);
      expect((await post(submissionPath())).status).toBe(401);
    } finally { await pool.query('UPDATE users SET is_active=true WHERE id=$1', [id.student1]); }
  });

  it('revokes reads and writes when enrollment or teacher assignment is removed, preserving history', async () => {
    const created = await post(submissionPath()); expect(created.status).toBe(201);
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1', [id.enrollment1]);
    try {
      for (const path of [assignmentPath(), submissionPath()]) {
        expect((await get(path)).status).toBe(404); expect((await post(path)).status).toBe(404);
      }
      expect((await get(submissionPath(), teacher)).body.items).toContainEqual(created.body);
    } finally { await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1', [id.enrollment1]); }
    await pool.query('DELETE FROM class_teachers WHERE class_id=$1 AND teacher_id=$2', [id.classA, id.teacher1]);
    try {
      for (const path of [assignmentPath(), submissionPath()]) {
        expect((await get(path, teacher)).status).toBe(404); expect((await post(path, teacher)).status).toBe(404);
      }
    } finally {
      await pool.query('INSERT INTO class_teachers(class_id,teacher_id,assigned_by) VALUES($1,$2,$3)',
        [id.classA, id.teacher1, id.admin]);
    }
    expect((await get(submissionPath())).body.items).toContainEqual(created.body);
  });

  it('rejects forged identity/targets, blank bodies and malformed identifiers/queries', async () => {
    const before = (await pool.query('SELECT count(*) FROM comments')).rows[0].count;
    for (const path of [assignmentPath(), submissionPath()]) {
      for (const body of [{}, { body: '' }, { body: ' \n\t' }, { body: null }, { body: 1 },
        { body: 'Hello', authorId: id.teacher1 }, { body: 'Hello', assignmentId: id.assignmentB },
        { body: 'Hello', replyTo: randomUUID() }]) {
        const response = await post(path, student, body);
        expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
      for (const query of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: 'bad' },
        { cursor: 'not-a-cursor' }, { extra: 'x' }]) {
        expect((await get(path).query(query)).status).toBe(400);
      }
    }
    for (const path of [assignmentPath('invalid'), submissionPath('invalid')]) {
      expect((await get(path)).status).toBe(400); expect((await post(path)).status).toBe(400);
    }
    expect((await pool.query('SELECT count(*) FROM comments')).rows[0].count).toBe(before);
  });

  it('rejects a write racing with an enrollment deactivation that commits first', async () => {
    const revoker = await pool.connect();
    const body = `Concurrent revocation ${randomUUID()}`;
    let settled = false;
    let pending: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query('UPDATE enrollments SET is_active=false WHERE id=$1', [id.enrollment1]);
      pending = post(assignmentPath(), student, { body }).then(response => { settled = true; return response; });
      // Wait for the real competing DB operation, rather than guessing a scheduling delay.
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (!settled && !blocked && Date.now() < deadline) {
        blocked = (await pool.query<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0) AS blocked`)).rows[0]!.blocked;
        if (!settled && !blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(settled || blocked).toBe(true);
      await revoker.query('COMMIT');
      expect((await pending).status).toBe(404);
      expect((await pool.query('SELECT id FROM comments WHERE body=$1', [body])).rowCount).toBe(0);
    } finally {
      await revoker.query('ROLLBACK'); revoker.release();
      await pending;
      await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1', [id.enrollment1]);
    }
  });

  it('paginates a fixed dataset without duplicates and rejects cross-target cursors', async () => {
    const assignmentId = (await pool.query(`INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by)
      VALUES($1,'Pagination',now(),10,$2) RETURNING id`, [id.classA, id.teacher1])).rows[0].id as string;
    const path = assignmentPath(assignmentId);
    const empty = await get(path); expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], page: { nextCursor: null } });
    const ids: string[] = [];
    for (const body of ['First', 'Second', 'Third']) {
      const response = await post(path, student, { body }); expect(response.status).toBe(201);
      ids.push(response.body.id);
    }
    const seen: string[] = []; let cursor: string | null = null; let firstCursor = '';
    for (let n = 0; n < 3; n++) {
      const response = await get(path).query({ limit: 1, ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200); contract('CommentPage', response.body);
      expect(response.body.items).toHaveLength(1); seen.push(response.body.items[0].id);
      cursor = response.body.page.nextCursor;
      if (n === 0) { expect(cursor).toBeTypeOf('string'); firstCursor = cursor!; }
    }
    expect(cursor).toBeNull(); expect(seen).toEqual(ids.sort());
    for (const otherPath of [assignmentPath(), submissionPath()]) {
      expect((await get(otherPath).query({ cursor: firstCursor })).status).toBe(400);
    }
    // Submission list uses its own scope and the same bounded paging contract.
    const first = await get(submissionPath()).query({ limit: 1 });
    expect(first.status).toBe(200); expect(first.body.page.nextCursor).toBeTypeOf('string');
    const next = await get(submissionPath()).query({ limit: 1, cursor: first.body.page.nextCursor });
    expect(next.status).toBe(200); contract('SubmissionCommentPage', next.body);
    expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('allows result discussion after publication without returning Draft grade fields', async () => {
    const assignmentId = (await pool.query(`INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by)
      VALUES($1,'Published discussion',now(),10,$2) RETURNING id`, [id.classA, id.teacher1])).rows[0].id as string;
    const submissionId = (await pool.query(`INSERT INTO submissions(assignment_id,enrollment_id)
      VALUES($1,$2) RETURNING id`, [assignmentId, id.enrollment1])).rows[0].id as string;
    await pool.query('UPDATE assignments SET results_published_at=now(),results_published_by=$2 WHERE id=$1',
      [assignmentId, id.teacher1]);
    for (const path of [assignmentPath(assignmentId), submissionPath(submissionId)]) {
      const response = await post(path, student, { body: '<script>alert("text")</script> Hỏi điểm' });
      expect(response.status).toBe(201);
      expect(response.body.body).toBe('<script>alert("text")</script> Hỏi điểm');
      expect(response.body).not.toHaveProperty('grade'); expect(response.body).not.toHaveProperty('feedback');
    }
  });
});
