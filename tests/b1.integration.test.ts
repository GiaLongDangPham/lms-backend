import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { decodeJwt, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';
import { verifyPassword } from '../src/security/password.js';

const testUrl = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: testUrl, max: 4 });
const secret = randomBytes(32).toString('hex');
const origin = 'http://localhost:5173';
const app = createApp({ corsOrigins: [origin], checkDatabase: async () => { await pool.query('SELECT 1'); },
  business: { pool, auth: { secret, issuer: 'lms-test', audience: 'lms-test-fe', cookieSecure: false,
    cookieSameSite: 'lax', origins: [origin, 'http://localhost:3000'] }, loginLimit: 100 } });
const api = request(app);
const fixturePassword = 'B1IntegrationPassword2026!';
const spec = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
ajv.addSchema({ ...spec, $id: 'contract' });
function contract(path: string, method: string, status: number, value?: unknown) {
  const operation = spec.paths[path][method];
  let response = operation.responses[String(status)];
  expect(response, `${method} ${path} must declare ${status}`).toBeDefined();
  if (response.$ref) response = spec.components.responses[response.$ref.split('/').at(-1)];
  if (!response.content) return;
  const schema = response.content['application/json'].schema;
  const validate = ajv.compile(schema.$ref ? { $ref: 'contract' + schema.$ref } : schema);
  const valid = validate(value);
  expect(valid, JSON.stringify(validate.errors)).toBe(true);
}
async function login(code: string, password = fixturePassword) {
  const result = await api.post('/api/auth/login').set('Origin', origin).send({ schoolCode: code, password });
  expect(result.status).toBe(200); contract('/auth/login', 'post', 200, result.body);
  return { token: result.body.accessToken as string, user: result.body.user,
    cookie: (result.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! };
}
let admin: Awaited<ReturnType<typeof login>>;
let teacher: Awaited<ReturnType<typeof login>>;
let student: Awaited<ReturnType<typeof login>>;
let other: Awaited<ReturnType<typeof login>>;

describe.skipIf(!testUrl)('B1 PostgreSQL API and D2 response compatibility', () => {
  beforeAll(async () => {
    admin = await login('ADMIN001'); teacher = await login('GV001'); student = await login('SV001'); other = await login('SV003');
  }, 30000);
  afterAll(async () => { await pool.end(); });

  it('serves the shared D2 spec and Swagger UI', async () => {
    const specResponse = await api.get('/api/openapi.json'); expect(specResponse.status).toBe(200);
    expect(specResponse.body.paths['/assignments/{assignmentId}/submissions']).toBeDefined();
    const docs = await api.get('/api/docs/'); expect(docs.status).toBe(200); expect(docs.text).toContain('swagger-ui');
  });
  it('allows cookie authentication from the explicitly trusted Swagger API origin', async () => {
    const result = await api.post('/api/auth/login').set('Origin', 'http://localhost:3000')
      .send({ schoolCode: 'SV003', password: fixturePassword });
    expect(result.status).toBe(200);
    const cookie = (result.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const logout = await api.post('/api/auth/logout').set('Origin', 'http://localhost:3000').set('Cookie', cookie);
    expect(logout.status).toBe(204);
  });
  it('authenticates camelCase credentials and never exposes passwords or refresh tokens in JSON', async () => {
    const me = await api.get('/api/auth/me').auth(student.token, { type: 'bearer' });
    expect(me.status).toBe(200); contract('/auth/me', 'get', 200, me.body);
    expect(me.body.schoolCode).toBe('SV001'); expect(me.text).not.toContain('password');
    expect(student.user.passwordHash).toBeUndefined();
    const hashes = await pool.query('SELECT token_hash FROM auth_refresh_tokens');
    expect(hashes.rows.every(r => /^[a-f0-9]{64}$/.test(r.token_hash))).toBe(true);
  });
  it('rejects unknown codes, wrong passwords, malformed bodies and untrusted login origins', async () => {
    for (const schoolCode of ['UNKNOWN', 'SV001']) {
      const response = await api.post('/api/auth/login').send({ schoolCode, password: 'WrongPassword2026!' });
      expect(response.status).toBe(401); expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect((await api.post('/api/auth/login').send({ school_code: 'SV001', password: fixturePassword })).status).toBe(400);
    expect((await api.post('/api/auth/login').set('Origin', 'https://evil.invalid').send({ schoolCode: 'SV001', password: fixturePassword })).status).toBe(403);
  });
  it('rejects tampered, expired and wrong-audience JWTs', async () => {
    const key = new TextEncoder().encode(secret);
    const me = await api.get('/api/auth/me').auth(student.token + 'x', { type: 'bearer' }); expect(me.status).toBe(401);
    for (const audience of ['wrong-audience', 'lms-test-fe']) {
      const jwt = await new SignJWT({ sid: '00000000-0000-4000-8000-000000000001' })
        .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setSubject(id.student1).setIssuer('lms-test')
        .setAudience(audience).setIssuedAt().setJti('test').setExpirationTime(audience === 'lms-test-fe' ? '0s' : '15m').sign(key);
      expect((await api.get('/api/auth/me').auth(jwt, { type: 'bearer' })).status).toBe(401);
    }
  });
  it('restricts account creation and listing to Admin', async () => {
    expect((await api.get('/api/users')).status).toBe(401);
    for (const token of [teacher.token, student.token]) {
      expect((await api.get('/api/users').auth(token, { type: 'bearer' })).status).toBe(403);
      expect((await api.post('/api/users').auth(token, { type: 'bearer' }).send({})).status).toBe(403);
    }
  });
  it('preserves Vietnamese UTF-8 through class/user writes, PostgreSQL, reads and search (Bug-01)', async () => {
    const name = 'Cơ sở dữ liệu'; const description = 'Lớp học tiếng Việt – Nguyễn Ánh, ữ ỡ ệ';
    const created = await api.post('/api/classes').auth(admin.token, { type: 'bearer' })
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ code: 'UTF8', courseCode: 'UTF8', name, term: '2026-HK1', description }));
    expect(created.status).toBe(201); expect(created.headers['content-type']).toContain('charset=utf-8');
    expect(created.body.name).toBe(name); expect(created.body.description).toBe(description);
    const classId = created.body.id;
    const stored = (await pool.query('SELECT name,description FROM classes WHERE id=$1', [classId])).rows[0];
    expect(stored).toEqual({ name, description });
    const read = await api.get(`/api/classes/${classId}`).auth(admin.token, { type: 'bearer' });
    expect(read.body.name).toBe(name); expect(read.body.description).toBe(description);
    const updatedName = 'Cơ sở dữ liệu nâng cao';
    const patched = await api.patch(`/api/classes/${classId}`).auth(admin.token, { type: 'bearer' }).send({ name: updatedName });
    expect(patched.status).toBe(200); expect(patched.body.name).toBe(updatedName);
    const found = await api.get('/api/classes').query({ search: 'dữ liệu' }).auth(admin.token, { type: 'bearer' });
    expect(found.status).toBe(200); expect(found.body.items.find((item: { id: string }) => item.id === classId).name).toBe(updatedName);
    const fullName = 'Đặng Phạm Gia Long';
    const account = await api.post('/api/users').auth(admin.token, { type: 'bearer' })
      .send({ schoolCode: 'UTF8USER', fullName, role: 'STUDENT', initialPassword: fixturePassword });
    expect(account.status).toBe(201); expect(account.body.fullName).toBe(fullName);
    expect((await api.get(`/api/users/${account.body.id}`).auth(admin.token, { type: 'bearer' })).body.fullName).toBe(fullName);
    expect((await pool.query('SELECT full_name FROM users WHERE id=$1', [account.body.id])).rows[0].full_name).toBe(fullName);
  });
  it('uses stable cursor pages and rejects invalid/cross-list cursors', async () => {
    const first = await api.get('/api/users?limit=2').auth(admin.token, { type: 'bearer' });
    expect(first.status).toBe(200); contract('/users', 'get', 200, first.body);
    const next = await api.get('/api/users').query({ limit: 2, cursor: first.body.page.nextCursor }).auth(admin.token, { type: 'bearer' });
    expect(next.body.items).toHaveLength(2); expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    expect((await api.get('/api/classes').query({ cursor: first.body.page.nextCursor }).auth(admin.token, { type: 'bearer' })).status).toBe(400);
    expect((await api.get('/api/users?cursor=garbage').auth(admin.token, { type: 'bearer' })).status).toBe(400);
    expect((await api.get('/api/users?limit=101').auth(admin.token, { type: 'bearer' })).status).toBe(400);
  });
  it('creates an account with a hashed temporary password, enforces change and revokes the initial JWT', async () => {
    const response = await api.post('/api/users').auth(admin.token, { type: 'bearer' })
      .send({ schoolCode: ' sv004 ', fullName: 'Student Four', role: 'STUDENT', initialPassword: fixturePassword });
    expect(response.status).toBe(201); contract('/users', 'post', 201, response.body);
    expect(response.body.schoolCode).toBe('SV004'); expect(response.body.mustChangePassword).toBe(true);
    expect(response.text).not.toContain(fixturePassword);
    const row = await pool.query('SELECT password_hash FROM users WHERE id = $1', [response.body.id]);
    expect(await verifyPassword(fixturePassword, row.rows[0].password_hash)).toBe(true);
    const initial = await login('SV004');
    expect((await api.get('/api/classes').auth(initial.token, { type: 'bearer' })).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await api.post('/api/auth/change-password').auth(initial.token, { type: 'bearer' })
      .send({ currentPassword: fixturePassword, newPassword: 'ChangedPassword2026!' });
    expect(changed.status).toBe(204); contract('/auth/change-password', 'post', 204);
    expect((await api.get('/api/auth/me').auth(initial.token, { type: 'bearer' })).status).toBe(401);
    expect((await login('SV004', 'ChangedPassword2026!')).user.mustChangePassword).toBe(false);
  }, 15000);
  it('returns 409 for duplicate school codes and rejects privilege escalation', async () => {
    const create = { schoolCode: 'SV001', fullName: 'Duplicate', role: 'STUDENT', initialPassword: fixturePassword };
    const duplicate = await api.post('/api/users').auth(admin.token, { type: 'bearer' }).send(create);
    expect(duplicate.status).toBe(409); expect(duplicate.text).not.toContain('users_school_code');
    expect((await api.post('/api/users').auth(admin.token, { type: 'bearer' }).send({ ...create, role: 'ADMIN' })).status).toBe(400);
    expect((await api.patch(`/api/users/${id.student1}`).auth(admin.token, { type: 'bearer' }).send({ role: 'ADMIN' })).status).toBe(400);
    expect((await api.patch(`/api/users/${id.admin}`).auth(admin.token, { type: 'bearer' }).send({ isActive: false })).status).toBe(403);
  });
  it('filters classes by active membership and blocks cross-class reads', async () => {
    const classes = await api.get('/api/classes').auth(student.token, { type: 'bearer' });
    contract('/classes', 'get', 200, classes.body); expect(classes.body.items.map((c: {id:string}) => c.id)).toEqual([id.classA]);
    expect((await api.get(`/api/classes/${id.classB}`).auth(student.token, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/classes/${id.classB}`).auth(teacher.token, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/classes/${id.classA}`).auth(other.token, { type: 'bearer' })).status).toBe(404);
    const detail = await api.get(`/api/classes/${id.classA}`).auth(student.token, { type: 'bearer' });
    contract('/classes/{classId}', 'get', 200, detail.body);
  });
  it('creates/updates a class and enforces code + term uniqueness', async () => {
    const data = { code: 'B1-NEW', courseCode: 'B1-COURSE', name: 'New class', term: '2026-HK1' };
    const created = await api.post('/api/classes').auth(admin.token, { type: 'bearer' }).send(data);
    expect(created.status).toBe(201); contract('/classes', 'post', 201, created.body);
    expect((await api.post('/api/classes').auth(admin.token, { type: 'bearer' }).send(data)).status).toBe(409);
    const changed = await api.patch('/api/classes/'+created.body.id).auth(admin.token, { type: 'bearer' }).send({ name: 'Updated class' });
    expect(changed.status).toBe(200); contract('/classes/{classId}', 'patch', 200, changed.body);
    expect((await api.post('/api/classes').auth(teacher.token, { type: 'bearer' }).send(data)).status).toBe(403);
  });
  it('matches D2 teacher assignment routes and rejects wrong roles/duplicates', async () => {
    const path = `/api/classes/${id.classB}/teachers`;
    expect((await api.post(path).auth(admin.token, { type: 'bearer' }).send({ teacherId: id.student1 })).status).toBe(400);
    const assigned = await api.post(path).auth(admin.token, { type: 'bearer' }).send({ teacherId: id.teacher1 });
    expect(assigned.status).toBe(201); contract('/classes/{classId}/teachers', 'post', 201, assigned.body);
    expect((await api.post(path).auth(admin.token, { type: 'bearer' }).send({ teacherId: id.teacher1 })).status).toBe(409);
    const teachers = await api.get(path).auth(teacher.token, { type: 'bearer' });
    contract('/classes/{classId}/teachers', 'get', 200, teachers.body);
    for (const listed of teachers.body.items) {
      expect(listed).not.toHaveProperty('email');
      expect(listed).not.toHaveProperty('isActive');
      expect(listed).not.toHaveProperty('mustChangePassword');
      expect(listed).not.toHaveProperty('createdAt');
    }
    const guard = await pool.connect();
    await guard.query('BEGIN');
    await guard.query('SELECT 1 FROM class_teachers WHERE class_id=$1 AND teacher_id=$2 FOR KEY SHARE',
      [id.classB,id.teacher1]);
    let settled=false;
    const pendingRemoval=api.delete(path+'/'+id.teacher1).auth(admin.token, { type: 'bearer' })
      .then(result=>{settled=true;return result;});
    await new Promise(resolve=>setTimeout(resolve,100));
    expect(settled).toBe(false);
    await guard.query('COMMIT');guard.release();
    const removed = await pendingRemoval;
    expect(removed.status).toBe(204);
    expect((await api.get(`/api/classes/${id.classB}`).auth(teacher.token, { type: 'bearer' })).status).toBe(404);
  });
  it('limits class rosters to staff, validates enrollment role and handles duplicates', async () => {
    const path = `/api/classes/${id.classA}/enrollments`;
    const roster = await api.get(path).auth(teacher.token, { type: 'bearer' });
    expect(roster.status).toBe(200); contract('/classes/{classId}/enrollments', 'get', 200, roster.body);
    expect((await api.get(path).auth(student.token, { type: 'bearer' })).status).toBe(403);
    expect((await api.post(path).auth(admin.token, { type: 'bearer' }).send({ studentId: id.teacher1 })).status).toBe(400);
    expect((await api.post(path).auth(admin.token, { type: 'bearer' }).send({ studentId: id.student1 })).status).toBe(409);
  });
  it('withdraws access immediately, retains historical submissions/grades and re-enrolls the same record', async () => {
    const path = `/api/classes/${id.classA}/enrollments/${id.enrollment1}`;
    const disabled = await api.patch(path).auth(admin.token, { type: 'bearer' }).send({ isActive: false });
    expect(disabled.status).toBe(200); contract('/classes/{classId}/enrollments/{enrollmentId}', 'patch', 200, disabled.body);
    expect(disabled.body.student).toEqual({ id: student.user.id, schoolCode: student.user.schoolCode,
      fullName: student.user.fullName, role: 'STUDENT' });
    expect((await api.get(`/api/classes/${id.classA}`).auth(student.token, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/classes/${id.classA}/enrollments`).auth(teacher.token, { type: 'bearer' })).status).toBe(200);
    expect((await pool.query('SELECT id FROM submissions WHERE enrollment_id = $1', [id.enrollment1])).rowCount).toBe(2);
    expect((await pool.query('SELECT submission_id FROM grades WHERE submission_id = $1', [id.submission1])).rowCount).toBe(1);
    const re = await api.post(`/api/classes/${id.classA}/enrollments`).auth(admin.token, { type: 'bearer' }).send({ studentId: id.student1 });
    expect(re.status).toBe(201); expect(re.body.id).toBe(id.enrollment1);
    contract('/classes/{classId}/enrollments', 'post', 201, re.body);
    expect(re.body.student).toEqual({ id: student.user.id, schoolCode: student.user.schoolCode,
      fullName: student.user.fullName, role: 'STUDENT' });
    expect((await api.get(`/api/classes/${id.classA}`).auth(student.token, { type: 'bearer' })).status).toBe(200);
  });
  it('rotates refresh cookies, requires trusted Origin, and revokes a replayed token family', async () => {
    const session = await login('SV002');
    expect((await api.post('/api/auth/refresh').set('Cookie', session.cookie)).status).toBe(403);
    expect((await api.post('/api/auth/refresh').set('Origin', 'https://evil.invalid').set('Cookie', session.cookie)).status).toBe(403);
    const refreshed = await api.post('/api/auth/refresh').set('Origin', origin).set('Cookie', session.cookie).send({});
    expect(refreshed.status).toBe(200); contract('/auth/refresh', 'post', 200, refreshed.body);
    const newCookie = (refreshed.headers['set-cookie'] as unknown as string[])[0]!;
    expect(newCookie).toContain('HttpOnly'); expect(newCookie).toContain('SameSite=Lax'); expect(newCookie.split(';')[0]).not.toBe(session.cookie);
    const replay = await api.post('/api/auth/refresh').set('Origin', origin).set('Cookie', session.cookie).send({});
    expect(replay.status).toBe(401);
    expect((await api.get('/api/auth/me').auth(refreshed.body.accessToken, { type: 'bearer' })).status).toBe(401);
  });
  it('logs out and immediately invalidates the access JWT', async () => {
    const session = await login('SV002');
    const logout = await api.post('/api/auth/logout').auth(session.token, { type: 'bearer' });
    expect(logout.status).toBe(204);
    expect((await api.get('/api/auth/me').auth(session.token, { type: 'bearer' })).status).toBe(401);
    expect((await api.post('/api/auth/logout')).status).toBe(401);
  });
  it('Admin password reset revokes sessions and requires the new temporary password to be changed', async () => {
    const session = await login('SV002');
    const reset = await api.post(`/api/users/${id.student2}/reset-password`).auth(admin.token, { type: 'bearer' })
      .send({ initialPassword: 'ResetPassword2026!' });
    expect(reset.status).toBe(204);
    expect((await api.get('/api/auth/me').auth(session.token, { type: 'bearer' })).status).toBe(401);
    const next = await login('SV002', 'ResetPassword2026!'); expect(next.user.mustChangePassword).toBe(true);
  }, 15000);
  it('locks accounts without deleting historical data; reactivation cannot revive old JWTs', async () => {
    const session = await login('SV001');
    const changed = await api.patch(`/api/users/${id.student1}`).auth(admin.token, { type: 'bearer' }).send({ isActive: false });
    expect(changed.status).toBe(200); contract('/users/{userId}', 'patch', 200, changed.body);
    expect((await api.get('/api/auth/me').auth(session.token, { type: 'bearer' })).status).toBe(401);
    expect((await api.post('/api/auth/login').send({ schoolCode: 'SV001', password: fixturePassword })).status).toBe(401);
    expect((await pool.query('SELECT id FROM submissions WHERE enrollment_id = $1', [id.enrollment1])).rowCount).toBe(2);
    await api.patch(`/api/users/${id.student1}`).auth(admin.token, { type: 'bearer' }).send({ isActive: true });
    expect((await api.get('/api/auth/me').auth(session.token, { type: 'bearer' })).status).toBe(401);
    expect((await login('SV001')).user.isActive).toBe(true);
  });
  it('rejects missing class IDs, malformed UUIDs and enrollment IDs from another class', async () => {
    expect((await api.get('/api/classes/not-a-uuid').auth(admin.token, { type: 'bearer' })).status).toBe(400);
    expect((await api.get('/api/classes/00000000-0000-4000-8000-000000000000').auth(admin.token, { type: 'bearer' })).status).toBe(404);
    expect((await api.patch(`/api/classes/${id.classB}/enrollments/${id.enrollment1}`).auth(admin.token, { type: 'bearer' }).send({ isActive: false })).status).toBe(404);
  });
  it('expires refresh sessions and invalidates both cookie refresh and access JWTs', async () => {
    const session = await login('SV003');
    const sessionId = decodeJwt(session.token).sid;
    await pool.query(`UPDATE auth_sessions SET created_at = now() - interval '2 seconds',
      expires_at = now() - interval '1 second' WHERE id = $1`, [sessionId]);
    expect((await api.get('/api/auth/me').auth(session.token, { type: 'bearer' })).status).toBe(401);
    expect((await api.post('/api/auth/refresh').set('Origin', origin).set('Cookie', session.cookie).send({})).status).toBe(401);
  });
  it('limits failed login attempts and returns the declared 429 error', async () => {
    const limited = createApp({ corsOrigins: [origin], checkDatabase: async () => {}, business: { pool,
      auth: { secret, issuer: 'lms-test', audience: 'lms-test-fe', cookieSecure: false, cookieSameSite: 'lax', origins: [origin] }, loginLimit: 2 } });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await request(limited).post('/api/auth/login').send({ schoolCode: 'SV001', password: 'WrongPassword2026!' })).status).toBe(401);
    }
    const blocked = await request(limited).post('/api/auth/login').send({ schoolCode: 'SV001', password: fixturePassword });
    expect(blocked.status).toBe(429); contract('/auth/login', 'post', 429, blocked.body);
  });
});
