import { createDatabasePool, reportDatabaseError } from './lib/database.js';
import { migrate } from './lib/migrations.js';

const pool = createDatabasePool();
try {
  const applied = await migrate(pool);
  console.info(applied.length ? `Applied: ${applied.join(', ')}` : 'Database migrations are already up to date.');
} catch (error) {
  reportDatabaseError('Migration failed', error);
} finally {
  await pool.end();
}
