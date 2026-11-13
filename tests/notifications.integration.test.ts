import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 5 });
const app = createApp({ corsOrigins: [], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'notifications', audience: 'notifications',
    cookieSecure: false, cookieSameSite: 'lax', origins: [] } } });
const api = request(app);
const password = 'B1IntegrationPassword2026!';
let student1: string; let student2: string; let teacher: string; let admin: string;

const notificationIds = {
  oldest: '81000000-0000-4000-8000-000000000001',
  tiedLow: '81000000-0000-4000-8000-000000000002',
  tiedHigh: '81000000-0000-4000-8000-000000000003',
  newest: '81000000-0000-4000-8000-000000000004',
  other: '81000000-0000-4000-8000-000000000005',
} as const;

async function login(schoolCode: string) {
  const response = await api.post('/api/auth/login').send({ schoolCode, password });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

describe.skipIf(!target)('B5 student notifications', () => {
  beforeAll(async () => {
    [student1,student2,teacher,admin] = await Promise.all([
      login('SV001'), login('SV002'), login('GV001'), login('ADMIN001'),
    ]);
    await pool.query('DELETE FROM notifications');
    await pool.query(`INSERT INTO notifications
      (id,recipient_id,assignment_id,kind,title,body,deduplication_key,created_at) VALUES
      ($1,$6,$7,'ASSIGNMENT_CREATED','Oldest','Oldest body','n-oldest','2026-11-13T08:00:00Z'),
      ($2,$6,$7,'DEADLINE_REMINDER','Tie low','Tie low body','n-tie-low','2026-11-13T09:00:00Z'),
      ($3,$6,$7,'GRADE_PUBLISHED','Tie high','Tie high body','n-tie-high','2026-11-13T09:00:00Z'),
      ($4,$6,$7,'GRADE_PUBLISHED','Newest','Newest body','n-newest','2026-11-13T10:00:00Z'),
      ($5,$8,$7,'ASSIGNMENT_CREATED','Other','Other body','n-other','2026-11-13T11:00:00Z')`,
    [notificationIds.oldest,notificationIds.tiedLow,notificationIds.tiedHigh,
      notificationIds.newest,notificationIds.other,id.student1,id.assignmentA,id.student2]);
  }, 30000);

  afterAll(async () => { await pool.end(); });

  it('lists only the student notifications newest first with exact public fields and no-store', async () => {
    const response = await api.get('/api/notifications').auth(student1,{type:'bearer'});

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.items.map((item:{id:string})=>item.id)).toEqual([
      notificationIds.newest,notificationIds.tiedHigh,notificationIds.tiedLow,notificationIds.oldest,
    ]);
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'assignmentId','body','createdAt','id','kind','readAt','title',
    ]);
    expect(response.body.items.every((item:{id:string})=>item.id!==notificationIds.other)).toBe(true);
    expect(response.body.page.nextCursor).toBeNull();
  });

  it('paginates tied timestamps without duplicates and rejects malformed or cross-recipient cursors', async () => {
    const first = await api.get('/api/notifications').query({limit:2}).auth(student1,{type:'bearer'});
    expect(first.status).toBe(200);
    expect(first.body.items.map((item:{id:string})=>item.id)).toEqual([
      notificationIds.newest,notificationIds.tiedHigh,
    ]);
    expect(first.body.page.nextCursor).toEqual(expect.any(String));

    const second = await api.get('/api/notifications')
      .query({limit:2,cursor:first.body.page.nextCursor}).auth(student1,{type:'bearer'});
    expect(second.status).toBe(200);
    expect(second.body.items.map((item:{id:string})=>item.id)).toEqual([
      notificationIds.tiedLow,notificationIds.oldest,
    ]);
    expect(second.body.page.nextCursor).toBeNull();

    expect((await api.get('/api/notifications').query({cursor:'not-base64!'})
      .auth(student1,{type:'bearer'})).status).toBe(400);
    expect((await api.get('/api/notifications').query({cursor:first.body.page.nextCursor})
      .auth(student2,{type:'bearer'})).status).toBe(400);
  });

  it('restricts the inbox to students', async () => {
    const other = await api.get('/api/notifications').auth(student2,{type:'bearer'});
    expect(other.status).toBe(200);
    expect(other.body.items.map((item:{id:string})=>item.id)).toEqual([notificationIds.other]);
    for (const token of [teacher,admin]) {
      expect((await api.get('/api/notifications').auth(token,{type:'bearer'})).status).toBe(403);
    }
  });

  it('marks only an owned notification read once and hides foreign or missing IDs', async () => {
    const first = await api.patch(`/api/notifications/${notificationIds.oldest}/read`)
      .auth(student1,{type:'bearer'});
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: notificationIds.oldest, readAt: expect.any(String) });

    const repeated = await api.patch(`/api/notifications/${notificationIds.oldest}/read`)
      .auth(student1,{type:'bearer'});
    expect(repeated.status).toBe(200);
    expect(repeated.body.readAt).toBe(first.body.readAt);

    expect((await api.patch(`/api/notifications/${notificationIds.other}/read`)
      .auth(student1,{type:'bearer'})).status).toBe(404);
    expect((await api.patch(`/api/notifications/${randomUUID()}/read`)
      .auth(student1,{type:'bearer'})).status).toBe(404);
    const foreign = await pool.query<{read_at:Date|null}>('SELECT read_at FROM notifications WHERE id=$1',
      [notificationIds.other]);
    expect(foreign.rows[0]?.read_at).toBeNull();
  });
});
