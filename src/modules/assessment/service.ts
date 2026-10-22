import type pg from 'pg';
import { ApiError, type User } from '../b1/common.js';
import { type Principal, requireClassAccess } from '../b1/auth.js';

export type Db = pg.Pool | pg.PoolClient;
export interface Assignment {
  id: string; class_id: string; deadline_at: Date; results_published_at: Date | null; max_score: string;
}
export interface Grade {
  id: string; assignment_id: string; enrollment_id: string; submission_id: string | null;
  graded_version_number: number | null; score: string; feedback: string | null; status: 'DRAFT' | 'PUBLISHED';
  source: 'MANUAL' | 'AUTO_ZERO_NO_SUBMISSION'; graded_by: string; graded_at: Date;
  published_by: string | null; published_at: Date | null;
}
export function teacherOnly(principal: Principal) {
  if (principal.user.role !== 'TEACHER') throw new ApiError(403,'FORBIDDEN','Assigned teacher access is required.');
}
export async function assignmentAccess(pool: pg.Pool, principal: Principal, id: string, client: Db = pool, lock = false) {
  const rows=await client.query<Assignment>(`SELECT * FROM assignments WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id]);
  const a=rows.rows[0]; if(!a) throw new ApiError(404,'NOT_FOUND','Assignment was not found.');
  await requireClassAccess(client,principal,a.class_id);
  return a;
}
export async function summary(db: Db, userId: string) {
  const r=await db.query<User>('SELECT id,school_code,full_name,role FROM users WHERE id=$1',[userId]);
  const u=r.rows[0]!; return {id:u.id,schoolCode:u.school_code,fullName:u.full_name,role:u.role};
}
export async function gradeDto(db: Db, g: Grade, publishedOnly = false) {
  const e=await db.query<{student_id:string}>('SELECT student_id FROM enrollments WHERE id=$1',[g.enrollment_id]);
  const data={ assignmentId:g.assignment_id, student:await summary(db,e.rows[0]!.student_id),
    submissionId:g.submission_id,gradedVersionNumber:g.graded_version_number,score:Number(g.score),feedback:g.feedback,
    status:g.status,source:g.source,publishedBy:g.published_by?await summary(db,g.published_by):null,
    publishedAt:g.published_at?.toISOString()??null };
  return publishedOnly?data:{...data,gradedBy:await summary(db,g.graded_by),gradedAt:g.graded_at.toISOString()};
}
export async function submissionDto(db: Db, submissionId: string, teacher = false) {
  const r=await db.query<{id:string;assignment_id:string;student_id:string;created_at:Date;results_published_at:Date|null}>(
    `SELECT s.*,e.student_id,a.results_published_at FROM submissions s JOIN enrollments e ON e.id=s.enrollment_id
    JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1`,[submissionId]);
  const s=r.rows[0]!;
  const v=await db.query<{version_number:number;submitted_at:Date;deadline_at_submission:Date;note:string|null}>(
    'SELECT * FROM submission_versions WHERE submission_id=$1 ORDER BY version_number',[submissionId]);
  const files=await db.query(`SELECT sf.version_number,f.id,f.original_name,f.mime_type,f.size_bytes,f.created_at
    FROM submission_files sf JOIN files f ON f.id=sf.file_id WHERE sf.submission_id=$1 ORDER BY sf.file_id`,[submissionId]);
  const grade=await db.query<Grade>('SELECT * FROM grades WHERE submission_id=$1',[submissionId]);
  const g=grade.rows[0]; const locked=!!g||!!s.results_published_at;
  return { id:s.id,assignmentId:s.assignment_id,student:await summary(db,s.student_id),
    currentVersionNumber:v.rows.at(-1)?.version_number ?? 0,
    versions:v.rows.map(x=>({versionNumber:x.version_number,submittedAt:x.submitted_at.toISOString(),
      deadlineAtSubmission:x.deadline_at_submission.toISOString(),isLate:x.submitted_at>x.deadline_at_submission,note:x.note,
      files:files.rows.filter(f=>f.version_number===x.version_number).map(f=>({id:f.id,originalName:f.original_name,
        mimeType:f.mime_type,sizeBytes:Number(f.size_bytes),createdAt:f.created_at.toISOString()}))})),
    canSubmit:!locked,lockedReason:locked?'GRADED':null,createdAt:s.created_at.toISOString(),
    ...(teacher?{grade:g?{score:Number(g.score),status:g.status,source:g.source}:null}:{}) };
}
export async function historyDto(db: Db, assignmentId: string, studentId: string, publishedOnly: boolean) {
  const result=await db.query<Grade>(`SELECT g.* FROM grades g JOIN enrollments e ON e.id=g.enrollment_id
    WHERE g.assignment_id=$1 AND e.student_id=$2`,[assignmentId,studentId]);
  const g=result.rows[0];
  if(!g || (publishedOnly && g.status!=='PUBLISHED')) throw new ApiError(404,'NOT_FOUND','Published result was not found.');
  const history=await db.query<{version:number;score:string;feedback:string|null;status:string;source:string;changed_by:string;changed_at:Date}>(
    `SELECT * FROM grade_history WHERE grade_id=$1 ${publishedOnly?"AND status='PUBLISHED'":''} ORDER BY version`,[g.id]);
  return {assignmentId,student:await summary(db,studentId),items:await Promise.all(history.rows.map(async h=>({version:h.version,
    score:Number(h.score),feedback:h.feedback,status:h.status,source:h.source,changedBy:await summary(db,h.changed_by),
    changedAt:h.changed_at.toISOString()})))};
}
export async function notifyResult(db: Db, g: Grade, studentId: string, revision: number) {
  await db.query(`INSERT INTO notifications(recipient_id,assignment_id,kind,title,body,deduplication_key)
    VALUES($1,$2,'GRADE_PUBLISHED','Kết quả bài tập','Kết quả bài tập đã được cập nhật.',$3)
    ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`,[studentId,g.assignment_id,`grade:${g.id}:${revision}`]);
}
