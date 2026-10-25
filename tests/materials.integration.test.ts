import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import pg from 'pg';
import request from 'supertest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';
import { FileService } from '../src/modules/materials/file.service.js';
import type { ObjectStorage } from '../src/modules/materials/storage.js';

const testUrl = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: testUrl, max: 6 });
const objects = new Map<string, Buffer>();
let failPut = false; let failDelete = false;
const storage: ObjectStorage = {
  bucket: 'test-private',
  async put(key, path) { if (failPut) throw new Error('offline'); objects.set(key, await readFile(path)); },
  async get(key) { const body = objects.get(key); if (!body) throw new Error('missing'); return Readable.from(body); },
  async remove(key) { if (failDelete) throw new Error('offline'); objects.delete(key); },
};
const config = { secret: randomBytes(32).toString('hex'), issuer: 'lms-test', audience: 'lms-test-fe',
  cookieSecure: false, cookieSameSite: 'lax' as const, origins: ['http://localhost:5173'] };
const api = request(createApp({ corsOrigins: config.origins, checkDatabase: async () => {},
  business: { pool, auth: config, storage, loginLimit: 100 } }));
let teacher: string; let student: string; let other: string; let admin: string;
const password = 'B1IntegrationPassword2026!';
const spec = JSON.parse(await readFile('docs/openapi.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
ajv.addSchema({ ...spec, $id: 'b2-contract' });
function contract(schema: string, data: unknown) {
  const validate = ajv.getSchema(`b2-contract#/components/schemas/${schema}`)!;
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
}
async function login(schoolCode: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode, password });
  expect(response.status).toBe(200); return response.body.accessToken as string;
}
async function upload(token = teacher, name = 'lesson.txt', content: string | Buffer = 'Learning material', mime = 'text/plain') {
  return api.post('/api/files').auth(token, { type: 'bearer' })
    .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), { filename: name, contentType: mime });
}
async function create(fileIds: string[], title = 'Week 02 material') {
  return api.post(`/api/classes/${id.classA}/materials`).auth(teacher, { type: 'bearer' })
    .send({ title, description: 'Lecture notes', fileIds });
}

describe.skipIf(!testUrl)('B2 materials, private files and B1 bulk enrollment', () => {
  beforeAll(async () => {
    teacher = await login('GV001'); student = await login('SV001'); other = await login('SV003'); admin = await login('ADMIN001');
  }, 30000);
  afterAll(async () => { await pool.end(); });

  it('streams an upload and exposes only the File contract', async () => {
    const response = await upload(); expect(response.status).toBe(201); contract('File', response.body);
    expect(Object.keys(response.body).sort()).toEqual(['createdAt', 'id', 'mimeType', 'originalName', 'sizeBytes']);
    const row = (await pool.query('SELECT * FROM files WHERE id=$1', [response.body.id])).rows[0];
    expect(row.lifecycle_status).toBe('PENDING'); expect(objects.get(row.object_key)?.toString()).toBe('Learning material');
    expect((await api.get(`/api/files/${row.id}/download`).auth(teacher, { type: 'bearer' })).status).toBe(404);
  });

  it('creates, lists, reads, updates and downloads a material with class authorization', async () => {
    const file = (await upload(teacher, 'bài giảng.TXT')).body;
    const created = await create([file.id]); expect(created.status).toBe(201); contract('Material', created.body);
    const materialId = created.body.id;
    const list = await api.get(`/api/classes/${id.classA}/materials?limit=1`).auth(student, { type: 'bearer' });
    expect(list.status).toBe(200); contract('MaterialPage', list.body);
    if (list.body.page.nextCursor) {
      const anotherTeacher = await login('GV002');
      const next = await api.get(`/api/classes/${id.classA}/materials`).query({ cursor: list.body.page.nextCursor, limit: 1 })
        .auth(student, { type: 'bearer' });
      expect(next.status).toBe(200); expect(next.body.items[0].id).not.toBe(list.body.items[0].id);
      expect((await api.get(`/api/classes/${id.classA}/materials`).query({ cursor: list.body.page.nextCursor })
        .auth(anotherTeacher, { type: 'bearer' })).status).toBe(400);
    }
    const read = await api.get(`/api/materials/${materialId}`).auth(student, { type: 'bearer' });
    expect(read.status).toBe(200); contract('Material', read.body);
    const downloaded = await api.get(`/api/files/${file.id}/download`).auth(student, { type: 'bearer' });
    expect(downloaded.status).toBe(200); expect(downloaded.body.toString()).toBe('Learning material');
    expect(downloaded.headers['content-disposition']).toContain('attachment;');
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect((await api.get(`/api/files/${file.id}/download`).auth(other, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/materials/${materialId}`).auth(other, { type: 'bearer' })).status).toBe(404);
    expect((await api.patch(`/api/materials/${materialId}`).auth(student, { type: 'bearer' }).send({ title: 'hacked' })).status).toBe(403);
    const updated = await api.patch(`/api/materials/${materialId}`).auth(teacher, { type: 'bearer' })
      .send({ title: 'Updated title', description: null, fileIds: [file.id] });
    expect(updated.status).toBe(200); expect(updated.body.description).toBeNull(); contract('Material', updated.body);
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1', [id.enrollment1]);
    expect((await api.get(`/api/files/${file.id}/download`).auth(student, { type: 'bearer' })).status).toBe(404);
    await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1', [id.enrollment1]);
  });

  it('rejects reused, foreign, expired and duplicate files without partial material creation', async () => {
    const foreign = (await upload(student)).body.id;
    const owned = (await upload()).body.id;
    const expired = (await upload()).body.id;
    await pool.query("UPDATE files SET created_at=now()-interval '25 hours' WHERE id=$1", [expired]);
    for (const ids of [[foreign], [owned, owned], [expired]]) expect((await create(ids)).status).toBe(400);
    const before = Number((await pool.query('SELECT count(*) FROM materials')).rows[0].count);
    expect((await create([owned, foreign])).status).toBe(400);
    expect(Number((await pool.query('SELECT count(*) FROM materials')).rows[0].count)).toBe(before);
    expect((await create([owned])).status).toBe(201);
    expect((await create([owned])).status).toBe(400);
  });

  it('serializes competing attachments so one file has only one parent', async () => {
    const file = (await upload()).body.id;
    const responses = await Promise.all([create([file]), create([file])]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    expect((await pool.query('SELECT count(*) FROM material_files WHERE file_id=$1', [file])).rows[0].count).toBe('1');
  });

  it('enforces the ten-file material boundary through HTTP and a deferred database constraint', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 11; n++) ids.push((await upload()).body.id);
    expect((await create(ids)).status).toBe(400);
    const material = await create(ids.slice(0, 10)); expect(material.status).toBe(201);
    await expect(pool.query('INSERT INTO material_files(material_id,file_id) VALUES($1,$2)', [material.body.id, ids[10]]))
      .rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT lifecycle_status FROM files WHERE id=$1', [ids[10]])).rows[0].lifecycle_status).toBe('PENDING');
  });

  it('replaces attachments and retries failed deletion without deleting linked files', async () => {
    const oldFile = (await upload()).body.id; const newFile = (await upload()).body.id;
    const materialId = (await create([oldFile])).body.id;
    const update = await api.patch(`/api/materials/${materialId}`).auth(teacher, { type: 'bearer' }).send({ fileIds: [newFile] });
    expect(update.status).toBe(200);
    expect((await api.get(`/api/files/${oldFile}/download`).auth(student, { type: 'bearer' })).status).toBe(404);
    const service = new FileService(pool, storage); failDelete = true;
    await service.cleanup(); failDelete = false;
    const pending = (await pool.query('SELECT * FROM files WHERE id=$1', [oldFile])).rows[0];
    expect(pending.lifecycle_status).toBe('DELETE_PENDING'); expect(pending.delete_attempted_at).toBeTruthy();
    await pool.query("UPDATE files SET delete_attempted_at=now()-interval '6 minutes' WHERE id=$1", [oldFile]);
    expect(await service.cleanup()).toBeGreaterThan(0);
    expect((await pool.query('SELECT 1 FROM files WHERE id=$1', [oldFile])).rowCount).toBe(0);
    expect((await pool.query('SELECT lifecycle_status FROM files WHERE id=$1', [newFile])).rows[0].lifecycle_status).toBe('ATTACHED');
  });

  it('keeps a cleanup record on storage failure and reports 503', async () => {
    failPut = true; const response = await upload(teacher, 'failed.txt'); failPut = false;
    expect(response.status).toBe(503);
    const pending = (await pool.query("SELECT lifecycle_status FROM files WHERE original_name='failed.txt'")).rows[0];
    expect(pending.lifecycle_status).toBe('DELETE_PENDING');
  });

  it('rejects missing/extra/empty/oversized files, invalid MIME and denied extensions', async () => {
    expect((await api.post('/api/files').auth(teacher, { type: 'bearer' }).send({})).status).toBe(400);
    expect((await api.post('/api/files').auth(teacher, { type: 'bearer' })
      .set('Content-Type', 'multipart/form-data; boundary=missing').send('malformed body')).status).toBe(400);
    expect((await upload(teacher, 'empty.txt', '')).status).toBe(400);
    expect((await upload(teacher, 'exact-limit.txt', Buffer.alloc(25 * 1024 * 1024, 65))).status).toBe(201);
    expect((await upload(teacher, 'file.txt', Buffer.alloc(25 * 1024 * 1024 + 1, 65))).status).toBe(413);
    expect((await upload(teacher, 'fake.pdf', 'not a PDF', 'application/pdf')).status).toBe(415);
    expect((await upload(teacher, 'file.exe')).status).toBe(415);
    expect((await upload(teacher, 'file.constructor')).status).toBe(415);
    expect((await upload(teacher, 'file.__proto__')).status).toBe(415);
    expect((await upload(teacher, 'file.txt', 'hello', 'application/pdf')).status).toBe(415);
    expect((await api.post('/api/files').auth(teacher, { type: 'bearer' })
      .attach('file', Buffer.from('one'), 'one.txt').attach('file', Buffer.from('two'), 'two.txt')).status).toBe(400);
    expect((await upload(admin)).status).toBe(403);
    expect((await api.post('/api/files').attach('file', Buffer.from('one'), 'one.txt')).status).toBe(401);
    const result = await api.post(`/api/classes/${id.classB}/materials`).auth(student, { type: 'bearer' }).send({ title: 'no', fileIds: [] });
    expect(result.status).toBe(403);
  }, 30000);

  it('protects student submission files from classmates but permits assigned teachers and the author', async () => {
    const file = (await upload(student)).body.id;
    // Existing seed submission v1 belongs to SV001 in class A.
    await pool.query('INSERT INTO submission_files(submission_id,version_number,file_id) VALUES($1,1,$2)', [id.submission1, file]);
    const classmate = await login('SV002');
    expect((await api.get(`/api/files/${file}/download`).auth(classmate, { type: 'bearer' })).status).toBe(404);
    expect((await api.get(`/api/files/${file}/download`).auth(student, { type: 'bearer' })).status).toBe(200);
    expect((await api.get(`/api/files/${file}/download`).auth(teacher, { type: 'bearer' })).status).toBe(200);
  });

  it('bulk enrolls independently with normalized codes, duplicate handling, inactive rejection and result backfill', async () => {
    const assignmentId = randomUUID();
    await pool.query(`INSERT INTO assignments(id,class_id,title,deadline_at,max_score,created_by)
      VALUES($1,$2,'Bulk enrollment result',now(),10,$3)`, [assignmentId, id.classA, id.teacher1]);
    const published = await api.post(`/api/assignments/${assignmentId}/grades/publish`).auth(teacher, { type: 'bearer' });
    expect(published.status).toBe(200);
    const result = await api.post(`/api/classes/${id.classA}/enrollments/bulk`).auth(admin, { type: 'bearer' }).send({ students: [
      { row: 1, schoolCode: 'sv003' }, { row: 2, schoolCode: 'SV003' }, { row: 3, schoolCode: 'NO_ACCOUNT' },
      { row: 4, schoolCode: 'GV001' }, { row: 5, schoolCode: 'SV001' },
    ] });
    expect(result.status).toBe(200); contract('BulkEnrollmentResult', result.body);
    expect(result.body.items.map((item: { status: string }) => item.status))
      .toEqual(['ENROLLED', 'ALREADY_ENROLLED', 'NOT_FOUND', 'INVALID_ROLE', 'ALREADY_ENROLLED']);
    expect(result.body.successCount).toBe(1); expect(result.body.failureCount).toBe(4);
    const grade = await api.get(`/api/assignments/${assignmentId}/my-result`).auth(other, { type: 'bearer' });
    expect(grade.status).toBe(200); expect(grade.body.score).toBe(0); expect(grade.body.source).toBe('AUTO_ZERO_NO_SUBMISSION');
    await pool.query('UPDATE enrollments SET is_active=false WHERE student_id=$1 AND class_id=$2', [id.student3, id.classA]);
    const reactivated = await api.post(`/api/classes/${id.classA}/enrollments/bulk`).auth(admin, { type: 'bearer' })
      .send({ students: [{ row: 1, schoolCode: 'SV003' }] });
    expect(reactivated.body.items[0].status).toBe('ENROLLED');
    expect((await pool.query('SELECT count(*) FROM grades WHERE assignment_id=$1 AND enrollment_id IN (SELECT id FROM enrollments WHERE student_id=$2)',
      [assignmentId, id.student3])).rows[0].count).toBe('1');
  });

  it('validates bulk request limits, authorization and class existence', async () => {
    const path = `/api/classes/${id.classA}/enrollments/bulk`;
    expect((await api.post(path).auth(admin, { type: 'bearer' }).send({ students: [] })).status).toBe(400);
    expect((await api.post(path).auth(admin, { type: 'bearer' }).send({ students: Array.from({ length: 501 }, (_, row) => ({ row: row + 1, schoolCode: 'SV001' })) })).status).toBe(400);
    expect((await api.post(path).auth(teacher, { type: 'bearer' }).send({ students: [{ row: 1, schoolCode: 'SV001' }] })).status).toBe(403);
    expect((await api.post(`/api/classes/${randomUUID()}/enrollments/bulk`).auth(admin, { type: 'bearer' })
      .send({ students: [{ row: 1, schoolCode: 'SV001' }] })).status).toBe(404);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [id.student3]);
    const response = await api.post(path).auth(admin, { type: 'bearer' }).send({ students: [{ row: 1, schoolCode: 'SV003' }] });
    expect(response.body.items[0].status).toBe('NOT_FOUND');
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [id.student3]);
  });
});
