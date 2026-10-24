import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

export const migrationDirectory = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
export const migrationLock = 14652001;

interface Migration { version: string; checksum: string; sql: string }
interface Applied { version: string; checksum: string }

async function readMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No SQL migrations found.');
  const versions = new Set<string>();
  const migrations: Migration[] = [];
  for (const name of names) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
    const number = name.slice(0, 4);
    if (versions.has(number)) throw new Error(`Duplicate migration number: ${number}`);
    versions.add(number);
    const sql = await readFile(path.join(directory, name), 'utf8');
    migrations.push({ version: name, checksum: createHash('sha256').update(sql).digest('hex'), sql });
  }
  return migrations;
}

export async function migrate(pool: pg.Pool, directory = migrationDirectory): Promise<string[]> {
  const migrations = await readMigrations(directory);
  const client = await pool.connect();
  let locked = false;
  let transaction = false;
  try {
    const mapping: unknown = JSON.parse(process.env.CLASS_COURSE_MAPPING ?? '{}');
    if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object' || Object.entries(mapping).some(([id,code]) =>
      !/^[a-f0-9-]{36}$/i.test(id) || typeof code !== 'string' || !/^[A-Z0-9_-]{1,50}$/.test(code))) {
      throw new Error('CLASS_COURSE_MAPPING must map class UUIDs to uppercase course codes.');
    }
    await client.query("SELECT set_config('lms.class_course_mapping', $1, false)", [JSON.stringify(mapping)]);
    const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1) AS acquired', [migrationLock]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new Error('Another migration process holds the database lock.');
    await client.query('SET search_path TO public');
    await client.query("SET lock_timeout TO '10s'");
    await client.query("SET statement_timeout TO '60s'");
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const applied = await client.query<Applied>('SELECT version, checksum FROM public.schema_migrations ORDER BY version');
    for (let i = 0; i < applied.rows.length; i++) {
      const row = applied.rows[i];
      const file = migrations[i];
      if (!row || !file || row.version !== file.version) {
        throw new Error('Migration history does not match an ordered prefix of local migrations.');
      }
      if (row.checksum !== file.checksum) throw new Error(`Applied migration was modified: ${file.version}`);
    }
    const executed: string[] = [];
    for (const migration of migrations.slice(applied.rows.length)) {
      await client.query('BEGIN');
      transaction = true;
      await client.query(migration.sql);
      await client.query('INSERT INTO public.schema_migrations(version, checksum) VALUES ($1, $2)',
        [migration.version, migration.checksum]);
      await client.query('COMMIT');
      transaction = false;
      executed.push(migration.version);
    }
    return executed;
  } finally {
    let destroy = false;
    try {
      if (transaction) await client.query('ROLLBACK');
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
    } catch {
      // Destroy the connection if cleanup fails; session locks die with it.
      destroy = true;
    } finally {
      client.release(destroy);
    }
  }
}
