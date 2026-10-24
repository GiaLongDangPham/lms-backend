import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { hashPassword } from '../../security/password.js';
import { createAuth, getPrincipal, requireAdmin, requireChangedPassword, requireClassAccess, type AuthConfig } from './auth.js';
import { ApiError, classColumns, classDto, cursorId, email, enrollmentDto, nonempty, page, paging, parse,
  password, roles, schoolCode, transaction, userColumns, userDto, uuid, type User, type ClassRow, type EnrollmentRow } from './common.js';
import type { EnrollmentService } from './enrollment.service.js';

const createUser = z.object({ schoolCode, fullName: nonempty, email: email.optional(),
  role: z.enum(['TEACHER', 'STUDENT']), initialPassword: password }).strict();
const updateUser = z.object({ fullName: nonempty.optional(), email: email.optional(), isActive: z.boolean().optional() })
  .strict().refine(v => Object.keys(v).length > 0);
const createClass = z.object({ code: nonempty.max(50), courseCode: schoolCode, name: nonempty,
  term: nonempty.max(50), description: z.string().max(5000).nullable().optional() }).strict();
const updateClass = createClass.partial().refine(v => Object.keys(v).length > 0);

export function createB1Router(pool: pg.Pool, config: AuthConfig, enrollmentService: EnrollmentService, loginLimit = 10) {
  const router = Router();
  const auth = createAuth(pool, config);
  async function enrollmentResponse(row: EnrollmentRow) {
    const result=await pool.query<User>(`SELECT ${userColumns} FROM users WHERE id=$1`,[row.student_id]);
    const u=result.rows[0]!;
    return {...enrollmentDto(row),student:{id:u.id,schoolCode:u.school_code,fullName:u.full_name,role:u.role}};
  }
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: loginLimit, standardHeaders: 'draft-8',
    legacyHeaders: false, skipSuccessfulRequests: true,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } } });
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/auth/login', loginLimiter, async (req, res) => {
    const body = parse(z.object({ schoolCode, password: z.string().min(1).max(256) }).strict(), req.body);
    await auth.login(req, res, body.schoolCode, body.password);
  });
  router.post('/auth/refresh', async (req, res) => {
    parse(z.object({}).strict(), req.body ?? {}); await auth.refresh(req, res);
  });
  router.post('/auth/logout', async (req, res) => {
    parse(z.object({}).strict(), req.body ?? {}); await auth.logout(req, res);
  });
  router.get('/auth/me', auth.authenticate, (req, res) => res.json(userDto(getPrincipal(req).user)));
  router.post('/auth/change-password', auth.authenticate, async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(256), newPassword: password }).strict(), req.body);
    await auth.changePassword(req, res, body.currentPassword, body.newPassword);
  });
  router.use(auth.authenticate, requireChangedPassword);

  router.get('/users', requireAdmin, async (req, res) => {
    const query = parse(paging.extend({ role: roles.optional(),search:nonempty.optional() }).strict(), req.query);
    const scope = `users:${JSON.stringify([query.role??null,query.search??null])}`;
    const rows = await pool.query<User>(`SELECT ${userColumns} FROM users
      WHERE ($1::text IS NULL OR role = $1) AND ($2::uuid IS NULL OR id > $2)
      AND ($4::text IS NULL OR strpos(lower(school_code),lower($4))>0 OR strpos(lower(full_name),lower($4))>0)
      ORDER BY id LIMIT $3`, [query.role ?? null, cursorId(query.cursor, scope), query.limit + 1,query.search??null]);
    res.json(page(rows.rows, query.limit, scope, userDto));
  });
  router.post('/users', requireAdmin, async (req, res) => {
    const body = parse(createUser, req.body);
    const hash = await hashPassword(body.initialPassword);
    const result = await pool.query<User>(`INSERT INTO users(school_code, full_name, email, role, password_hash, must_change_password)
      VALUES ($1, $2, $3, $4, $5, true) RETURNING ${userColumns}`,
    [body.schoolCode, body.fullName, body.email ?? null, body.role, hash]);
    res.status(201).json(userDto(result.rows[0]!));
  });
  router.get('/users/:id', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id);
    const result = await pool.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Account was not found.');
    res.json(userDto(result.rows[0]));
  });
  router.patch('/users/:id', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id); const body = parse(updateUser, req.body);
    const user = await transaction(pool, async client => {
      const target = await client.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      const old = target.rows[0];
      if (!old) throw new ApiError(404, 'NOT_FOUND', 'Account was not found.');
      if (old.role === 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Admin accounts are managed outside this API.');
      const result = await client.query<User>(`UPDATE users SET full_name = $1, email = $2, is_active = $3 WHERE id = $4
        RETURNING ${userColumns}`, [body.fullName ?? old.full_name, body.email === undefined ? old.email : body.email,
        body.isActive ?? old.is_active, id]);
      if (body.isActive === false) {
        await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      }
      return result.rows[0];
    });
    res.json(userDto(user!));
  });
  router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id);
    const body = parse(z.object({ initialPassword: password }).strict(), req.body);
    const hash = await hashPassword(body.initialPassword);
    await transaction(pool, async client => {
      const target = await client.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      if (!target.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Account was not found.');
      if (target.rows[0].role === 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Admin accounts are managed outside this API.');
      await client.query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [hash, id]);
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    });
    res.status(204).end();
  });

  router.get('/classes', async (req, res) => {
    const query = parse(paging.extend({term:z.string().optional(),search:nonempty.optional()}).strict(), req.query);
    const { user } = getPrincipal(req);
    const scope = `classes:${JSON.stringify([user.id,query.term??null,query.search??null])}`;
    const values = [user.role, user.id, cursorId(query.cursor, scope), query.limit + 1,query.term??null,query.search??null];
    const where = `($1 = 'ADMIN'
      OR ($1 = 'TEACHER' AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.teacher_id = $2))
      OR ($1 = 'STUDENT' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.student_id = $2 AND e.is_active)))
      AND ($3::uuid IS NULL OR c.id > $3) AND ($5::text IS NULL OR c.term=$5)
      AND ($6::text IS NULL OR strpos(lower(c.code),lower($6))>0 OR strpos(lower(c.course_code),lower($6))>0 OR strpos(lower(c.name),lower($6))>0)`;
    const rows = await pool.query<ClassRow>(`SELECT ${classColumns} FROM classes c WHERE ${where} ORDER BY c.id LIMIT $4`, values);
    res.json(page(rows.rows, query.limit, scope, classDto));
  });
  router.post('/classes', requireAdmin, async (req, res) => {
    const body = parse(createClass, req.body);
    const result = await pool.query<ClassRow>(`INSERT INTO classes(code, course_code, name, term, description, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${classColumns}`,
    [body.code, body.courseCode, body.name, body.term, body.description ?? null, getPrincipal(req).user.id]);
    res.status(201).json(classDto(result.rows[0]!));
  });
  router.get('/classes/:id', async (req, res) => {
    const id = parse(uuid, req.params.id);
    await requireClassAccess(pool, getPrincipal(req), id);
    const result = await pool.query<ClassRow>(`SELECT ${classColumns} FROM classes WHERE id = $1`, [id]);
    res.json(classDto(result.rows[0]!));
  });
  router.patch('/classes/:id', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id); const body = parse(updateClass, req.body);
    const result = await pool.query<ClassRow>(`UPDATE classes SET code = COALESCE($1, code), name = COALESCE($2, name),
      term = COALESCE($3, term), course_code=COALESCE($5,course_code),
      description=CASE WHEN $6::boolean THEN $7 ELSE description END WHERE id = $4 RETURNING ${classColumns}`,
    [body.code, body.name, body.term, id, body.courseCode, body.description !== undefined, body.description ?? null]);
    if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Class was not found.');
    res.json(classDto(result.rows[0]));
  });
  router.get('/classes/:id/teachers', async (req, res) => {
    const id = parse(uuid, req.params.id); await requireClassAccess(pool, getPrincipal(req), id);
    const result = await pool.query<Pick<User,'id'|'school_code'|'full_name'|'role'>>(`SELECT u.id,u.school_code,u.full_name,u.role FROM users u
      JOIN class_teachers ct ON ct.teacher_id = u.id WHERE ct.class_id = $1 ORDER BY u.school_code`, [id]);
    res.json({ items: result.rows.map(u => ({ id: u.id, schoolCode: u.school_code,
      fullName: u.full_name, role: u.role })), page: { nextCursor: null } });
  });
  router.post('/classes/:id/teachers', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { teacherId } = parse(z.object({ teacherId: uuid }).strict(), req.body);
    await requireClassAccess(pool, getPrincipal(req), id);
    const assigned = await transaction(pool, async client => {
      const teacher = await client.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 FOR SHARE`, [teacherId]);
      if (!teacher.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Teacher was not found.');
      if (teacher.rows[0].role !== 'TEACHER' || !teacher.rows[0].is_active) {
        throw new ApiError(400, 'INVALID_MEMBER', 'An active teacher account is required.');
      }
      const result = await client.query<{ assigned_at: Date }>(`INSERT INTO class_teachers(class_id, teacher_id, assigned_by)
        VALUES ($1, $2, $3) RETURNING assigned_at`, [id, teacherId, getPrincipal(req).user.id]);
      return result.rows[0]!;
    });
    res.status(201).json({ classId: id, teacherId, assignedAt: assigned.assigned_at.toISOString() });
  });
  router.delete('/classes/:id/teachers/:teacherId', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id); const teacherId = parse(uuid, req.params.teacherId);
    await transaction(pool, async client => {
      await requireClassAccess(client, getPrincipal(req), id, true);
      await client.query('DELETE FROM class_teachers WHERE class_id = $1 AND teacher_id = $2', [id, teacherId]);
    });
    res.status(204).end();
  });
  router.get('/classes/:id/enrollments', async (req, res) => {
    const id = parse(uuid, req.params.id); const principal = getPrincipal(req);
    await requireClassAccess(pool, principal, id);
    if (principal.user.role === 'STUDENT') throw new ApiError(403, 'FORBIDDEN', 'Class roster is restricted to staff.');
    const query = parse(paging.strict(), req.query); const scope = `enrollments:${id}`;
    const rows = await pool.query<EnrollmentRow>(`SELECT * FROM enrollments WHERE class_id = $1
      AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT $3`, [id, cursorId(query.cursor, scope), query.limit + 1]);
    const response=page(rows.rows, query.limit, scope, row=>row);
    res.json({...response,items:await Promise.all(rows.rows.slice(0,query.limit).map(enrollmentResponse))});
  });
  router.post('/classes/:id/enrollments', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id);
    const body = parse(z.object({ studentId: uuid }).strict(), req.body);
    const result = await enrollmentService.enroll(getPrincipal(req), id, body.studentId);
    res.status(201).json(await enrollmentResponse(result));
  });
  router.patch('/classes/:id/enrollments/:enrollmentId', requireAdmin, async (req, res) => {
    const id = parse(uuid, req.params.id); const enrollmentId = parse(uuid, req.params.enrollmentId);
    const body = parse(z.object({ isActive: z.boolean() }).strict(), req.body);
    const result = await enrollmentService.setActive(getPrincipal(req), id, enrollmentId, body.isActive);
    res.json(await enrollmentResponse(result));
  });
  return router;
}
