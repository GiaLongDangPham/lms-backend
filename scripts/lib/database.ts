import pg from 'pg';
import { env } from '../../src/config/env.js';

export function createDatabasePool(connectionString = env.databaseUrl): pg.Pool {
  return new pg.Pool({
    connectionString,
    ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });
}

export function requireLocalDatabase(connectionString: string): URL {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('This command only supports a local PostgreSQL host.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Local seed and database tests must not run in production.');
  }
  return url;
}

export function reportDatabaseError(label: string, error: unknown): void {
  const message = error instanceof Error
    ? error.message || `${error.name}: connection unavailable; check PostgreSQL host/port and permissions`
    : 'Unknown database error';
  console.error(`${label}: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')}`);
  process.exitCode = 1;
}
