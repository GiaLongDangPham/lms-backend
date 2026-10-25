import { requireClassAccess, type Principal } from '../b1/auth.js';
import { ApiError, transaction } from '../b1/common.js';
import { AssignmentRepository, type AssignmentRow, type Db, type FileRow } from './assignment.repository.js';

const MiB = 1024 * 1024;

export function isAfterDeadline(submittedAt: Date, deadlineAt: Date): boolean {
  return submittedAt.getTime() > deadlineAt.getTime();
}

export interface AssignmentInput {
  title: string; description?: string | null; deadlineAt: Date; maxScore: number; fileIds?: string[];
}
export interface AssignmentUpdate {
  title?: string; description?: string | null; deadlineAt?: Date; maxScore?: number; fileIds?: string[];
}

export class AssignmentService {
  constructor(private readonly repository: AssignmentRepository) {}

  private teacher(principal: Principal): void {
    if (principal.user.role !== 'TEACHER') {
      throw new ApiError(403, 'FORBIDDEN', 'Assigned teacher access is required.');
    }
  }

  private student(principal: Principal): void {
    if (principal.user.role !== 'STUDENT') {
      throw new ApiError(403, 'FORBIDDEN', 'Student access is required.');
    }
  }

  private classMember(principal: Principal): void {
    if (principal.user.role === 'ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Assignment access is restricted to class teachers and students.');
    }
  }

  private fileDto(file: FileRow) {
    return { id: file.id, originalName: file.original_name, mimeType: file.mime_type,
      sizeBytes: Number(file.size_bytes), createdAt: file.created_at.toISOString() };
  }

  private async validatePendingFiles(db: Db, fileIds: string[], ownerId: string): Promise<void> {
    const files = await this.repository.pendingFiles(db, fileIds, ownerId);
    if (files.length !== fileIds.length || files.some(file => file.lifecycle_status !== 'PENDING')) {
      throw new ApiError(400, 'INVALID_FILES', 'Every file must be owned, PENDING and unattached.');
    }
  }

  private async assignmentDto(db: Db, row: AssignmentRow, principal: Principal) {
    const dto: Record<string, unknown> = {
      id: row.id, classId: row.class_id, title: row.title, description: row.description,
      deadlineAt: row.deadline_at.toISOString(), maxScore: Number(row.max_score),
      files: (await this.repository.assignmentFiles(db, row.id)).map(file => this.fileDto(file)),
      createdAt: row.created_at.toISOString(),
    };
    if (principal.user.role === 'TEACHER') {
      const counts = await this.repository.assignmentCounts(db, row.id, row.class_id);
      dto.submittedCount = counts.submitted_count; dto.studentCount = counts.student_count;
    } else if (principal.user.role === 'STUDENT') {
      const state = await this.repository.studentAssignmentState(db, row.id, principal.user.id);
      dto.mySubmissionStatus = !state?.submitted_at ? 'NOT_SUBMITTED' : state.graded ? 'GRADED'
        : state.submitted_at > state.deadline_at_submission! ? 'LATE' : 'SUBMITTED';
    }
    return dto;
  }

  async list(principal: Principal, classId: string, after: string | null, limit: number) {
    this.classMember(principal);
    await requireClassAccess(this.repository.db(), principal, classId);
    const rows = await this.repository.listAssignmentIds(this.repository.db(), classId, after, limit + 1);
    const items = rows.slice(0, limit);
    return { items: await Promise.all(items.map(async item => this.assignmentDto(this.repository.db(),
      (await this.repository.findAssignment(this.repository.db(), item.id))!, principal))),
    hasMore: rows.length > limit, lastId: items.at(-1)?.id };
  }

  async get(principal: Principal, assignmentId: string) {
    this.classMember(principal);
    const row = await this.repository.findAssignment(this.repository.db(), assignmentId);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    await requireClassAccess(this.repository.db(), principal, row.class_id);
    return this.assignmentDto(this.repository.db(), row, principal);
  }

  async create(principal: Principal, classId: string, input: AssignmentInput) {
    this.teacher(principal);
    return transaction(this.repository.db(), async db => {
      await requireClassAccess(db, principal, classId, true);
      const fileIds = input.fileIds ?? [];
      await this.validatePendingFiles(db, fileIds, principal.user.id);
      const row = await this.repository.createAssignment(db, { classId, title: input.title,
        description: input.description ?? null, deadlineAt: input.deadlineAt,
        maxScore: input.maxScore, createdBy: principal.user.id });
      if (fileIds.length) await this.repository.replaceAssignmentFiles(db, row.id, fileIds);
      return this.assignmentDto(db, row, principal);
    });
  }

  async update(principal: Principal, assignmentId: string, input: AssignmentUpdate) {
    this.teacher(principal);
    return transaction(this.repository.db(), async db => {
      const initial = await this.repository.findAssignment(db, assignmentId);
      if (!initial) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
      await requireClassAccess(db, principal, initial.class_id, true);
      const current = await this.repository.lockAssignmentInClass(db, assignmentId, initial.class_id);
      if (!current) {
        throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
      }
      if (input.fileIds) {
        const retained = await this.repository.assignmentFileIds(db, assignmentId);
        await this.validatePendingFiles(db, input.fileIds.filter(id => !retained.includes(id)), principal.user.id);
      }
      const row = await this.repository.updateAssignment(db, current, input);
      if (input.fileIds) await this.repository.replaceAssignmentFiles(db, assignmentId, input.fileIds);
      return this.assignmentDto(db, row, principal);
    });
  }

  private async submissionDto(db: Db, submissionId: string, principal: Principal, includeGrade = false) {
    const submission = await this.repository.findSubmission(db, submissionId);
    if (!submission) throw new ApiError(404, 'NOT_FOUND', 'Submission was not found.');
    const assignment = await this.repository.findAssignment(db, submission.assignment_id);
    if (!assignment) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    const versions = await this.repository.submissionVersions(db, submissionId);
    const files = await this.repository.submissionFiles(db, submissionId);
    const grade = await this.repository.gradeSummary(db, submissionId);
    const deadlineLocked = versions.length > 0 &&
      isAfterDeadline(await this.repository.serverTime(db), assignment.deadline_at);
    const user = await this.repository.userSummary(db, submission.student_id);
    const dto: Record<string, unknown> = {
      id: submission.id, assignmentId: submission.assignment_id,
      student: { id: user.id, schoolCode: user.school_code, fullName: user.full_name, role: user.role },
      currentVersionNumber: versions.at(-1)?.version_number ?? 0,
      versions: versions.map(version => ({ versionNumber: version.version_number,
        submittedAt: version.submitted_at.toISOString(),
        deadlineAtSubmission: version.deadline_at_submission.toISOString(),
        isLate: isAfterDeadline(version.submitted_at, version.deadline_at_submission),
        files: files.filter(file => file.version_number === version.version_number).map(file => this.fileDto(file)) })),
      canSubmit: !grade && !assignment.results_published_at && !deadlineLocked,
      lockedReason: grade || assignment.results_published_at ? 'GRADED' : deadlineLocked ? 'DEADLINE_PASSED' : null,
      createdAt: submission.created_at.toISOString(),
    };
    if (includeGrade) dto.grade = grade ? { status: grade.status, source: grade.source,
      score: Number(grade.score) } : null;
    return dto;
  }

  async submit(principal: Principal, assignmentId: string, fileIds: string[]) {
    this.student(principal);
    const submissionId = await transaction(this.repository.db(), async db => {
      const initial = await this.repository.findAssignment(db, assignmentId);
      if (!initial) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
      await requireClassAccess(db, principal, initial.class_id, true);
      const assignment = await this.repository.lockAssignmentInClass(db, assignmentId, initial.class_id);
      if (!assignment) {
        throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
      }
      const enrollment = await this.repository.activeEnrollment(db, assignment.class_id, principal.user.id, true);
      if (!enrollment) throw new ApiError(404, 'NOT_FOUND', 'Active enrollment is required.');
      const existing = await this.repository.findSubmissionForStudent(db, assignmentId, principal.user.id, true);
      if (await this.repository.hasGrade(db, assignmentId, enrollment.id) || assignment.results_published_at) {
        throw new ApiError(409, 'GRADE_LOCKS_SUBMISSION', 'Grading or publication has locked submissions.');
      }
      const files = await this.repository.pendingFiles(db, fileIds, principal.user.id);
      if (files.length !== fileIds.length || files.some(file => file.lifecycle_status !== 'PENDING')) {
        throw new ApiError(400, 'INVALID_FILES', 'Every file must be owned, PENDING and unattached.');
      }
      const total = files.reduce((sum, file) => sum + Number(file.size_bytes), 0);
      if (total > 100 * MiB) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Submission files exceed 100 MiB.');
      const submittedAt = await this.repository.serverTime(db);
      if (existing && isAfterDeadline(submittedAt, assignment.deadline_at)) {
        throw new ApiError(409, 'DEADLINE_LOCKS_RESUBMISSION', 'Extend the deadline before submitting a new version.');
      }
      const id = existing?.id ?? await this.repository.ensureSubmission(db, assignmentId, enrollment.id);
      const version = await this.repository.nextVersion(db, id);
      await this.repository.insertVersion(db, { submissionId: id, version, submittedAt,
        deadlineAt: assignment.deadline_at, fileIds });
      return id;
    });
    return this.submissionDto(this.repository.db(), submissionId, principal);
  }

  async mySubmission(principal: Principal, assignmentId: string) {
    this.student(principal);
    const assignment = await this.repository.findAssignment(this.repository.db(), assignmentId);
    if (!assignment) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    await requireClassAccess(this.repository.db(), principal, assignment.class_id);
    const submission = await this.repository.findSubmissionForStudent(this.repository.db(), assignmentId, principal.user.id);
    if (!submission) throw new ApiError(404, 'NOT_FOUND', 'No submission exists.');
    return this.submissionDto(this.repository.db(), submission.id, principal);
  }

  async getSubmission(principal: Principal, submissionId: string) {
    const submission = await this.repository.findSubmission(this.repository.db(), submissionId);
    if (!submission || (principal.user.role === 'STUDENT' && submission.student_id !== principal.user.id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Submission was not found.');
    }
    if (principal.user.role === 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Submission details are private.');
    const assignment = await this.repository.findAssignment(this.repository.db(), submission.assignment_id);
    await requireClassAccess(this.repository.db(), principal, assignment!.class_id);
    return this.submissionDto(this.repository.db(), submissionId, principal);
  }

  async listSubmissions(principal: Principal, assignmentId: string, after: string | null, limit: number) {
    this.teacher(principal);
    const assignment = await this.repository.findAssignment(this.repository.db(), assignmentId);
    if (!assignment) throw new ApiError(404, 'NOT_FOUND', 'Assignment was not found.');
    await requireClassAccess(this.repository.db(), principal, assignment.class_id);
    const rows = await this.repository.listSubmissionIds(this.repository.db(), assignmentId, after, limit + 1);
    const items = rows.slice(0, limit);
    return { items: await Promise.all(items.map(row => this.submissionDto(this.repository.db(), row.id, principal, true))),
      hasMore: rows.length > limit, lastId: items.at(-1)?.id };
  }
}
