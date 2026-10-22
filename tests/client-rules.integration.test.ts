import { randomBytes } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedIds as id } from '../scripts/lib/seed.js';
import { migrate } from '../scripts/lib/migrations.js';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';

const spec=JSON.parse(readFileSync('docs/openapi.json','utf8'));
const validator=new Ajv2020({strict:false,allErrors:true});
for(const [name,format] of Object.entries(fullFormats))validator.addFormat(name,format);
validator.addSchema({...spec,$id:'contract'});
function contract(route:string,method:string,status:number,body:unknown) {
  let response=spec.paths[route][method].responses[String(status)];
  if(response.$ref)response=spec.components.responses[response.$ref.split('/').at(-1)];
  const schema=response.content['application/json'].schema;
  const check=validator.compile(schema.$ref?{$ref:'contract'+schema.$ref}:schema);
  expect(check(body),JSON.stringify(check.errors)).toBe(true);
}

const target = process.env.B1_TEST_DATABASE_URL;
const pool = new pg.Pool({ connectionString: target, max: 5 });
const app = createApp({ corsOrigins: ['http://localhost:5173'], checkDatabase: async () => {}, business: { pool,
  auth: { secret: randomBytes(32).toString('hex'), issuer: 'rules', audience: 'rules',
    cookieSecure: false, cookieSameSite: 'lax', origins: ['http://localhost:5173'] } } });
const api = request(app);
let teacher: string; let teacher2: string; let student: string; let student2: string; let admin: string;
const file = '70000000-0000-4000-8000-000000000007';
async function login(code: string, password = 'B1IntegrationPassword2026!') {
  const r = await api.post('/api/auth/login').send({ schoolCode: code, password }); expect(r.status).toBe(200); return r.body.accessToken as string;
}
async function assignment() {
  const r = await pool.query<{id: string}>(`INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by)
    VALUES ($1,'Rules fixture',now()+interval '1 day',10,$2) RETURNING id`, [id.classA,id.teacher1]); return r.rows[0]!.id;
}
const submit = (a: string, note = 'Ghi chú riêng') => api.post(`/api/assignments/${a}/submissions`)
  .auth(student,{type:'bearer'}).send({fileIds:[file],note});
const grade = (s: string, score = 8) => api.put(`/api/submissions/${s}/grade`).auth(teacher,{type:'bearer'})
  .send({gradedVersionNumber:1,score,feedback:'Feedback private'});
const publish = (a: string) => api.post(`/api/assignments/${a}/grades/publish`).auth(teacher,{type:'bearer'});

describe.skipIf(!target)('Client Log 18-20, L04/L05/L14/L20',()=>{
  beforeAll(async()=>{
    teacher=await login('GV001');teacher2=await login('GV002');student=await login('SV001');admin=await login('ADMIN001');
    // B1 tests may have reset SV002; restore only this disposable database fixture.
    const {hashPassword}=await import('../src/security/password.js');
    await pool.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2',
      [await hashPassword('B1IntegrationPassword2026!'),id.student2]);
    student2=await login('SV002');
  },30000);
  afterAll(async()=>{await pool.end();});

  it('accepts courseCode/description and allows L01 in different courses only',async()=>{
    const body={code:'L01',courseCode:'CO2013',name:'Database',term:'2026-HK1',description:'Description'};
    const one=await api.post('/api/classes').auth(admin,{type:'bearer'}).send(body);
    expect(one.status).toBe(201);expect(one.body.courseCode).toBe('CO2013');expect(one.body.description).toBe('Description');
    expect((await api.post('/api/classes').auth(admin,{type:'bearer'}).send({...body,courseCode:'CO2014'})).status).toBe(201);
    expect((await api.post('/api/classes').auth(admin,{type:'bearer'}).send(body)).status).toBe(409);
    const updated=await api.patch('/api/classes/'+one.body.id).auth(admin,{type:'bearer'}).send({description:null});
    expect(updated.status).toBe(200);expect(updated.body.description).toBeNull();
    const filtered=await api.get('/api/classes').query({search:'co2013',term:body.term}).auth(admin,{type:'bearer'});
    expect(filtered.status).toBe(200);expect(filtered.body.items.map((c:{id:string})=>c.id)).toEqual([one.body.id]);
    const users=await api.get('/api/users').query({search:'SV001',role:'STUDENT'}).auth(admin,{type:'bearer'});
    expect(users.status).toBe(200);expect(users.body.items.map((u:{id:string})=>u.id)).toEqual([id.student1]);
  });
  it('retains an independent note on every immutable submission version',async()=>{
    const a=await assignment();const first=await submit(a,'Lần một');expect(first.status).toBe(201);
    const second=await submit(a,'Lần hai');expect(second.status).toBe(201);
    expect(second.body.versions.map((v:{note:string})=>v.note)).toEqual(['Lần một','Lần hai']);
    contract('/assignments/{assignmentId}/submissions','post',201,second.body);
    const other=await api.get('/api/submissions/'+first.body.id).auth(student2,{type:'bearer'});expect(other.status).toBe(404);
    expect((await api.get('/api/submissions/'+first.body.id).auth(admin,{type:'bearer'})).status).toBe(403);
  });
  it('locks resubmission as soon as a Draft grade exists without exposing the Draft',async()=>{
    const a=await assignment();const s=await submit(a);expect(s.status).toBe(201);
    expect((await grade(s.body.id)).status).toBe(200);
    const blocked=await submit(a);expect(blocked.status).toBe(409);expect(blocked.body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
    const view=await api.get(`/api/assignments/${a}/my-submission`).auth(student,{type:'bearer'});
    expect(view.body.canSubmit).toBe(false);expect(view.text).not.toContain('Feedback private');expect(view.body.grade).toBeUndefined();
    expect((await api.get(`/api/assignments/${a}/my-result`).auth(student,{type:'bearer'})).status).toBe(404);
    const hist=await api.get(`/api/assignments/${a}/my-result/history`).auth(student,{type:'bearer'});
    expect(hist.status).toBe(404);expect(hist.text).not.toContain('Feedback private');
  });
  it('publishes nothing if any submitted work is ungraded',async()=>{
    const a=await assignment();expect((await submit(a)).status).toBe(201);
    const r=await publish(a);expect(r.status).toBe(409);expect(r.body.error.code).toBe('UNGRADED_SUBMISSIONS');
    expect((await pool.query('SELECT * FROM grades WHERE assignment_id=$1',[a])).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM notifications WHERE assignment_id=$1',[a])).rowCount).toBe(0);
  });
  it('creates an automatic zero without a fake submission and is idempotent',async()=>{
    const a=await assignment();const s=await submit(a);expect(s.status).toBe(201);expect((await grade(s.body.id)).status).toBe(200);
    const r=await publish(a);expect(r.status).toBe(200);expect(r.body.automaticZeroCount).toBe(1);
    contract('/assignments/{assignmentId}/grades/publish','post',200,r.body);
    const result=await api.get(`/api/assignments/${a}/my-result`).auth(student2,{type:'bearer'});
    expect(result.status).toBe(200);expect(result.body).toMatchObject({score:0,source:'AUTO_ZERO_NO_SUBMISSION',submissionId:null,gradedVersionNumber:null});
    contract('/assignments/{assignmentId}/my-result','get',200,result.body);
    const teacherView=await api.get(`/api/assignments/${a}/submissions`).auth(teacher,{type:'bearer'});
    expect(teacherView.status).toBe(200);contract('/assignments/{assignmentId}/submissions','get',200,teacherView.body);
    const before=await pool.query('SELECT count(*)::int AS n FROM notifications WHERE assignment_id=$1',[a]);
    expect((await publish(a)).status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE assignment_id=$1',[a])).rows).toEqual(before.rows);
    expect((await pool.query('SELECT * FROM submissions WHERE assignment_id=$1',[a])).rowCount).toBe(1);
    expect((await submit(a)).status).toBe(409);
  });
  it('corrects an automatic zero, keeps it Published and retains the automatic source in history',async()=>{
    const a=await assignment();expect((await publish(a)).status).toBe(200);
    const correction=await api.put(`/api/assignments/${a}/grades/${id.student2}`).auth(teacher,{type:'bearer'})
      .send({score:4,feedback:'Đã xác minh trường hợp đặc biệt'});
    expect(correction.status).toBe(200);expect(correction.body).toMatchObject({score:4,status:'PUBLISHED',source:'MANUAL',submissionId:null});
    contract('/assignments/{assignmentId}/grades/{studentId}','put',200,correction.body);
    const h=await api.get(`/api/assignments/${a}/my-result/history`).auth(student2,{type:'bearer'});
    expect(h.status).toBe(200);expect(h.body.items.map((x:{score:number})=>x.score)).toEqual([0,4]);
    contract('/assignments/{assignmentId}/my-result/history','get',200,h.body);
    expect(h.body.items[0].source).toBe('AUTO_ZERO_NO_SUBMISSION');
    expect((await api.get(`/api/assignments/${a}/my-result`).auth(student2,{type:'bearer'})).body.score).toBe(4);
  });
  it('records published corrections from two teachers without overwriting prior versions',async()=>{
    const a=await assignment();const s=await submit(a);expect(s.status).toBe(201);expect((await grade(s.body.id)).status).toBe(200);
    expect((await publish(a)).status).toBe(200);
    const responses=await Promise.all([7,9].map((score,index)=>api.put(`/api/submissions/${s.body.id}/grade`)
      .auth(index?teacher2:teacher,{type:'bearer'}).send({score,gradedVersionNumber:1})));
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const h=await api.get(`/api/assignments/${a}/my-result/history`).auth(student,{type:'bearer'});
    expect(h.body.items.map((r:{score:number})=>r.score).sort()).toEqual([7,8,9]);
    expect(new Set(h.body.items.map((r:{version:number})=>r.version)).size).toBe(3);
    expect(h.body.items.every((r:{status:string})=>r.status==='PUBLISHED')).toBe(true);
  });
  it('protects history from SQL edits and blocks inconsistent automatic grades',async()=>{
    const a=await assignment();expect((await publish(a)).status).toBe(200);
    await expect(pool.query(`UPDATE grade_history SET score=9 WHERE grade_id IN (SELECT id FROM grades WHERE assignment_id=$1)`,[a])).rejects.toMatchObject({code:'23514'});
    await expect(pool.query(`UPDATE grades SET score=1 WHERE assignment_id=$1 AND source='AUTO_ZERO_NO_SUBMISSION'`,[a])).rejects.toMatchObject({code:'23514'});
    await expect(pool.query('UPDATE assignments SET class_id=$1 WHERE id=$2',[id.classB,a])).rejects.toMatchObject({code:'23514'});
    await expect(pool.query('UPDATE enrollments SET class_id=$1 WHERE id=$2',[id.classB,id.enrollment2])).rejects.toMatchObject({code:'23514'});
  });
  it('rejects cross-class teachers and invalid scores',async()=>{
    const a=await assignment();const foreign=await pool.query('INSERT INTO assignments(class_id,title,deadline_at,max_score,created_by) VALUES ($1,\'Other\',now(),10,$2) RETURNING id',[id.classB,id.teacher2]);
    expect((await publish(foreign.rows[0].id)).status).toBe(404);
    expect((await api.put(`/api/assignments/${a}/grades/${id.student1}`).auth(teacher,{type:'bearer'}).send({score:11})).status).toBe(400);
    expect((await api.post(`/api/assignments/${a}/grades/publish`).auth(student,{type:'bearer'})).status).toBe(403);
  });
  it('upgrades legacy grades without data loss and requires explicit course mapping',async()=>{
    const name=`lms_upgrade_${randomBytes(8).toString('hex')}`;
    const dir=await mkdtemp(path.join(os.tmpdir(),'lms-upgrade-check-'));
    const url=new URL(target!);url.pathname='/'+name;
    let old:pg.Pool|undefined;let created=false;const previous=process.env.CLASS_COURSE_MAPPING;
    try {
      process.env.CLASS_COURSE_MAPPING='{}';
      await pool.query(`CREATE DATABASE "${name}"`);created=true;old=new pg.Pool({connectionString:url.toString()});
      for(const file of ['0001_initial_schema.sql','0002_b1_auth.sql'])await writeFile(path.join(dir,file),await readFile('database/migrations/'+file));
      await migrate(old,dir);
      await old.query(`INSERT INTO users(id,school_code,full_name,password_hash,role) VALUES
        ('${id.admin}','ADMIN001','Admin','fixture','ADMIN'),('${id.teacher1}','GV001','Teacher','fixture','TEACHER'),
        ('${id.student1}','SV001','Student','fixture','STUDENT');
        INSERT INTO classes(id,code,name,term,created_by) VALUES('${id.classA}','L01','Existing real class','2026-HK1','${id.admin}');
        INSERT INTO enrollments(id,class_id,student_id,enrolled_by) VALUES('${id.enrollment1}','${id.classA}','${id.student1}','${id.admin}');
        INSERT INTO assignments(id,class_id,title,deadline_at,max_score,created_by) VALUES('${id.assignmentA}','${id.classA}','Legacy',now(),10,'${id.teacher1}');
        INSERT INTO submissions(id,assignment_id,enrollment_id) VALUES('${id.submission1}','${id.assignmentA}','${id.enrollment1}');
        INSERT INTO submission_versions VALUES('${id.submission1}',1,now(),now());
        INSERT INTO grades(submission_id,graded_version_number,score,feedback,status,graded_by,published_by,published_at)
        VALUES('${id.submission1}',1,8.5,'Old Published','PUBLISHED','${id.teacher1}','${id.teacher1}','2026-10-16T08:00:00Z');
        INSERT INTO submission_versions VALUES('${id.submission1}',2,now(),now());
        INSERT INTO class_teachers(class_id,teacher_id,assigned_by) VALUES('${id.classA}','${id.teacher1}','${id.admin}');
        INSERT INTO assignments(id,class_id,title,deadline_at,max_score,created_by) VALUES('${id.assignmentLate}','${id.classA}','Legacy draft',now(),10,'${id.teacher1}');
        INSERT INTO submissions(id,assignment_id,enrollment_id) VALUES('${id.submissionLate}','${id.assignmentLate}','${id.enrollment1}');
        INSERT INTO submission_versions VALUES('${id.submissionLate}',1,now(),now());
        INSERT INTO grades(submission_id,graded_version_number,score,graded_by) VALUES('${id.submissionLate}',1,7,'${id.teacher1}');
        INSERT INTO submission_versions VALUES('${id.submissionLate}',2,now(),now());`);
      await expect(migrate(old)).rejects.toThrow(/CLASS_COURSE_MAPPING/);
      expect((await old.query('SELECT version FROM schema_migrations')).rowCount).toBe(2);
      process.env.CLASS_COURSE_MAPPING=JSON.stringify({[id.classA]:'CO2013'});
      expect(await migrate(old)).toEqual(['0003_client_rules.sql']);
      const grade=await old.query('SELECT * FROM grades WHERE submission_id=$1',[id.submission1]);
      expect(Number(grade.rows[0].score)).toBe(8.5);expect(grade.rows[0].feedback).toBe('Old Published');expect(grade.rows[0].status).toBe('PUBLISHED');
      expect((await old.query('SELECT * FROM grade_history')).rowCount).toBe(2);
      expect((await old.query('SELECT course_code FROM classes')).rows[0].course_code).toBe('CO2013');
      const {hashPassword}=await import('../src/security/password.js');
      await old.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword('LegacyPassword2026!'),id.teacher1]);
      const legacyApi=request(createApp({corsOrigins:[],checkDatabase:async()=>{},business:{pool:old,auth:{
        secret:randomBytes(32).toString('hex'),issuer:'legacy',audience:'legacy',cookieSecure:false,cookieSameSite:'lax',origins:[]}}}));
      const token=(await legacyApi.post('/api/auth/login').send({schoolCode:'GV001',password:'LegacyPassword2026!'})).body.accessToken;
      const corrected=await legacyApi.put(`/api/submissions/${id.submission1}/grade`).auth(token,{type:'bearer'})
        .send({score:9,gradedVersionNumber:1});
      expect(corrected.status).toBe(200);expect(corrected.body.gradedVersionNumber).toBe(1);
      expect((await legacyApi.post(`/api/assignments/${id.assignmentA}/grades/publish`).auth(token,{type:'bearer'})).status).toBe(200);
      expect((await legacyApi.post(`/api/assignments/${id.assignmentLate}/grades/publish`).auth(token,{type:'bearer'})).status).toBe(200);
      const history=await old.query('SELECT score,graded_version_number FROM grade_history WHERE submission_id=$1 ORDER BY version',[id.submission1]);
      expect(history.rows.map(r=>[Number(r.score),r.graded_version_number])).toEqual([[8.5,1],[9,1]]);
      expect(await migrate(old)).toEqual([]);
    }finally{
      if(previous===undefined)delete process.env.CLASS_COURSE_MAPPING;else process.env.CLASS_COURSE_MAPPING=previous;
      await old?.end();if(created&&/^lms_upgrade_[a-f0-9]{16}$/.test(name))await pool.query(`DROP DATABASE "${name}"`);
      if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('lms-upgrade-check-'))await rm(dir,{recursive:true,force:true});
    }
  },30000);
});
