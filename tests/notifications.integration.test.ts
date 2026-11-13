import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed-data.js';
import { NotificationRepository } from '../src/modules/notifications/notification.repository.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';

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

  it('atomically snapshots one assignment-created event for each active student', async () => {
    const created = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher,{type:'bearer'}).send({
      title:'Bài tập thông báo',deadlineAt:'2026-11-20T10:00:00Z',maxScore:10,
    });
    expect(created.status).toBe(201);

    const rows = await pool.query<{recipient_id:string;title:string;body:string;deduplication_key:string}>(`SELECT
      recipient_id,title,body,deduplication_key FROM notifications
      WHERE assignment_id=$1 AND kind='ASSIGNMENT_CREATED' ORDER BY recipient_id`,[created.body.id]);
    expect(rows.rows).toEqual([
      { recipient_id:id.student1,title:'Bài tập mới',body:'Bài tập "Bài tập thông báo" đã được giao.',
        deduplication_key:`assignment-created:${created.body.id}` },
      { recipient_id:id.student2,title:'Bài tập mới',body:'Bài tập "Bài tập thông báo" đã được giao.',
        deduplication_key:`assignment-created:${created.body.id}` },
    ]);

    await api.patch(`/api/assignments/${created.body.id}`).auth(teacher,{type:'bearer'})
      .send({title:'Tiêu đề đã đổi'});
    expect((await pool.query<{body:string}>(`SELECT body FROM notifications WHERE assignment_id=$1
      AND kind='ASSIGNMENT_CREATED'`,[created.body.id])).rows.every(row=>row.body.includes('Bài tập thông báo'))).toBe(true);

    const service = new NotificationService(new NotificationRepository(pool));
    expect(await service.assignmentCreated(pool,{id:created.body.id,classId:id.classA,title:'Bài tập thông báo'})).toBe(0);
    expect((await pool.query(`SELECT 1 FROM notifications WHERE assignment_id=$1
      AND kind='ASSIGNMENT_CREATED'`,[created.body.id])).rowCount).toBe(2);
  });

  it('skips inactive enrollments and inactive student accounts for assignment-created events', async () => {
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1',[id.enrollment1]);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[id.student2]);
    try {
      const created = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher,{type:'bearer'}).send({
        title:'Không có người nhận',deadlineAt:'2026-11-20T10:00:00Z',maxScore:10,
      });
      expect(created.status).toBe(201);
      expect((await pool.query(`SELECT 1 FROM notifications WHERE assignment_id=$1
        AND kind='ASSIGNMENT_CREATED'`,[created.body.id])).rowCount).toBe(0);
    } finally {
      await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1',[id.enrollment1]);
      await pool.query('UPDATE users SET is_active=true WHERE id=$1',[id.student2]);
    }
  });

  it('rolls back assignment files and the assignment when notification insertion fails', async () => {
    const fileId=randomUUID();
    await pool.query(`INSERT INTO files(id,storage_provider,storage_container,object_key,
      original_name,mime_type,size_bytes,uploaded_by) VALUES($1,'TEST','private',$2,'fixture.pdf',
      'application/pdf',128,$3)`,[fileId,randomUUID(),id.teacher1]);
    await pool.query(`CREATE FUNCTION b5_reject_assignment_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.kind='ASSIGNMENT_CREATED' THEN RAISE EXCEPTION 'b5 probe'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER b5_reject_assignment_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION b5_reject_assignment_notification()`);
    try {
      const response = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher,{type:'bearer'}).send({
        title:'Rollback notification probe',deadlineAt:'2026-11-20T10:00:00Z',maxScore:10,fileIds:[fileId],
      });
      expect(response.status).toBe(500);
      expect((await pool.query("SELECT 1 FROM assignments WHERE title='Rollback notification probe'")).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM assignment_files WHERE file_id=$1',[fileId])).rowCount).toBe(0);
      expect((await pool.query<{lifecycle_status:string}>('SELECT lifecycle_status FROM files WHERE id=$1',[fileId]))
        .rows[0]?.lifecycle_status).toBe('PENDING');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS b5_reject_assignment_notification ON notifications');
      await pool.query('DROP FUNCTION IF EXISTS b5_reject_assignment_notification()');
    }
  });
});
