import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { cursorId, paging, parse, uuid } from '../b1/common.js';
import { AssessmentController } from './assessment.controller.js';
import type { AssessmentService } from './service.js';

const scoreSchema = z.number().finite().min(0).refine(value =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
{ message: 'Score must have at most two decimal places.' });
const saveSchema = z.object({
  score: scoreSchema,
  feedback: z.string().max(5000).nullable().optional(),
  gradedVersionNumber: z.number().int().min(1),
}).strict();
const correctionSchema = z.object({
  score: scoreSchema,
  feedback: z.string().max(5000).nullable().optional(),
}).strict();

export function createAssessmentRouter(pool: pg.Pool, config: AuthConfig, service: AssessmentService) {
  const router = Router();
  const auth = createAuth(pool, config);
  const controller = new AssessmentController(service);
  router.use(auth.authenticate, requireChangedPassword, (_request, response, next) => {
    response.set('Cache-Control', 'no-store'); next();
  });

  router.get('/submissions/:submissionId/grade', async (request, response) => {
    await controller.getSubmissionGrade(response, getPrincipal(request),
      parse(uuid, request.params.submissionId));
  });
  router.get('/assignments/:assignmentId/grades', async (request, response) => {
    const assignmentId = parse(uuid, request.params.assignmentId);
    const query = parse(paging.strict(), request.query);
    const scope = `grades:${assignmentId}`;
    response.json(await service.listAssignmentGrades(getPrincipal(request), assignmentId,
      cursorId(query.cursor, scope), query.limit, scope));
  });
  router.put('/submissions/:submissionId/grade', async (request, response) => {
    await controller.saveSubmissionGrade(response, getPrincipal(request),
      parse(uuid, request.params.submissionId), parse(saveSchema, request.body));
  });
  router.put('/assignments/:assignmentId/grades/:studentId', async (request, response) => {
    await controller.correctPublishedNoSubmissionGrade(response, getPrincipal(request),
      parse(uuid, request.params.assignmentId), parse(uuid, request.params.studentId),
      parse(correctionSchema, request.body));
  });
  router.post('/assignments/:assignmentId/grades/publish', async (request, response) => {
    await controller.publishAssignmentGrades(response, getPrincipal(request),
      parse(uuid, request.params.assignmentId));
  });
  router.get('/assignments/:assignmentId/my-result', async (request, response) => {
    await controller.getMyResult(response, getPrincipal(request), parse(uuid, request.params.assignmentId));
  });
  router.get('/assignments/:assignmentId/my-result/history', async (request, response) => {
    await controller.getMyResultHistory(response, getPrincipal(request),
      parse(uuid, request.params.assignmentId));
  });
  router.get('/assignments/:assignmentId/grades/:studentId/history', async (request, response) => {
    await controller.getStudentResultHistory(response, getPrincipal(request),
      parse(uuid, request.params.assignmentId), parse(uuid, request.params.studentId));
  });
  return router;
}
