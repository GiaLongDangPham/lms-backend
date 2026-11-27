import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentService } from '../src/modules/assessment/service.js';

describe('AssessmentService notification publishing', () => {
  it('delegates a backfilled Published result with the current transaction and revision', async () => {
    const db = {} as pg.PoolClient;
    const grade = {
      id: 'grade-id', assignment_id: 'assignment-id', enrollment_id: 'enrollment-id',
      submission_id: null, graded_version_number: null, score: '0.00', feedback: null,
      status: 'PUBLISHED' as const, source: 'AUTO_ZERO_NO_SUBMISSION' as const, revision: 1,
      graded_by: 'teacher-id', graded_at: new Date(), published_by: 'teacher-id', published_at: new Date(),
    };
    const repository = {
      publishedAssignmentsForClass: vi.fn().mockResolvedValue([
        { id: 'assignment-id', results_published_by: 'teacher-id' },
      ]),
      insertEnrollmentAutomaticZero: vi.fn().mockResolvedValue(grade),
      enrollmentStudentId: vi.fn().mockResolvedValue('student-id'),
    };
    const resultPublished = vi.fn().mockResolvedValue(undefined);
    const publisher = { assignmentCreated: vi.fn(), resultPublished };
    const Service = AssessmentService as unknown as new (...args: unknown[]) => AssessmentService;
    const service = new Service(repository, publisher);

    await expect(service.backfillPublishedResultsForEnrollment(db, 'class-id', 'enrollment-id')).resolves.toBe(1);
    expect(resultPublished).toHaveBeenCalledWith(db,
      { id: 'grade-id', assignmentId: 'assignment-id', revision: 1 }, 'student-id');
  });
});
