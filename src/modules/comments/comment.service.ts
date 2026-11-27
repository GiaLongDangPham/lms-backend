import type pg from 'pg';
import { requireClassAccess, type Principal } from '../b1/auth.js';
import { ApiError, page, transaction } from '../b1/common.js';
import { CommentRepository, type CommentRow, type CommentTarget } from './comment.repository.js';

function dto(row: CommentRow) {
  return { id: row.id, author: { id: row.author_id, schoolCode: row.school_code,
    fullName: row.full_name, role: row.role }, assignmentId: row.assignment_id,
  submissionId: row.submission_id, body: row.body, createdAt: row.created_at.toISOString() };
}
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Discussion was not found or is not accessible.');

export class CommentService {
  constructor(private readonly repository: CommentRepository) {}

  private async authorize(db: pg.PoolClient, principal: Principal, target: CommentTarget, lock: boolean) {
    if (principal.user.role === 'ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Comments are restricted to class teachers and students.');
    }
    const resource = await this.repository.target(db, target);
    if (!resource) throw notFound();
    if (target.kind === 'submission' && principal.user.role === 'STUDENT'
      && resource.student_id !== principal.user.id) throw notFound();
    await requireClassAccess(db, principal, resource.class_id, lock);
    if (lock && principal.user.role === 'STUDENT'
      && !await this.repository.lockActiveEnrollment(db, resource.class_id, principal.user.id)) throw notFound();
  }

  async list(principal: Principal, target: CommentTarget, after: string | null, limit: number, scope: string) {
    return transaction(this.repository.pool, async db => {
      await this.authorize(db, principal, target, false);
      return page(await this.repository.list(db, target, after, limit), limit, scope, dto);
    });
  }

  async create(principal: Principal, target: CommentTarget, body: string) {
    return transaction(this.repository.pool, async db => {
      await this.authorize(db, principal, target, true);
      return dto(await this.repository.create(db, target, principal.user.id, body));
    });
  }
}
