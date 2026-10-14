import { env } from '../src/config/env.js';
import { createDatabasePool, reportDatabaseError } from './lib/database.js';
import { seedDevelopment } from './lib/seed.js';

const pool = createDatabasePool();
try {
  const inserted = await seedDevelopment(pool, process.env.SEED_PASSWORD ?? '', env.databaseUrl);
  console.info(`Local demo seed ready; inserted ${inserted} rows. Existing rows/passwords were preserved.`);
  console.info('File fixtures contain metadata only; no S3 objects or business APIs were created.');
} catch (error) {
  reportDatabaseError('Seed failed', error);
} finally {
  await pool.end();
}
