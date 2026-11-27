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

async function createReminderAssignment(offset: string, title = 'Deadline reminder fixture') {
  return (await pool.query<{id:string;deadline_at:Date}>(`INSERT INTO assignments
    (class_id,title,deadline_at,max_score,created_by)
    VALUES($1,$2,clock_timestamp()+$3::interval,10,$4)
    RETURNING id,deadline_at`,[id.classA,`${title} ${randomUUID()}`,offset,id.teacher1])).rows[0]!;
}

async function reminderRecipients(assignmentId: string) {
  return (await pool.query<{recipient_id:string;deduplication_key:string}>(`SELECT recipient_id,deduplication_key
    FROM notifications WHERE assignment_id=$1 AND kind='DEADLINE_REMINDER' ORDER BY recipient_id`,
  [assignmentId])).rows;
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
    expect(response.body.unreadCount).toBe(4);
  });

  it('paginates tied timestamps without duplicates and rejects malformed or cross-recipient cursors', async () => {
    const first = await api.get('/api/notifications').query({limit:2}).auth(student1,{type:'bearer'});
    expect(first.status).toBe(200);
    expect(first.body.items.map((item:{id:string})=>item.id)).toEqual([
      notificationIds.newest,notificationIds.tiedHigh,
    ]);
    expect(first.body.page.nextCursor).toEqual(expect.any(String));
    expect(first.body.unreadCount).toBe(4);

    const second = await api.get('/api/notifications')
      .query({limit:2,cursor:first.body.page.nextCursor}).auth(student1,{type:'bearer'});
    expect(second.status).toBe(200);
    expect(second.body.items.map((item:{id:string})=>item.id)).toEqual([
      notificationIds.tiedLow,notificationIds.oldest,
    ]);
    expect(second.body.page.nextCursor).toBeNull();
    expect(second.body.unreadCount).toBe(4);

    expect((await api.get('/api/notifications').query({cursor:'not-base64!'})
      .auth(student1,{type:'bearer'})).status).toBe(400);
    expect((await api.get('/api/notifications').query({cursor:first.body.page.nextCursor})
      .auth(student2,{type:'bearer'})).status).toBe(400);
  });

  it('paginates PostgreSQL microsecond timestamps without skipping rows inside one millisecond', async () => {
    const newer = randomUUID();
    const older = randomUUID();
    await pool.query(`INSERT INTO notifications
      (id,recipient_id,assignment_id,kind,title,body,deduplication_key,created_at) VALUES
      ($1,$3,$4,'ASSIGNMENT_CREATED','Micro newer','Body',$5,'2026-11-13T12:00:00.123456Z'),
      ($2,$3,$4,'ASSIGNMENT_CREATED','Micro older','Body',$6,'2026-11-13T12:00:00.123455Z')`,
    [newer,older,id.student1,id.assignmentA,`micro-${newer}`,`micro-${older}`]);
    try {
      const first = await api.get('/api/notifications').query({limit:1}).auth(student1,{type:'bearer'});
      expect(first.body.items.map((item:{id:string})=>item.id)).toEqual([newer]);
      const second = await api.get('/api/notifications')
        .query({limit:1,cursor:first.body.page.nextCursor}).auth(student1,{type:'bearer'});
      expect(second.body.items.map((item:{id:string})=>item.id)).toEqual([older]);
    } finally {
      await pool.query('DELETE FROM notifications WHERE id=ANY($1::uuid[])',[[newer,older]]);
    }
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
    expect((await api.get('/api/notifications').auth(student1,{type:'bearer'})).body.unreadCount).toBe(3);

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
      title:'Bài tập thông báo',deadlineAt:'2030-11-20T10:00:00Z',maxScore:10,
    });
    expect(created.status).toBe(201);

    const rows = await pool.query<{recipient_id:string;title:string;body:string;deduplication_key:string}>(`SELECT
      recipient_id,title,body,deduplication_key FROM notifications
      WHERE assignment_id=$1 AND kind='ASSIGNMENT_CREATED' ORDER BY recipient_id`,[created.body.id]);
    expect(rows.rows).toEqual([
      { recipient_id:id.student1,title:'Bài tập mới',body:'Bài tập "Bài tập thông báo" · Lớp Demo A. Hạn nộp: 20/11/2030 17:00 (giờ Việt Nam).',
        deduplication_key:`assignment-created:${created.body.id}` },
      { recipient_id:id.student2,title:'Bài tập mới',body:'Bài tập "Bài tập thông báo" · Lớp Demo A. Hạn nộp: 20/11/2030 17:00 (giờ Việt Nam).',
        deduplication_key:`assignment-created:${created.body.id}` },
    ]);

    await api.patch(`/api/assignments/${created.body.id}`).auth(teacher,{type:'bearer'})
      .send({title:'Tiêu đề đã đổi'});
    expect((await pool.query<{body:string}>(`SELECT body FROM notifications WHERE assignment_id=$1
      AND kind='ASSIGNMENT_CREATED'`,[created.body.id])).rows.every(row=>row.body.includes('Bài tập thông báo'))).toBe(true);

    const service = new NotificationService(new NotificationRepository(pool));
    expect(await service.assignmentCreated(pool,{id:created.body.id,classId:id.classA,title:'Bài tập thông báo',
      deadlineAt:new Date('2026-11-20T10:00:00Z')})).toBe(0);
    expect((await pool.query(`SELECT 1 FROM notifications WHERE assignment_id=$1
      AND kind='ASSIGNMENT_CREATED'`,[created.body.id])).rowCount).toBe(2);

    await service.resultPublished(pool,{id:randomUUID(),assignmentId:created.body.id,revision:1},id.student1);
    const gradeBody=(await pool.query<{body:string}>(`SELECT body FROM notifications WHERE assignment_id=$1
      AND recipient_id=$2 AND kind='GRADE_PUBLISHED'`,[created.body.id,id.student1])).rows[0]!.body;
    expect(gradeBody).toBe('Kết quả bài tập "Tiêu đề đã đổi" · Lớp Demo A đã được cập nhật.');
    expect(gradeBody).not.toMatch(/10|điểm|nhận xét/i);
  });

  it('skips inactive enrollments and inactive student accounts for assignment-created events', async () => {
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1',[id.enrollment1]);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[id.student2]);
    try {
      const created = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher,{type:'bearer'}).send({
        title:'Không có người nhận',deadlineAt:'2030-11-20T10:00:00Z',maxScore:10,
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
        title:'Rollback notification probe',deadlineAt:'2030-11-20T10:00:00Z',maxScore:10,fileIds:[fileId],
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

  it('dispatches only deadlines in (now, now + 24 hours], using database-owned boundaries', async () => {
    const inside = await createReminderAssignment('23 hours 59 minutes');
    const boundary = await createReminderAssignment('24 hours');
    const outside = await createReminderAssignment('24 hours 1 minute');
    const due = await createReminderAssignment('0 seconds');
    const past = await createReminderAssignment('-1 minute');
    const published = await createReminderAssignment('1 hour');
    await pool.query('UPDATE assignments SET results_published_at=clock_timestamp(),results_published_by=$2 WHERE id=$1',
      [published.id,id.teacher1]);

    const service = new NotificationService(new NotificationRepository(pool));
    await service.dispatchDeadlineReminders();

    expect((await reminderRecipients(inside.id)).map(row=>row.recipient_id)).toEqual([id.student1,id.student2]);
    const reminderBody=(await pool.query<{body:string}>(`SELECT body FROM notifications WHERE assignment_id=$1
      AND kind='DEADLINE_REMINDER' LIMIT 1`,[inside.id])).rows[0]!.body;
    const deadlineInfo=(await pool.query<{title:string;value:string}>(`SELECT title,
      to_char(deadline_at AT TIME ZONE 'Asia/Ho_Chi_Minh','DD/MM/YYYY HH24:MI') AS value
      FROM assignments WHERE id=$1`,[inside.id])).rows[0]!;
    expect(reminderBody).toBe(`Bài tập "${deadlineInfo.title}" · Lớp Demo A. Hạn nộp: ${deadlineInfo.value} (giờ Việt Nam).`);
    expect((await reminderRecipients(boundary.id)).map(row=>row.recipient_id)).toEqual([id.student1,id.student2]);
    for (const assignment of [outside,due,past,published]) {
      expect(await reminderRecipients(assignment.id)).toEqual([]);
    }
  });

  it('suppresses ineligible students and remains idempotent across deadline changes and concurrent sweeps', async () => {
    const submitted = await createReminderAssignment('2 hours','Submitted');
    await pool.query('INSERT INTO submissions(assignment_id,enrollment_id) VALUES($1,$2)',
      [submitted.id,id.enrollment1]);
    const graded = await createReminderAssignment('3 hours','Graded');
    await pool.query(`INSERT INTO grades(assignment_id,enrollment_id,score,status,source,graded_by,published_by,published_at)
      VALUES($1,$2,0,'PUBLISHED','AUTO_ZERO_NO_SUBMISSION',$3,$3,clock_timestamp())`,
    [graded.id,id.enrollment1,id.teacher1]);
    const inactiveEnrollment = await createReminderAssignment('4 hours','Inactive enrollment');
    const inactiveUser = await createReminderAssignment('5 hours','Inactive user');
    await pool.query('UPDATE enrollments SET is_active=false WHERE id=$1',[id.enrollment1]);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1',[id.student2]);

    const service = new NotificationService(new NotificationRepository(pool));
    try {
      await service.dispatchDeadlineReminders();
    } finally {
      await pool.query('UPDATE enrollments SET is_active=true WHERE id=$1',[id.enrollment1]);
      await pool.query('UPDATE users SET is_active=true WHERE id=$1',[id.student2]);
    }
    expect((await reminderRecipients(submitted.id)).map(row=>row.recipient_id)).toEqual([]);
    expect((await reminderRecipients(graded.id)).map(row=>row.recipient_id)).toEqual([]);
    expect(await reminderRecipients(inactiveEnrollment.id)).toEqual([]);
    expect(await reminderRecipients(inactiveUser.id)).toEqual([]);

    const changing = await createReminderAssignment('6 hours','Changing deadline');
    await Promise.all([service.dispatchDeadlineReminders(),service.dispatchDeadlineReminders()]);
    const first = await reminderRecipients(changing.id);
    expect(first).toHaveLength(2);
    await pool.query("UPDATE assignments SET deadline_at=deadline_at+interval '1 hour' WHERE id=$1",[changing.id]);
    await Promise.all([service.dispatchDeadlineReminders(),service.dispatchDeadlineReminders()]);
    const changed = await reminderRecipients(changing.id);
    expect(changed).toHaveLength(4);
    expect(new Set(changed.map(row=>`${row.recipient_id}:${row.deduplication_key}`)).size).toBe(4);
  });

  it('keeps events distinct and suppresses a submission committed before snapshot; uncommitted races are intentionally not lock-coordinated', async () => {
    const deadline = (await pool.query<{deadline_at:Date}>(
      "SELECT clock_timestamp()+interval '1 hour' AS deadline_at")).rows[0]!.deadline_at.toISOString();
    const created = await api.post(`/api/classes/${id.classA}/assignments`).auth(teacher,{type:'bearer'}).send({
      title:'Created and reminded',deadlineAt:deadline,maxScore:10,
    });
    expect(created.status).toBe(201);
    const submissionClient = await pool.connect();
    try {
      await submissionClient.query('BEGIN');
      await submissionClient.query('INSERT INTO submissions(assignment_id,enrollment_id) VALUES($1,$2)',
        [created.body.id,id.enrollment1]);
      await submissionClient.query('COMMIT');
    } finally {
      submissionClient.release();
    }

    const service = new NotificationService(new NotificationRepository(pool));
    await service.dispatchDeadlineReminders();

    const student1Kinds = (await pool.query<{kind:string}>(`SELECT kind FROM notifications
      WHERE assignment_id=$1 AND recipient_id=$2 ORDER BY kind`,[created.body.id,id.student1])).rows;
    expect(student1Kinds.map(row=>row.kind)).toEqual(['ASSIGNMENT_CREATED']);
    const student2Kinds = (await pool.query<{kind:string}>(`SELECT kind FROM notifications
      WHERE assignment_id=$1 AND recipient_id=$2 ORDER BY kind`,[created.body.id,id.student2])).rows;
    expect(student2Kinds.map(row=>row.kind)).toEqual(['ASSIGNMENT_CREATED','DEADLINE_REMINDER']);
  });
});
