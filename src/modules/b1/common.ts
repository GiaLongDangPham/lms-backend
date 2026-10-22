import type pg from 'pg';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const uuid = z.uuid();
export const password = z.string().min(12).max(256);
export const schoolCode = z.string().trim().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/).transform(s => s.toUpperCase());
export const nonempty = z.string().trim().min(1).max(200);
export const email = z.union([z.email().max(254), z.null()]);
export const roles = z.enum(['ADMIN', 'TEACHER', 'STUDENT']);
export const paging = z.object({ cursor: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20) });
export function cursorId(cursor: string | undefined, scope: string): string | null {
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid encoding');
    const value = z.object({ id: uuid, scope: z.literal(scope) }).strict()
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return value.id;
  } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Cursor is invalid for this list.'); }
}
export function page<T extends { id: string }>(rows: T[], limit: number, scope: string, map: (row: T) => unknown) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items: items.map(map), page: { nextCursor: rows.length > limit && last
    ? Buffer.from(JSON.stringify({ id: last.id, scope })).toString('base64url') : null } };
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request fields are invalid.');
  return result.data;
}
export async function transaction<T>(pool: pg.Pool, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export interface User {
  id: string; school_code: string; full_name: string; email: string | null;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT'; is_active: boolean; must_change_password: boolean;
  created_at: Date;
}
export const userColumns = 'id, school_code, full_name, email, role, is_active, must_change_password, created_at';
export const classColumns = 'id, code, course_code, name, term, description, created_by, created_at, updated_at';
export interface ClassRow { id: string; code: string; course_code: string; name: string; term: string; description: string | null; created_at: Date }
export interface EnrollmentRow { id: string; class_id: string; student_id: string; is_active: boolean; created_at: Date }
export function userDto(u: User) {
  return { id: u.id, schoolCode: u.school_code, fullName: u.full_name, email: u.email, role: u.role,
    isActive: u.is_active, mustChangePassword: u.must_change_password, createdAt: u.created_at.toISOString() };
}
export function classDto(c: ClassRow) { return { id: c.id, code: c.code, courseCode: c.course_code, name: c.name,
  term: c.term, description: c.description, createdAt: c.created_at.toISOString() }; }
export function enrollmentDto(e: EnrollmentRow) {
  return { id: e.id, classId: e.class_id, studentId: e.student_id, isActive: e.is_active, createdAt: e.created_at.toISOString() };
}
