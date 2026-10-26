import { pool } from '../src/database/pool.js';
import { createS3Storage } from '../src/modules/materials/storage.js';
import { FileService } from '../src/modules/materials/file.service.js';

try {
  console.info(`Deleted ${await new FileService(pool, createS3Storage()).cleanup()} expired or detached objects.`);
} catch {
  console.error('File cleanup failed. Check database and private storage configuration.');
  process.exitCode = 1;
} finally { await pool.end(); }
