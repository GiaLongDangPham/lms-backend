import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { ApiError, parse, transaction, uuid } from '../b1/common.js';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { assignmentAccess, gradeDto, historyDto, notifyResult, summary, teacherOnly, type Grade } from './service.js';

const scoreSchema=z.number().finite().min(0).refine(value =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
{ message: 'Score must have at most two decimal places.' });
const saveSchema=z.object({score:scoreSchema,feedback:z.string().max(5000).nullable().optional(),
  gradedVersionNumber:z.number().int().min(1)}).strict();
export function createAssessmentRouter(pool: pg.Pool, config: AuthConfig) {
  const router=Router();const auth=createAuth(pool,config);
  router.use(auth.authenticate,requireChangedPassword,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  async function submissionAccess(req: Parameters<typeof getPrincipal>[0], submissionId: string, lock=false, db: pg.Pool|pg.PoolClient=pool) {
    const principal=getPrincipal(req);
    if(principal.user.role==='ADMIN')throw new ApiError(403,'FORBIDDEN','Submission details are restricted to their student and assigned teachers.');
    const rows=await db.query<{id:string;assignment_id:string;enrollment_id:string;student_id:string}>(
      `SELECT s.*,e.student_id FROM submissions s JOIN enrollments e ON e.id=s.enrollment_id WHERE s.id=$1`,[submissionId]);
    const s=rows.rows[0]; if(!s || (principal.user.role==='STUDENT' && s.student_id!==principal.user.id)) {
      throw new ApiError(404,'NOT_FOUND','Submission was not found.');
    }
    await assignmentAccess(pool,principal,s.assignment_id,db,lock);
    return s;
  }
  router.get('/submissions/:submissionId/grade',async(req,res)=>{
    const id=parse(uuid,req.params.submissionId);teacherOnly(getPrincipal(req));await submissionAccess(req,id);
    const r=await pool.query<Grade>('SELECT * FROM grades WHERE submission_id=$1',[id]);
    if(!r.rows[0])throw new ApiError(404,'NOT_FOUND','No grade exists.');res.json(await gradeDto(pool,r.rows[0]));
  });
  router.put('/submissions/:submissionId/grade',async(req,res)=>{
    const id=parse(uuid,req.params.submissionId);const p=getPrincipal(req);teacherOnly(p);const body=parse(saveSchema,req.body);
    const result=await transaction(pool,async db=>{
      const s=await submissionAccess(req,id,true,db);
      const max=await db.query<{max_score:string}>('SELECT max_score FROM assignments WHERE id=$1',[s.assignment_id]);
      if(body.score>Number(max.rows[0]!.max_score))throw new ApiError(400,'VALIDATION_ERROR','Score exceeds the assignment maximum.');
      const version=await db.query<{n:number}>(`SELECT COALESCE(
        (SELECT graded_version_number FROM grades WHERE submission_id=$1),
        (SELECT max(version_number) FROM submission_versions WHERE submission_id=$1))::int AS n`,[id]);
      if(body.gradedVersionNumber!==version.rows[0]!.n)throw new ApiError(409,'STALE_SUBMISSION_VERSION','Use the recorded graded version, or the current version for a first grade.');
      const r=await db.query<Grade & {revision:number}>(`INSERT INTO grades(assignment_id,enrollment_id,submission_id,graded_version_number,score,feedback,graded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(submission_id) DO UPDATE SET score=EXCLUDED.score,
        feedback=CASE WHEN $8::boolean THEN EXCLUDED.feedback ELSE grades.feedback END,graded_by=EXCLUDED.graded_by,graded_at=now(),
        source='MANUAL',published_by=CASE WHEN grades.status='PUBLISHED' THEN EXCLUDED.graded_by ELSE NULL END,
        published_at=CASE WHEN grades.status='PUBLISHED' THEN now() ELSE NULL END RETURNING *`,
      [s.assignment_id,s.enrollment_id,id,body.gradedVersionNumber,body.score,body.feedback??null,p.user.id,body.feedback!==undefined]);
      const g=r.rows[0]!;if(g.status==='PUBLISHED')await notifyResult(db,g,s.student_id,g.revision);
      return gradeDto(db,g);
    });res.json(result);
  });
  router.put('/assignments/:assignmentId/grades/:studentId',async(req,res)=>{
    const a=parse(uuid,req.params.assignmentId);const studentId=parse(uuid,req.params.studentId);const p=getPrincipal(req);teacherOnly(p);
    const body=parse(z.object({score:scoreSchema,feedback:z.string().max(5000).nullable().optional()}).strict(),req.body);
    const result=await transaction(pool,async db=>{
      const assignment=await assignmentAccess(pool,p,a,db,true);
      if(body.score>Number(assignment.max_score))throw new ApiError(400,'VALIDATION_ERROR','Score exceeds the assignment maximum.');
      const r=await db.query<Grade & {revision:number}>(`UPDATE grades g SET score=$3,
        feedback=CASE WHEN $5::boolean THEN $4 ELSE g.feedback END,source='MANUAL',graded_by=$6,graded_at=now(),published_by=$6,published_at=now()
        FROM enrollments e WHERE g.enrollment_id=e.id AND g.assignment_id=$1 AND e.student_id=$2
        AND g.status='PUBLISHED' AND g.submission_id IS NULL RETURNING g.*`,[a,studentId,body.score,body.feedback??null,body.feedback!==undefined,p.user.id]);
      if(!r.rows[0])throw new ApiError(404,'NOT_FOUND','No Published result without a submission exists.');
      await notifyResult(db,r.rows[0],studentId,r.rows[0].revision);return gradeDto(db,r.rows[0]);
    });res.json(result);
  });
  router.post('/assignments/:assignmentId/grades/publish',async(req,res)=>{
    const a=parse(uuid,req.params.assignmentId);const p=getPrincipal(req);teacherOnly(p);
    const result=await transaction(pool,async db=>{
      const assignment=await assignmentAccess(pool,p,a,db,true);
      const enroll=await db.query<{id:string;student_id:string}>(`SELECT e.id,e.student_id FROM enrollments e JOIN users u ON u.id=e.student_id
        WHERE e.class_id=$1 AND e.is_active AND u.is_active ORDER BY e.id FOR SHARE OF e,u`,[assignment.class_id]);
      const blockers=await db.query<{id:string;student_id:string}>(`SELECT s.id,e.student_id FROM submissions s JOIN enrollments e ON e.id=s.enrollment_id
        WHERE s.assignment_id=$1 AND e.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM grades g WHERE g.submission_id=s.id)
        ORDER BY s.id`,[a,enroll.rows.map(e=>e.id)]);
      if(blockers.rowCount) {
        const error=new ApiError(409,'UNGRADED_SUBMISSIONS','All submitted work must be graded before publication.');
        Object.assign(error,{details:{ungradedSubmissions:await Promise.all(blockers.rows.map(async s=>({submissionId:s.id,student:await summary(db,s.student_id)})))}});
        throw error;
      }
      let automaticZeroCount=0;
      for(const e of enroll.rows){
        const inserted=await db.query(`INSERT INTO grades(assignment_id,enrollment_id,score,status,source,graded_by,published_by,published_at)
          SELECT $1,$2,0,'PUBLISHED','AUTO_ZERO_NO_SUBMISSION',$3,$3,now()
          WHERE NOT EXISTS(SELECT 1 FROM submissions WHERE assignment_id=$1 AND enrollment_id=$2)
          ON CONFLICT(assignment_id,enrollment_id) DO NOTHING`,[a,e.id,p.user.id]);
        automaticZeroCount+=inserted.rowCount??0;
      }
      await db.query(`UPDATE grades SET status='PUBLISHED',published_by=$3,published_at=now()
        WHERE assignment_id=$1 AND enrollment_id=ANY($2::uuid[]) AND status='DRAFT'`,[a,enroll.rows.map(e=>e.id),p.user.id]);
      const results=await db.query<Grade & {student_id:string;revision:number}>(`SELECT g.*,e.student_id FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
        WHERE g.assignment_id=$1 AND e.id=ANY($2::uuid[]) AND g.status='PUBLISHED'`,[a,enroll.rows.map(e=>e.id)]);
      for(const g of results.rows)await notifyResult(db,g,g.student_id,g.revision);
      const stamp=await db.query<{results_published_at:Date}>(`UPDATE assignments SET
        results_published_at=COALESCE(results_published_at,now()),results_published_by=COALESCE(results_published_by,$2)
        WHERE id=$1 RETURNING results_published_at`,[a,p.user.id]);
      return {assignmentId:a,publishedCount:results.rowCount??0,automaticZeroCount,publishedAt:stamp.rows[0]!.results_published_at.toISOString()};
    });res.json(result);
  });
  router.get('/assignments/:assignmentId/my-result',async(req,res)=>{
    const a=parse(uuid,req.params.assignmentId);const p=getPrincipal(req);
    if(p.user.role!=='STUDENT')throw new ApiError(403,'FORBIDDEN','Student access is required.');await assignmentAccess(pool,p,a);
    const r=await pool.query<Grade>(`SELECT g.* FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
      WHERE g.assignment_id=$1 AND e.student_id=$2 AND g.status='PUBLISHED'`,[a,p.user.id]);
    if(!r.rows[0])throw new ApiError(404,'NOT_FOUND','Published result was not found.');res.json(await gradeDto(pool,r.rows[0],true));
  });
  router.get('/assignments/:assignmentId/my-result/history',async(req,res)=>{
    const a=parse(uuid,req.params.assignmentId);const p=getPrincipal(req);
    if(p.user.role!=='STUDENT')throw new ApiError(403,'FORBIDDEN','Student access is required.');await assignmentAccess(pool,p,a);
    res.json(await historyDto(pool,a,p.user.id,true));
  });
  router.get('/assignments/:assignmentId/grades/:studentId/history',async(req,res)=>{
    const a=parse(uuid,req.params.assignmentId);const s=parse(uuid,req.params.studentId);const p=getPrincipal(req);teacherOnly(p);
    await assignmentAccess(pool,p,a);res.json(await historyDto(pool,a,s,false));
  });
  return router;
}
