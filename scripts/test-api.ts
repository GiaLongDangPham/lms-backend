import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type pg from 'pg';
import { env } from '../src/config/env.js';
import { createDatabasePool, requireLocalDatabase, reportDatabaseError } from './lib/database.js';
import { migrate } from './lib/migrations.js';
import { seedDevelopment } from './lib/seed.js';

async function runFile(file: string) {
 const databaseName = `lms_b1_check_${randomBytes(8).toString('hex')}`;
 let admin: pg.Pool | undefined; let pool: pg.Pool | undefined; let created = false;
 try {
  const url = requireLocalDatabase(env.databaseUrl);
  admin = createDatabasePool();
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  url.pathname = `/${databaseName}`; const target = url.toString();
  pool = createDatabasePool(target);
  await migrate(pool);
  await seedDevelopment(pool, 'B1IntegrationPassword2026!', target);
  await pool.end(); pool = undefined;
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', file],
      { stdio: 'inherit', env: { ...process.env, B1_TEST_DATABASE_URL: target } });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  if (code !== 0) process.exitCode = code;
} catch (error) { reportDatabaseError('B1 API test failed', error); process.exitCode = 1; }
finally {
  try {
    await pool?.end();
    // Drop only the unique database successfully created by this invocation.
    if (created && /^lms_b1_check_[a-f0-9]{16}$/.test(databaseName)) {
      await admin?.query(`DROP DATABASE "${databaseName}"`);
      console.info('Removed the temporary B1 test database.');
    }
  } catch (error) { reportDatabaseError('B1 test cleanup failed', error); process.exitCode = 1; }
  finally { await admin?.end(); }
}
}
const selected = process.argv.includes('--enrollment-publication')
  ? ['tests/enrollment-publication.integration.test.ts']
  : process.argv.includes('--assessment-publication') ? ['tests/assessment-publication.integration.test.ts']
  : process.argv.includes('--notifications') ? ['tests/notifications.integration.test.ts']
  : process.argv.includes('--materials') ? ['tests/materials.integration.test.ts']
  : process.argv.includes('--assignments') ? ['tests/assignments.integration.test.ts']
    : process.argv.includes('--client-rules') ? ['tests/client-rules.integration.test.ts']
    : ['tests/b1.integration.test.ts', 'tests/client-rules.integration.test.ts',
      'tests/assignments.integration.test.ts', 'tests/enrollment-publication.integration.test.ts',
      'tests/assessment-publication.integration.test.ts', 'tests/materials.integration.test.ts',
      'tests/notifications.integration.test.ts'];
for (const file of selected) {
  await runFile(file);
}
