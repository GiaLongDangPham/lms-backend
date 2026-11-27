import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { cursorId, nonempty, paging, parse, uuid } from '../b1/common.js';
import { AssignmentController } from './assignment.controller.js';
import { AssignmentRepository } from './assignment.repository.js';
import { AssignmentService } from './assignment.service.js';
import type { NotificationPublisher } from '../notifications/notification.types.js';

const preciseScore = z.number().finite().positive().max(9_999_999_999.99).refine(value =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
{ message: 'Score must have at most two decimal places.' });
const dateTime = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const fileIds = z.array(uuid).max(10).refine(ids => new Set(ids).size === ids.length);
const createAssignment = z.object({ title: nonempty, description: z.string().max(5000).nullable().optional(),
  deadlineAt: dateTime, maxScore: preciseScore, fileIds: fileIds.optional() }).strict();
const updateAssignment = z.object({ title: nonempty.optional(),
  description: z.string().max(5000).nullable().optional(), deadlineAt: dateTime.optional(),
  maxScore: preciseScore.optional(), fileIds: fileIds.optional() }).strict()
  .refine(value => Object.keys(value).length > 0);
const submitAssignment = z.object({ fileIds: fileIds.min(1) }).strict();

export function createAssignmentRouter(pool: pg.Pool, config: AuthConfig, notifications: NotificationPublisher) {
  const router = Router();
  const auth = createAuth(pool, config);
  const controller = new AssignmentController(new AssignmentService(new AssignmentRepository(pool), notifications));
  router.use(auth.authenticate, requireChangedPassword, (_request, response, next) => {
    response.set('Cache-Control', 'no-store'); next();
  });

  router.get('/classes/:classId/assignments', async (request, response) => {
    const classId = parse(uuid, request.params.classId);
    const query = parse(paging.strict(), request.query);
    const scope = `assignments:${classId}`;
    await controller.list(response, getPrincipal(request), classId, cursorId(query.cursor, scope), query.limit, scope);
  });
  router.post('/classes/:classId/assignments', async (request, response) => {
    await controller.create(response, getPrincipal(request), parse(uuid, request.params.classId),
      parse(createAssignment, request.body));
  });
  router.get('/assignments/:assignmentId', async (request, response) => {
    await controller.get(response, getPrincipal(request), parse(uuid, request.params.assignmentId));
  });
  router.patch('/assignments/:assignmentId', async (request, response) => {
    await controller.update(response, getPrincipal(request), parse(uuid, request.params.assignmentId),
      parse(updateAssignment, request.body));
  });
  router.get('/assignments/:assignmentId/submissions', async (request, response) => {
    const assignmentId = parse(uuid, request.params.assignmentId);
    const query = parse(paging.strict(), request.query);
    const scope = `submissions:${assignmentId}`;
    await controller.listSubmissions(response, getPrincipal(request), assignmentId,
      cursorId(query.cursor, scope), query.limit, scope);
  });
  router.post('/assignments/:assignmentId/submissions', async (request, response) => {
    const body = parse(submitAssignment, request.body);
    await controller.submit(response, getPrincipal(request), parse(uuid, request.params.assignmentId), body.fileIds);
  });
  router.get('/assignments/:assignmentId/my-submission', async (request, response) => {
    await controller.mySubmission(response, getPrincipal(request), parse(uuid, request.params.assignmentId));
  });
  router.get('/submissions/:submissionId', async (request, response) => {
    await controller.getSubmission(response, getPrincipal(request), parse(uuid, request.params.submissionId));
  });
  return router;
}
