import type { Response } from 'express';
import type { Principal } from '../b1/auth.js';
import { AssignmentService, type AssignmentInput, type AssignmentUpdate } from './assignment.service.js';

function page(result: { items: unknown[]; hasMore: boolean; lastId?: string }, scope: string) {
  return { items: result.items, page: { nextCursor: result.hasMore && result.lastId
    ? Buffer.from(JSON.stringify({ id: result.lastId, scope })).toString('base64url') : null } };
}

export class AssignmentController {
  constructor(private readonly service: AssignmentService) {}

  async list(response: Response, principal: Principal, classId: string, after: string | null,
    limit: number, scope: string) {
    response.json(page(await this.service.list(principal, classId, after, limit), scope));
  }

  async create(response: Response, principal: Principal, classId: string, input: AssignmentInput) {
    response.status(201).json(await this.service.create(principal, classId, input));
  }

  async get(response: Response, principal: Principal, assignmentId: string) {
    response.json(await this.service.get(principal, assignmentId));
  }

  async update(response: Response, principal: Principal, assignmentId: string, input: AssignmentUpdate) {
    response.json(await this.service.update(principal, assignmentId, input));
  }

  async submit(response: Response, principal: Principal, assignmentId: string, fileIds: string[]) {
    response.status(201).json(await this.service.submit(principal, assignmentId, fileIds));
  }

  async mySubmission(response: Response, principal: Principal, assignmentId: string) {
    response.json(await this.service.mySubmission(principal, assignmentId));
  }

  async getSubmission(response: Response, principal: Principal, submissionId: string) {
    response.json(await this.service.getSubmission(principal, submissionId));
  }

  async listSubmissions(response: Response, principal: Principal, assignmentId: string,
    after: string | null, limit: number, scope: string) {
    response.json(page(await this.service.listSubmissions(principal, assignmentId, after, limit), scope));
  }
}
