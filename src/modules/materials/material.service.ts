import type pg from 'pg';
import type { Principal } from '../b1/auth.js';
import { requireClassAccess } from '../b1/auth.js';
import { ApiError, cursorId, page, transaction } from '../b1/common.js';
import type { FileRow } from '../assignments/assignment.repository.js';

type Db = pg.Pool | pg.PoolClient;
interface MaterialRow { id: string; class_id: string; title: string; description: string | null; created_at: Date }
export interface MaterialInput { title?: string; description?: string | null; fileIds?: string[] }
export const fileDto = (f: FileRow) => ({ id: f.id, originalName: f.original_name,
  mimeType: f.mime_type, sizeBytes: Number(f.size_bytes), createdAt: f.created_at.toISOString() });

export class MaterialService {
  constructor(private pool: pg.Pool) {}

  private staff(principal: Principal) {
    if (principal.user.role !== 'TEACHER') throw new ApiError(403, 'FORBIDDEN', 'Only assigned teachers can manage materials.');
  }

  private async dto(db: Db, row: MaterialRow) {
    const files = (await db.query<FileRow>(`SELECT f.* FROM files f JOIN material_files mf ON mf.file_id=f.id
      WHERE mf.material_id=$1 ORDER BY f.id`, [row.id])).rows;
    return { id: row.id, classId: row.class_id, title: row.title, description: row.description,
      files: files.map(fileDto), createdAt: row.created_at.toISOString() };
  }

  async list(principal: Principal, classId: string, query: { limit: number; cursor?: string }) {
    await requireClassAccess(this.pool, principal, classId);
    const scope = `materials:${principal.user.id}:${classId}`;
    const rows = (await this.pool.query<MaterialRow>(`SELECT * FROM materials WHERE class_id=$1
      AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
    [classId, cursorId(query.cursor, scope), query.limit + 1])).rows;
    const result = page(rows, query.limit, scope, row => row);
    return { ...result, items: await Promise.all(rows.slice(0, query.limit).map(row => this.dto(this.pool, row))) };
  }

  async get(principal: Principal, id: string) {
    const row = (await this.pool.query<MaterialRow>('SELECT * FROM materials WHERE id=$1', [id])).rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Material was not found.');
    await requireClassAccess(this.pool, principal, row.class_id);
    return this.dto(this.pool, row);
  }

  private async replaceFiles(db: pg.PoolClient, principal: Principal, id: string, fileIds: string[]) {
    const current = (await db.query<{ file_id: string }>('SELECT file_id FROM material_files WHERE material_id=$1', [id]))
      .rows.map(row => row.file_id);
    const added = fileIds.filter(fileId => !current.includes(fileId));
    const removed = current.filter(fileId => !fileIds.includes(fileId));
    if (added.length) {
      const files = (await db.query(`SELECT id FROM files WHERE id=ANY($1::uuid[]) AND uploaded_by=$2
        AND lifecycle_status='PENDING' AND created_at>now()-interval '24 hours' ORDER BY id FOR UPDATE`,
      [added, principal.user.id])).rows;
      if (files.length !== added.length) throw new ApiError(400, 'INVALID_FILE', 'Files must be owned, unexpired and unattached.');
    }
    if (removed.length) {
      await db.query('DELETE FROM material_files WHERE material_id=$1 AND file_id=ANY($2::uuid[])', [id, removed]);
      await db.query(`UPDATE files SET lifecycle_status='DELETE_PENDING',attached_at=NULL
        WHERE id=ANY($1::uuid[])`, [removed]);
    }
    if (added.length) await db.query(`INSERT INTO material_files(material_id,file_id)
      SELECT $1,unnest($2::uuid[])`, [id, added]);
  }

  async create(principal: Principal, classId: string, input: MaterialInput & { title: string; fileIds: string[] }) {
    this.staff(principal);
    return transaction(this.pool, async db => {
      await requireClassAccess(db, principal, classId, true);
      const row = (await db.query<MaterialRow>(`INSERT INTO materials(class_id,title,description,created_by)
        VALUES($1,$2,$3,$4) RETURNING *`, [classId, input.title, input.description ?? null, principal.user.id])).rows[0]!;
      await this.replaceFiles(db, principal, row.id, input.fileIds);
      return this.dto(db, row);
    });
  }

  async update(principal: Principal, id: string, input: MaterialInput) {
    this.staff(principal);
    return transaction(this.pool, async db => {
      const row = (await db.query<MaterialRow>('SELECT * FROM materials WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Material was not found.');
      await requireClassAccess(db, principal, row.class_id, true);
      const updated = (await db.query<MaterialRow>(`UPDATE materials SET title=$2,description=$3 WHERE id=$1 RETURNING *`,
        [id, input.title ?? row.title, input.description === undefined ? row.description : input.description])).rows[0]!;
      if (input.fileIds !== undefined) await this.replaceFiles(db, principal, id, input.fileIds);
      return this.dto(db, updated);
    });
  }
}
