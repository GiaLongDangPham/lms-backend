import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../b1/auth.js';
import { requireClassAccess } from '../b1/auth.js';
import { ApiError, transaction } from '../b1/common.js';
import type { FileRow } from '../assignments/assignment.repository.js';
import type { ObjectStorage } from './storage.js';
import { fileDto } from './material.service.js';
import { validateFile } from './file-policy.js';
import { defaultUploadLimits, type UploadLimits } from './upload-limits.js';

interface StoredFile extends FileRow { object_key: string; storage_container: string; storage_provider: string }
export class FileService {
  constructor(private pool: pg.Pool, private storage?: ObjectStorage,
    private quota: Pick<UploadLimits, 'pendingMaxFiles' | 'pendingMaxBytes'> = defaultUploadLimits) {}
  private configured() {
    if (!this.storage) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Private file storage is not configured.');
    return this.storage;
  }

  async upload(principal: Principal, path: string, name: string, declared: string) {
    const storage = this.configured();
    const { size, mime } = await validateFile(path, name, declared);
    // Persist the intended object first, so storage/DB failures always leave a retryable cleanup record.
    const id = randomUUID(); const key = `${principal.user.id}/${id}`;
    const row = await transaction(this.pool, async db => {
      // Serialize reservations across sessions/processes before allocating an object in storage.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [principal.user.id]);
      const usage = (await db.query<{ count: string; bytes: string }>(`SELECT count(*) AS count,
        COALESCE(sum(size_bytes),0) AS bytes FROM files WHERE uploaded_by=$1
        AND lifecycle_status IN ('PENDING','DELETE_PENDING')`, [principal.user.id])).rows[0]!;
      if (Number(usage.count) >= this.quota.pendingMaxFiles || Number(usage.bytes) + size > this.quota.pendingMaxBytes) {
        throw new ApiError(429, 'UPLOAD_QUOTA_EXCEEDED', 'Pending upload quota exceeded. Finish saving existing uploads or wait for cleanup.');
      }
      return (await db.query<FileRow>(`INSERT INTO files(id,storage_provider,storage_container,object_key,original_name,
        mime_type,size_bytes,uploaded_by,lifecycle_status) VALUES($1,'S3',$2,$3,$4,$5,$6,$7,'PENDING') RETURNING *`,
      [id, storage.bucket, key, name, mime, size, principal.user.id])).rows[0]!;
    });
    try {
      await storage.put(key, path, size);
      return fileDto(row);
    } catch {
      await this.pool.query(`UPDATE files SET lifecycle_status='DELETE_PENDING' WHERE id=$1`, [id]);
      throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Upload failed. Please retry.');
    }
  }

  async download(principal: Principal, id: string) {
    const storage = this.configured();
    const file = await transaction(this.pool, async db => {
      const f = (await db.query<StoredFile>(`SELECT * FROM files WHERE id=$1 AND lifecycle_status='ATTACHED'
        FOR SHARE`, [id])).rows[0];
      if (!f) throw new ApiError(404, 'NOT_FOUND', 'File was not found.');
      const parents = (await db.query<{ class_id: string; student_id: string | null; kind: string }>(`
        SELECT m.class_id,NULL::uuid AS student_id,'material' AS kind FROM material_files mf
          JOIN materials m ON m.id=mf.material_id WHERE mf.file_id=$1
        UNION ALL SELECT a.class_id,NULL::uuid,'assignment' FROM assignment_files af
          JOIN assignments a ON a.id=af.assignment_id WHERE af.file_id=$1
        UNION ALL SELECT a.class_id,e.student_id,'submission' FROM submission_files sf
          JOIN submissions s ON s.id=sf.submission_id JOIN assignments a ON a.id=s.assignment_id
          JOIN enrollments e ON e.id=s.enrollment_id WHERE sf.file_id=$1`, [id])).rows;
      if (parents.length !== 1) throw new ApiError(404, 'NOT_FOUND', 'File is not attached to an accessible resource.');
      const parent = parents[0]!;
      await requireClassAccess(db, principal, parent.class_id, true);
      if (principal.user.role === 'STUDENT' && parent.kind === 'submission' && parent.student_id !== principal.user.id) {
        throw new ApiError(404, 'NOT_FOUND', 'File was not found.');
      }
      return f;
    });
    if (file.storage_provider !== 'S3' || file.storage_container !== storage.bucket) {
      throw new ApiError(404, 'NOT_FOUND', 'File object is unavailable.');
    }
    try { return { file, stream: await storage.get(file.object_key) }; }
    catch { throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable.'); }
  }

  async cleanup(): Promise<number> {
    const storage = this.configured();
    return transaction(this.pool, async db => {
      const files = (await db.query<StoredFile>(`SELECT * FROM files WHERE storage_provider='S3'
        AND storage_container=$1 AND ((lifecycle_status='PENDING' AND created_at<now()-interval '24 hours')
          OR (lifecycle_status='DELETE_PENDING' AND (delete_attempted_at IS NULL OR delete_attempted_at<now()-interval '5 minutes')))
        ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`, [storage.bucket])).rows;
      let deleted = 0;
      for (const file of files) {
        const linked = await db.query(`SELECT 1 FROM material_files WHERE file_id=$1
          UNION ALL SELECT 1 FROM assignment_files WHERE file_id=$1
          UNION ALL SELECT 1 FROM submission_files WHERE file_id=$1`, [file.id]);
        if (linked.rowCount) continue;
        try { await storage.remove(file.object_key); }
        catch {
          await db.query(`UPDATE files SET lifecycle_status='DELETE_PENDING',attached_at=NULL,
            delete_attempted_at=now() WHERE id=$1`, [file.id]);
          continue;
        }
        await db.query('DELETE FROM files WHERE id=$1', [file.id]); deleted++;
      }
      return deleted;
    });
  }
}
