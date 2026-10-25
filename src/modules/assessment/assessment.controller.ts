import type { Response } from 'express';
import type { Principal } from '../b1/auth.js';
import { AssessmentService, type CorrectPublishedNoSubmissionGradeInput,
  type SaveSubmissionGradeInput } from './service.js';

export class AssessmentController {
  constructor(private readonly service: AssessmentService) {}

  async getSubmissionGrade(response: Response, principal: Principal, submissionId: string) {
    response.status(200).json(await this.service.getSubmissionGrade(principal, submissionId));
  }

  async saveSubmissionGrade(response: Response, principal: Principal, submissionId: string,
    input: SaveSubmissionGradeInput) {
    response.status(200).json(await this.service.saveSubmissionGrade(principal, submissionId, input));
  }

  async correctPublishedNoSubmissionGrade(response: Response, principal: Principal, assignmentId: string,
    studentId: string, input: CorrectPublishedNoSubmissionGradeInput) {
    response.status(200).json(await this.service.correctPublishedNoSubmissionGrade(
      principal, assignmentId, studentId, input));
  }

  async publishAssignmentGrades(response: Response, principal: Principal, assignmentId: string) {
    response.status(200).json(await this.service.publishAssignmentGrades(principal, assignmentId));
  }

  async getMyResult(response: Response, principal: Principal, assignmentId: string) {
    response.status(200).json(await this.service.getMyResult(principal, assignmentId));
  }

  async getMyResultHistory(response: Response, principal: Principal, assignmentId: string) {
    response.status(200).json(await this.service.getMyResultHistory(principal, assignmentId));
  }

  async getStudentResultHistory(response: Response, principal: Principal, assignmentId: string,
    studentId: string) {
    response.status(200).json(await this.service.getStudentResultHistory(principal, assignmentId, studentId));
  }
}
