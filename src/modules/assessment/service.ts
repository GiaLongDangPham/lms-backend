import type { Principal } from '../b1/auth.js';
import { ApiError, transaction } from '../b1/common.js';
import { AssessmentRepository, type Db, type GradeRow } from './assessment.repository.js';

export interface SaveSubmissionGradeInput {
  score: number;
  feedback?: string | null;
  gradedVersionNumber: number;
}

export interface CorrectPublishedNoSubmissionGradeInput {
  score: number;
  feedback?: string | null;
}

interface UserSummary {
  id: string;
  schoolCode: string;
  fullName: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
}

export interface PublishedGrade {
  assignmentId: string;
  student: UserSummary;
  submissionId: string | null;
  gradedVersionNumber: number | null;
  score: number;
  feedback: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  source: 'MANUAL' | 'AUTO_ZERO_NO_SUBMISSION';
  publishedBy: UserSummary | null;
  publishedAt: string | null;
}

export interface Grade extends PublishedGrade {
  gradedBy: UserSummary;
  gradedAt: string;
}

export interface GradeHistory {
  assignmentId: string;
  student: UserSummary;
  items: Array<{
    version: number;
    score: number;
    feedback: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    source: 'MANUAL' | 'AUTO_ZERO_NO_SUBMISSION';
    changedBy: UserSummary;
    changedAt: string;
  }>;
}

export interface AssignmentGradePublication {
  assignmentId: string;
  publishedCount: number;
  automaticZeroCount: number;
  publishedAt: string;
}

export class AssessmentService {
  constructor(private readonly repository: AssessmentRepository) {}

  private teacherOnly(principal: Principal): void {
    if (principal.user.role !== 'TEACHER') {
      throw new ApiError(403, 'FORBIDDEN', 'Assigned teacher access is required.');
    }
  }

  private studentOnly(principal: Principal): void {
    if (principal.user.role !== 'STUDENT') {
      throw new ApiError(403, 'FORBIDDEN', 'Student access is required.');
    }
  }

  private async assignmentAccess(db: Db, principal: Principal, assignmentId: string, lock = false) {
    const assignment = await this.repository.findAssignment(db, assignmentId);
    if (!assignment) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    const hasAccess = await this.repository.hasClassAccess(db, principal, assignment.class_id, lock);
    if (!hasAccess) throw new ApiError(404, 'NOT_FOUND', 'Class was not found or is not accessible.');
    if (!lock) return assignment;
    const locked = await this.repository.findAssignment(db, assignmentId, true);
    if (!locked || locked.class_id !== assignment.class_id) {
      throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    }
    return locked;
  }

  private async submissionAccess(db: Db, principal: Principal, submissionId: string, lock = false) {
    if (principal.user.role === 'ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Submission details are restricted to their student and assigned teachers.');
    }
    const submission = await this.repository.findSubmissionTarget(db, submissionId);
    if (!submission || (principal.user.role === 'STUDENT' && submission.student_id !== principal.user.id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Submission was not found.');
    }
    const assignment = await this.assignmentAccess(db, principal, submission.assignment_id, lock);
    return { submission, assignment };
  }

  private async userSummary(db: Db, userId: string): Promise<UserSummary> {
    const user = await this.repository.userSummary(db, userId);
    return { id: user.id, schoolCode: user.school_code, fullName: user.full_name, role: user.role };
  }

  private async gradeDto(db: Db, grade: GradeRow): Promise<Grade>;
  private async gradeDto(db: Db, grade: GradeRow, publishedOnly: true): Promise<PublishedGrade>;
  private async gradeDto(db: Db, grade: GradeRow, publishedOnly = false): Promise<Grade | PublishedGrade> {
    const studentId = await this.repository.enrollmentStudentId(db, grade.enrollment_id);
    const data: PublishedGrade = {
      assignmentId: grade.assignment_id,
      student: await this.userSummary(db, studentId),
      submissionId: grade.submission_id,
      gradedVersionNumber: grade.graded_version_number,
      score: Number(grade.score),
      feedback: grade.feedback,
      status: grade.status,
      source: grade.source,
      publishedBy: grade.published_by ? await this.userSummary(db, grade.published_by) : null,
      publishedAt: grade.published_at?.toISOString() ?? null,
    };
    if (publishedOnly) return data;
    return { ...data, gradedBy: await this.userSummary(db, grade.graded_by),
      gradedAt: grade.graded_at.toISOString() };
  }

  private async historyDto(db: Db, assignmentId: string, studentId: string,
    publishedOnly: boolean): Promise<GradeHistory> {
    const grade = await this.repository.findStudentGrade(db, assignmentId, studentId);
    if (!grade || (publishedOnly && grade.status !== 'PUBLISHED')) {
      throw new ApiError(404, 'NOT_FOUND', 'Published result was not found.');
    }
    const history = await this.repository.gradeHistory(db, grade.id, publishedOnly);
    return {
      assignmentId,
      student: await this.userSummary(db, studentId),
      items: await Promise.all(history.map(async item => ({
        version: item.version,
        score: Number(item.score),
        feedback: item.feedback,
        status: item.status,
        source: item.source,
        changedBy: await this.userSummary(db, item.changed_by),
        changedAt: item.changed_at.toISOString(),
      }))),
    };
  }

  async getSubmissionGrade(principal: Principal, submissionId: string): Promise<Grade> {
    this.teacherOnly(principal);
    await this.submissionAccess(this.repository.db(), principal, submissionId);
    const grade = await this.repository.findGradeBySubmission(this.repository.db(), submissionId);
    if (!grade) throw new ApiError(404, 'NOT_FOUND', 'No grade exists.');
    return this.gradeDto(this.repository.db(), grade);
  }

  async saveSubmissionGrade(principal: Principal, submissionId: string,
    input: SaveSubmissionGradeInput): Promise<Grade> {
    this.teacherOnly(principal);
    return transaction(this.repository.db(), async db => {
      const { submission, assignment } = await this.submissionAccess(db, principal, submissionId, true);
      if (input.score > Number(assignment.max_score)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Score exceeds the assignment maximum.');
      }
      const version = await this.repository.findGradedVersion(db, submissionId);
      if (input.gradedVersionNumber !== version) {
        throw new ApiError(409, 'STALE_SUBMISSION_VERSION',
          'Use the recorded graded version, or the current version for a first grade.');
      }
      const grade = await this.repository.saveSubmissionGrade(db, {
        target: submission,
        version: input.gradedVersionNumber,
        score: input.score,
        feedback: input.feedback ?? null,
        feedbackProvided: input.feedback !== undefined,
        teacherId: principal.user.id,
      });
      if (grade.status === 'PUBLISHED') await this.repository.notifyResult(db, grade, submission.student_id);
      return this.gradeDto(db, grade);
    });
  }

  async correctPublishedNoSubmissionGrade(principal: Principal, assignmentId: string, studentId: string,
    input: CorrectPublishedNoSubmissionGradeInput): Promise<Grade> {
    this.teacherOnly(principal);
    return transaction(this.repository.db(), async db => {
      const assignment = await this.assignmentAccess(db, principal, assignmentId, true);
      if (input.score > Number(assignment.max_score)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Score exceeds the assignment maximum.');
      }
      const grade = await this.repository.correctPublishedNoSubmissionGrade(db, {
        assignmentId,
        studentId,
        score: input.score,
        feedback: input.feedback ?? null,
        feedbackProvided: input.feedback !== undefined,
        teacherId: principal.user.id,
      });
      if (!grade) throw new ApiError(404, 'NOT_FOUND', 'No Published result without a submission exists.');
      await this.repository.notifyResult(db, grade, studentId);
      return this.gradeDto(db, grade);
    });
  }

  async publishAssignmentGrades(principal: Principal, assignmentId: string): Promise<AssignmentGradePublication> {
    this.teacherOnly(principal);
    return transaction(this.repository.db(), async db => {
      const assignment = await this.assignmentAccess(db, principal, assignmentId, true);
      const cohort = await this.repository.publicationCohort(db, assignment.class_id);
      const enrollmentIds = cohort.map(enrollment => enrollment.id);
      const blockers = await this.repository.ungradedSubmissions(db, assignmentId, enrollmentIds);
      if (blockers.length) {
        const error = new ApiError(409, 'UNGRADED_SUBMISSIONS',
          'All submitted work must be graded before publication.');
        Object.assign(error, { details: { ungradedSubmissions: await Promise.all(blockers.map(async blocker => ({
          submissionId: blocker.id,
          student: await this.userSummary(db, blocker.student_id),
        }))) } });
        throw error;
      }
      let automaticZeroCount = 0;
      for (const enrollment of cohort) {
        automaticZeroCount += await this.repository.insertAutomaticZero(db, assignmentId,
          enrollment.id, principal.user.id);
      }
      await this.repository.publishDraftGrades(db, assignmentId, enrollmentIds, principal.user.id);
      const results = await this.repository.publishedResults(db, assignmentId, enrollmentIds);
      for (const grade of results) await this.repository.notifyResult(db, grade, grade.student_id);
      const publishedAt = await this.repository.recordAssignmentPublication(db, assignmentId, principal.user.id);
      return { assignmentId, publishedCount: results.length, automaticZeroCount,
        publishedAt: publishedAt.toISOString() };
    });
  }

  async getMyResult(principal: Principal, assignmentId: string): Promise<PublishedGrade> {
    this.studentOnly(principal);
    await this.assignmentAccess(this.repository.db(), principal, assignmentId);
    const grade = await this.repository.findPublishedGrade(this.repository.db(), assignmentId, principal.user.id);
    if (!grade) throw new ApiError(404, 'NOT_FOUND', 'Published result was not found.');
    return this.gradeDto(this.repository.db(), grade, true);
  }

  async getMyResultHistory(principal: Principal, assignmentId: string): Promise<GradeHistory> {
    this.studentOnly(principal);
    await this.assignmentAccess(this.repository.db(), principal, assignmentId);
    return this.historyDto(this.repository.db(), assignmentId, principal.user.id, true);
  }

  async getStudentResultHistory(principal: Principal, assignmentId: string,
    studentId: string): Promise<GradeHistory> {
    this.teacherOnly(principal);
    await this.assignmentAccess(this.repository.db(), principal, assignmentId);
    return this.historyDto(this.repository.db(), assignmentId, studentId, false);
  }
}
