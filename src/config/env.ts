import 'dotenv/config';

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
for (const origin of corsOrigins) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths.');
  }
}
if (process.env.DATABASE_SSL && !['true', 'false'].includes(process.env.DATABASE_SSL)) {
  throw new Error('DATABASE_SSL must be true or false.');
}

export const env = {
  host: process.env.HOST ?? '127.0.0.1',
  port,
  corsOrigins,
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL === 'true',
};
