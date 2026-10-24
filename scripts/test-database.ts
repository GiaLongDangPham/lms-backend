import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { env } from '../src/config/env.js';
import { verifyPassword } from '../src/security/password.js';
import { createDatabasePool, reportDatabaseError, requireLocalDatabase } from './lib/database.js';
import { migrate, migrationDirectory, migrationLock } from './lib/migrations.js';
import { domainTables, seedDevelopment, seedIds as id } from './lib/seed.js';

// Only the random database created by this invocation may be removed in cleanup.
const name = `lms_d1_check_${randomBytes(8).toString('hex')}`;
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'lms-d1-migrations-'));
let admin: pg.Pool | undefined;
let database: pg.Pool | undefined;
let created = false;
let passed = 0;

async function check(label: string, action: () => Promise<void>): Promise<void> {
  await action();
  passed++;
  console.info(`PASS ${passed}: ${label}`);
}

try {
  const url = requireLocalDatabase(env.databaseUrl);
  url.pathname = `/${name}`;
  const target = url.toString();
  admin = createDatabasePool();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const pool = createDatabasePool(target);
  database = pool;
  const rejectSql = async (sql: string, values: unknown[], code: string): Promise<void> => {
    await assert.rejects(pool.query(sql, values), { code });
  };
  const rowCounts = async (): Promise<Record<string, number>> => {
    const result: Record<string, number> = {};
    for (const table of domainTables) {
      const rows = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
      assert.ok(rows.rows[0]);
      result[table] = rows.rows[0].count;
    }
    return result;
  };

  await check('first migration creates all 15 domain tables on an empty database', async () => {
    assert.deepEqual(await migrate(pool), ['0001_initial_schema.sql', '0002_b1_auth.sql',
      '0003_client_rules.sql', '0004_b3_assignments_submissions.sql']);
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
    assert.deepEqual(tables.rows.map((row) => row.tablename).sort(), [...domainTables, 'grade_history', 'auth_sessions', 'auth_refresh_tokens'].sort());
  });
  await check('running migrations again is a no-op', async () => {
    assert.deepEqual(await migrate(pool), []);
    assert.equal((await pool.query('SELECT * FROM schema_migrations')).rowCount, 4);
  });
  await check('a competing migration/seed process cannot acquire the migration lock', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [migrationLock]);
      await assert.rejects(migrate(pool), /holds the database lock/);
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
      holder.release();
    }
  });
  const original = await readFile(path.join(migrationDirectory, '0001_initial_schema.sql'), 'utf8');
  await check('editing an applied SQL file is rejected before execution', async () => {
    await writeFile(path.join(temporaryDirectory, '0001_initial_schema.sql'), `${original}\n-- tampered\n`);
    await assert.rejects(migrate(pool, temporaryDirectory), /Applied migration was modified/);
  });
  await check('a failed migration rolls back DDL and its history entry', async () => {
    await writeFile(path.join(temporaryDirectory, '0001_initial_schema.sql'), original);
    await writeFile(path.join(temporaryDirectory, '0002_b1_auth.sql'),
      await readFile(path.join(migrationDirectory, '0002_b1_auth.sql'), 'utf8'));
    await writeFile(path.join(temporaryDirectory, '0003_client_rules.sql'),
      await readFile(path.join(migrationDirectory, '0003_client_rules.sql'), 'utf8'));
    await writeFile(path.join(temporaryDirectory, '0004_b3_assignments_submissions.sql'),
      await readFile(path.join(migrationDirectory, '0004_b3_assignments_submissions.sql'), 'utf8'));
    await writeFile(path.join(temporaryDirectory, '0005_rollback_probe.sql'),
      'CREATE TABLE rollback_probe(id integer); SELECT 1 / 0;');
    await assert.rejects(migrate(pool, temporaryDirectory), { code: '22012' });
    const probe = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.rollback_probe')::text AS table_name");
    assert.equal(probe.rows[0]?.table_name, null);
    assert.equal((await pool.query('SELECT * FROM schema_migrations')).rowCount, 4);
    assert.deepEqual(await migrate(pool), []);
  });
  await check('local-only seed guard rejects remote hosts and production', async () => {
    await assert.rejects(seedDevelopment(pool, 'LocalTestPassword2026!', 'postgresql://user:pass@remote.invalid/lms'),
      /local PostgreSQL host/);
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(seedDevelopment(pool, 'LocalTestPassword2026!', target), /must not run in production/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
  const password = 'LocalTestPassword2026!';
  await check('seed supplies multi-teacher classes, histories, attachments and Draft/Published grades', async () => {
    assert.ok(await seedDevelopment(pool, password, target) > 0);
    assert.deepEqual(await rowCounts(), {
      users: 6, classes: 2, class_teachers: 3, enrollments: 3, materials: 2,
      assignments: 3, submissions: 3, submission_versions: 4, grades: 2,
      files: 8, material_files: 2, assignment_files: 1, submission_files: 5,
      notifications: 2, comments: 2,
    });
    const history = await pool.query<{ version_number: number; files: number }>(
      `SELECT v.version_number, count(f.file_id)::int AS files
       FROM submission_versions v JOIN submission_files f USING (submission_id, version_number)
       WHERE v.submission_id = $1 GROUP BY v.version_number ORDER BY v.version_number`, [id.submission1]);
    assert.deepEqual(history.rows, [{ version_number: 1, files: 2 }, { version_number: 2, files: 1 }]);
    const late = await pool.query<{ after_deadline: boolean }>(
      'SELECT submitted_at > deadline_at_submission AS after_deadline FROM submission_versions WHERE submission_id = $1',
      [id.submissionLate]);
    assert.equal(late.rows[0]?.after_deadline, true);
  });
  await check('re-running seed preserves existing data and salted password hashes', async () => {
    const before = await rowCounts();
    const first = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [id.student1]);
    assert.equal(await seedDevelopment(pool, 'DifferentLocalPassword2026!', target), 0);
    assert.deepEqual(await rowCounts(), before);
    const second = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [id.student1]);
    const stored = first.rows[0]?.password_hash;
    assert.ok(stored);
    assert.equal(stored, second.rows[0]?.password_hash);
    assert.equal(await verifyPassword(password, stored), true);
    assert.equal(await verifyPassword('DifferentLocalPassword2026!', stored), false);
    const salts = await pool.query('SELECT DISTINCT password_hash FROM users');
    assert.equal(salts.rowCount, 6);
  });
  await check('school code, enrollment and teacher assignment duplicates are rejected', async () => {
    await rejectSql("INSERT INTO users(school_code, full_name, password_hash, role) VALUES ('SV001', 'Duplicate', 'fixture', 'STUDENT')", [], '23505');
    await rejectSql('INSERT INTO enrollments(class_id, student_id, enrolled_by) VALUES ($1, $2, $3)',
      [id.classA, id.student1, id.admin], '23505');
    await rejectSql('INSERT INTO class_teachers(class_id, teacher_id, assigned_by) VALUES ($1, $2, $3)',
      [id.classA, id.teacher1, id.admin], '23505');
  });
  await check('membership role checks remain valid after parent role updates', async () => {
    await rejectSql('INSERT INTO enrollments(class_id, student_id, enrolled_by) VALUES ($1, $2, $3)',
      [id.classB, id.teacher1, id.admin], '23514');
    await rejectSql('INSERT INTO class_teachers(class_id, teacher_id, assigned_by) VALUES ($1, $2, $3)',
      [id.classB, id.student1, id.admin], '23514');
    await rejectSql("UPDATE users SET role = 'STUDENT' WHERE id = $1", [id.teacher1], '23514');
  });
  await check('a student cannot submit to an assignment in another class', async () => {
    await rejectSql('INSERT INTO submissions(assignment_id, enrollment_id) VALUES ($1, $2)',
      [id.assignmentA, id.enrollment3], '23514');
  });
  await check('parent changes cannot move existing submissions across classes', async () => {
    await rejectSql('UPDATE enrollments SET class_id = $1 WHERE id = $2', [id.classB, id.enrollment1], '23514');
    await rejectSql('UPDATE assignments SET class_id = $1 WHERE id = $2', [id.classB, id.assignmentA], '23514');
    await rejectSql('UPDATE submissions SET enrollment_id = $1 WHERE id = $2', [id.enrollment2, id.submission1], '23514');
  });
  await check('version history cannot be overwritten and duplicate version numbers fail', async () => {
    await rejectSql(`INSERT INTO submission_versions(submission_id, version_number, deadline_at_submission)
      VALUES ($1, 1, now())`, [id.submission1], '23505');
    await rejectSql('UPDATE submission_versions SET submitted_at = now() WHERE submission_id = $1',
      [id.submission1], '23514');
  });
  await check('grade and attachment foreign keys identify the exact submission version', async () => {
    await rejectSql('UPDATE grades SET graded_version_number = 2 WHERE submission_id = $1', [id.submission2], '23514');
    await rejectSql('INSERT INTO submission_files VALUES ($1, 2, $2)',
      [id.submission2, '70000000-0000-4000-8000-000000000006'], '23503');
  });
  await check('invalid, non-finite and excessive grades are rejected; max-score edits keep existing grades valid', async () => {
    for (const score of ['-1', '11', 'NaN', 'Infinity']) {
      await rejectSql('UPDATE grades SET score = $1 WHERE submission_id = $2', [score, id.submission1], '23514');
    }
    await rejectSql('UPDATE assignments SET max_score = 8 WHERE id = $1', [id.assignmentA], '23514');
  });
  await check('Published grades require publisher/time and Draft grades cannot carry publication metadata', async () => {
    await rejectSql("UPDATE grades SET status = 'PUBLISHED' WHERE submission_id = $1", [id.submission1], '23514');
    await rejectSql("UPDATE grades SET status = 'DRAFT' WHERE submission_id = $1", [id.submission2], '23514');
  });
  await check('comments require exactly one target and notification events are deduplicated', async () => {
    await rejectSql("INSERT INTO comments(author_id, body) VALUES ($1, 'No target')", [id.student1], '23514');
    await rejectSql("INSERT INTO comments(author_id, assignment_id, submission_id, body) VALUES ($1, $2, $3, 'Two targets')",
      [id.student1, id.assignmentA, id.submission1], '23514');
    await rejectSql(`INSERT INTO notifications(recipient_id, kind, title, body, deduplication_key)
      VALUES ($1, 'ASSIGNMENT_CREATED', 'Duplicate', '', 'fixture-assignment-a')`, [id.student1], '23505');
  });
  await check('hard deletion cannot cascade away classes or submitted history', async () => {
    await rejectSql('DELETE FROM classes WHERE id = $1', [id.classA], '23503');
    await rejectSql('DELETE FROM submissions WHERE id = $1', [id.submission1], '23503');
  });
  await check('seed refuses to repurpose an existing fixture account', async () => {
    await pool.query("UPDATE users SET school_code = 'CHANGED003' WHERE id = $1", [id.student3]);
    await assert.rejects(seedDevelopment(pool, password, target), /occupied by a different account/);
    const row = await pool.query<{ school_code: string }>('SELECT school_code FROM users WHERE id = $1', [id.student3]);
    assert.equal(row.rows[0]?.school_code, 'CHANGED003');
  });
  console.info(`Database integration checks passed: ${passed}.`);
} catch (error) {
  reportDatabaseError('Database integration checks failed', error);
} finally {
  try {
    await database?.end();
    if (created && admin) {
      if (/^lms_d1_check_[a-f0-9]{16}$/.test(name)) {
        await admin.query(`DROP DATABASE "${name}"`);
        console.info('Removed only the disposable database created for this run.');
      } else {
        reportDatabaseError('Database cleanup skipped', new Error('Unexpected cleanup target.'));
      }
    }
  } catch (error) {
    reportDatabaseError('Database cleanup failed', error);
  } finally {
    await admin?.end();
    const resolved = path.resolve(temporaryDirectory);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('lms-d1-migrations-')) {
      try {
        await rm(resolved, { recursive: true, force: true });
      } catch (error) {
        reportDatabaseError('Temporary-directory cleanup failed', error);
      }
    } else {
      reportDatabaseError('Temporary-directory cleanup skipped', new Error('Unexpected cleanup target.'));
    }
  }
}
