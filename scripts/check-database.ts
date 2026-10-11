import { checkDatabase, pool } from '../src/database/pool.js';

try {
  await checkDatabase();
  console.info('PostgreSQL connection verified (SELECT 1).');
} catch {
  console.error('PostgreSQL check failed. Check .env, Docker Desktop and database availability.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
