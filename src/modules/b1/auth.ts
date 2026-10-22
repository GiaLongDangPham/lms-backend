import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type pg from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { hashPassword, verifyPassword } from '../../security/password.js';
import { ApiError, transaction, userColumns, userDto, type User } from './common.js';

export interface AuthConfig {
  secret: string; issuer: string; audience: string;
  cookieSecure: boolean; cookieSameSite: 'lax' | 'none'; origins: string[];
}
export interface Principal { user: User; sessionId: string }
export interface AuthRequest extends Request { principal?: Principal }
const refreshCookie = 'lms_refresh';
export const accessLifetime = 900;
const refreshLifetime = 7 * 24 * 60 * 60 * 1000;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function getPrincipal(req: Request): Principal {
  const principal = (req as AuthRequest).principal;
  if (!principal) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return principal;
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (getPrincipal(req).user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Admin access is required.');
  next();
}
export function requireChangedPassword(req: Request, _res: Response, next: NextFunction): void {
  if (getPrincipal(req).user.must_change_password) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your initial password before continuing.');
  }
  next();
}

export function createAuth(pool: pg.Pool, config: AuthConfig) {
  const key = new TextEncoder().encode(config.secret);
  if (key.length < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
  const cookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite,
    path: '/api/auth' } as const;
  function readRefresh(req: Request): string | undefined {
    const cookies = req.headers.cookie?.split(';').map(part => part.trim()) ?? [];
    const raw = cookies.find(part => part.startsWith(`${refreshCookie}=`))?.slice(refreshCookie.length + 1);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : undefined;
  }
  function checkOrigin(req: Request, cookieRequired = false): void {
    const origin = req.get('origin');
    if (origin && config.origins.includes(origin)) return;
    if (!origin && !cookieRequired) return; // Non-browser clients with explicit credentials/bearer.
    throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'A trusted Origin header is required for cookie authentication.');
  }
  function clearCookie(res: Response): void { res.clearCookie(refreshCookie, cookieOptions); }
  async function access(user: User, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(user.id).setIssuer(config.issuer).setAudience(config.audience)
      .setJti(randomUUID()).setIssuedAt().setExpirationTime(`${accessLifetime}s`).sign(key);
  }
  async function response(res: Response, user: User, sessionId: string, refresh: string, expires: Date) {
    const accessToken = await access(user, sessionId);
    res.cookie(refreshCookie, refresh, { ...cookieOptions, maxAge: Math.max(0, expires.getTime() - Date.now()) });
    res.set('Cache-Control', 'no-store').json({ accessToken, tokenType: 'Bearer',
      expiresIn: accessLifetime, user: userDto(user) });
  }
  // A dummy hash makes unknown codes follow the same expensive password-verification path.
  const dummyHash = hashPassword(randomBytes(24).toString('hex'));
  const authenticate: RequestHandler = async (req, _res, next) => {
    const token = req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    let subject: string; let sessionId: string;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: config.issuer,
        audience: config.audience, typ: 'at+jwt', requiredClaims: ['sub', 'sid', 'iat', 'exp', 'jti'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(payload.sub) || !/^[a-f0-9-]{36}$/i.test(payload.sid)) throw new Error('Invalid claims');
      subject = payload.sub; sessionId = payload.sid;
    } catch { throw new ApiError(401, 'UNAUTHORIZED', 'Access token is invalid or expired.'); }
    const result = await pool.query<User>(`SELECT ${userColumns.split(', ').map(c => `u.${c}`).join(', ')}
      FROM users u JOIN auth_sessions s ON s.user_id = u.id
      WHERE u.id = $1 AND s.id = $2 AND u.is_active AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [subject, sessionId]);
    const user = result.rows[0];
    if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Session is no longer active.');
    (req as AuthRequest).principal = { user, sessionId };
    next();
  };
  async function login(req: Request, res: Response, code: string, password: string): Promise<void> {
    checkOrigin(req);
    const result = await pool.query<User & { password_hash: string }>(
      `SELECT ${userColumns}, password_hash FROM users WHERE school_code = $1`, [code]);
    const initial = result.rows[0];
    const valid = await verifyPassword(password, initial?.password_hash ?? await dummyHash);
    if (!valid || !initial?.is_active) throw new ApiError(401, 'INVALID_CREDENTIALS', 'School code or password is incorrect.');
    const refresh = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + refreshLifetime);
    const session = await transaction(pool, async client => {
      const locked = await client.query<User & { password_hash: string }>(
        `SELECT ${userColumns}, password_hash FROM users WHERE id = $1 FOR UPDATE`, [initial.id]);
      const current = locked.rows[0];
      if (!current?.is_active || current.password_hash !== initial.password_hash) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'School code or password is incorrect.');
      }
      const sessionId = randomUUID();
      await client.query('INSERT INTO auth_sessions(id, user_id, expires_at) VALUES ($1, $2, $3)',
        [sessionId, current.id, expires]);
      await client.query('INSERT INTO auth_refresh_tokens(token_hash, session_id) VALUES ($1, $2)',
        [tokenHash(refresh), sessionId]);
      return { user: current, id: sessionId };
    });
    await response(res, session.user, session.id, refresh, expires);
  }
  async function refresh(req: Request, res: Response): Promise<void> {
    checkOrigin(req, true);
    const raw = readRefresh(req);
    if (!raw) { clearCookie(res); throw new ApiError(401, 'UNAUTHORIZED', 'Refresh cookie is missing or invalid.'); }
    const nextToken = randomBytes(32).toString('hex');
    // Commit replay revocation instead of throwing inside a transaction and rolling it back.
    const outcome = await transaction(pool, async client => {
      const found = await client.query<{ session_id: string }>('SELECT session_id FROM auth_refresh_tokens WHERE token_hash = $1', [tokenHash(raw)]);
      if (!found.rows[0]) return null;
      const sessionId = found.rows[0].session_id;
      const session = await client.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>(
        'SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const s = session.rows[0];
      const token = await client.query<{ used_at: Date | null }>('SELECT used_at FROM auth_refresh_tokens WHERE token_hash = $1', [tokenHash(raw)]);
      if (!s || s.revoked_at || s.expires_at.getTime() <= Date.now()) return null;
      if (token.rows[0]?.used_at) {
        await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
        return null;
      }
      const users = await client.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 AND is_active`, [s.user_id]);
      const user = users.rows[0];
      if (!user) return null;
      await client.query('UPDATE auth_refresh_tokens SET used_at = now() WHERE token_hash = $1', [tokenHash(raw)]);
      await client.query('INSERT INTO auth_refresh_tokens(token_hash, session_id) VALUES ($1, $2)', [tokenHash(nextToken), sessionId]);
      return { user, sessionId, expires: s.expires_at };
    });
    if (!outcome) { clearCookie(res); throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is expired, revoked or already used.'); }
    await response(res, outcome.user, outcome.sessionId, nextToken, outcome.expires);
  }
  async function logout(req: Request, res: Response): Promise<void> {
    const raw = readRefresh(req);
    if (raw) {
      checkOrigin(req, true);
      await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id IN
        (SELECT session_id FROM auth_refresh_tokens WHERE token_hash = $1)`, [tokenHash(raw)]);
    } else if (req.get('authorization')) {
      await authenticate(req, res, () => {});
      await pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [getPrincipal(req).sessionId]);
    } else { throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'); }
    clearCookie(res); res.status(204).end();
  }
  async function changePassword(req: Request, res: Response, current: string, next: string): Promise<void> {
    const { user } = getPrincipal(req);
    if (current === next) throw new ApiError(400, 'VALIDATION_ERROR', 'New password must differ from the current password.');
    const row = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    const previousHash = row.rows[0]?.password_hash;
    if (!previousHash || !await verifyPassword(current, previousHash)) {
      throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    const newHash = await hashPassword(next);
    await transaction(pool, async client => {
      const updated = await client.query(`UPDATE users SET password_hash = $1, must_change_password = false
        WHERE id = $2 AND is_active AND password_hash = $3 RETURNING id`, [newHash, user.id, previousHash]);
      if (!updated.rowCount) throw new ApiError(409, 'CONFLICT', 'Account changed; sign in again.');
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    });
    clearCookie(res); res.status(204).end();
  }
  return { authenticate, login, refresh, logout, changePassword };
}

// Reuse this check in B2/B3/B4/B5/B6; possession of a UUID never grants class access.
export async function requireClassAccess(pool: pg.Pool | pg.PoolClient, principal: Principal, classId: string): Promise<void> {
  const { user } = principal;
  const result = await pool.query(`SELECT c.id FROM classes c WHERE c.id = $1 AND ($2 = 'ADMIN'
    OR ($2 = 'TEACHER' AND EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.teacher_id = $3))
    OR ($2 = 'STUDENT' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.student_id = $3 AND e.is_active)))`,
  [classId, user.role, user.id]);
  if (!result.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Class was not found or is not accessible.');
}
