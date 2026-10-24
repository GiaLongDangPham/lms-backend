import type { Principal } from './auth.js';
import { ApiError, transaction, type EnrollmentRow } from './common.js';
import { EnrollmentRepository } from './enrollment.repository.js';
import type { PublishedResultBackfill } from '../assessment/service.js';

export class EnrollmentService {
  constructor(private readonly repository: EnrollmentRepository, private readonly backfill: PublishedResultBackfill) {}

  private requireAdmin(principal: Principal): void {
    if (principal.user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Admin access is required.');
  }

  private async lockClass(db: import('pg').PoolClient, classId: string): Promise<void> {
    if (!(await this.repository.lockClass(db, classId))) {
      throw new ApiError(404, 'NOT_FOUND', 'Class was not found.');
    }
  }

  private async activeStudent(db: import('pg').PoolClient, studentId: string) {
    const student = await this.repository.findActiveStudent(db, studentId);
    if (!student) throw new ApiError(404, 'NOT_FOUND', 'Student was not found.');
    if (student.role !== 'STUDENT' || !student.is_active) {
      throw new ApiError(400, 'INVALID_MEMBER', 'An active student account is required.');
    }
    return student;
  }

  async enroll(principal: Principal, classId: string, studentId: string): Promise<EnrollmentRow> {
    this.requireAdmin(principal);
    return transaction(this.repository.db(), async db => {
      await this.lockClass(db, classId);
      await this.activeStudent(db, studentId);
      const enrollment = await this.repository.upsertEnrollment(db, classId, studentId, principal.user.id);
      if (!enrollment) throw new ApiError(409, 'CONFLICT', 'Student is already actively enrolled.');
      await this.backfill.backfillPublishedResultsForEnrollment(db, classId, enrollment.id);
      return enrollment;
    });
  }

  async setActive(principal: Principal, classId: string, enrollmentId: string,
    isActive: boolean): Promise<EnrollmentRow> {
    this.requireAdmin(principal);
    return transaction(this.repository.db(), async db => {
      await this.lockClass(db, classId);
      const existing = await this.repository.findEnrollment(db, classId, enrollmentId);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found in this class.');
      const student = await this.repository.findActiveStudent(db, existing.student_id);
      if (!student) throw new ApiError(404, 'NOT_FOUND', 'Student was not found.');
      if (isActive && (student.role !== 'STUDENT' || !student.is_active)) {
        throw new ApiError(400, 'INVALID_MEMBER', 'Student account is inactive.');
      }
      const updated = await this.repository.setEnrollmentActive(db, classId, enrollmentId, isActive);
      if (isActive) await this.backfill.backfillPublishedResultsForEnrollment(db, classId, enrollmentId);
      return updated!;
    });
  }
}
