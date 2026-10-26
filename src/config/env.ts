import 'dotenv/config';
import { uploadLimitsFromEnv } from '../modules/materials/upload-limits.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
}
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
}

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const localApiOrigins = process.env.NODE_ENV === 'production' ? '' : `http://localhost:${port},http://127.0.0.1:${port}`;
const authOrigins = [...new Set([...corsOrigins, ...(process.env.AUTH_TRUSTED_ORIGINS ?? localApiOrigins)
  .split(',').map(origin => origin.trim()).filter(Boolean)])];
for (const origin of [...corsOrigins, ...authOrigins]) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error('CORS_ORIGINS and AUTH_TRUSTED_ORIGINS must contain exact HTTP(S) origins without paths.');
  }
}
if (process.env.DATABASE_SSL && !['true', 'false'].includes(process.env.DATABASE_SSL)) {
  throw new Error('DATABASE_SSL must be true or false.');
}

export const env = {
  host: process.env.HOST ?? '127.0.0.1',
  port,
  corsOrigins,
  authOrigins,
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  uploadLimits: uploadLimitsFromEnv(),
  auth: {
    secret: process.env.JWT_SECRET ?? '',
    issuer: process.env.JWT_ISSUER ?? 'lms-backend',
    audience: process.env.JWT_AUDIENCE ?? 'lms-frontend',
    cookieSecure: process.env.REFRESH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    cookieSameSite: (process.env.REFRESH_COOKIE_SAME_SITE ?? 'lax') as 'lax' | 'none',
  },
};

if (!['lax', 'none'].includes(env.auth.cookieSameSite)) {
  throw new Error('REFRESH_COOKIE_SAME_SITE must be lax or none.');
}
if (process.env.REFRESH_COOKIE_SECURE && !['true', 'false'].includes(process.env.REFRESH_COOKIE_SECURE)) {
  throw new Error('REFRESH_COOKIE_SECURE must be true or false.');
}
if (env.auth.cookieSameSite === 'none' && !env.auth.cookieSecure) {
  throw new Error('SameSite=None requires a Secure refresh cookie.');
}
