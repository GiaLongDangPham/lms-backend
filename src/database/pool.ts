import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  query_timeout: 3000,
});

pool.on('error', () => {
  console.error('An idle PostgreSQL connection failed. Check database availability.');
});

export async function checkDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}
