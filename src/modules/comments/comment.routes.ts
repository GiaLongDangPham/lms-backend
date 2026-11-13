import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { cursorId, paging, parse, uuid } from '../b1/common.js';
import { CommentRepository, type CommentTarget } from './comment.repository.js';
import { CommentService } from './comment.service.js';

const createComment = z.object({ body: z.string().trim().min(1) }).strict();

export function createCommentRouter(pool: pg.Pool, config: AuthConfig) {
  const router = Router();
  const service = new CommentService(new CommentRepository(pool));
  router.use(createAuth(pool, config).authenticate, requireChangedPassword, (_request, response, next) => {
    response.set('Cache-Control', 'no-store'); next();
  });
  for (const [kind, path] of [
    ['assignment', '/assignments/:targetId/comments'], ['submission', '/submissions/:targetId/comments'],
  ] as const) {
    router.get(path, async (request, response) => {
      const target: CommentTarget = { kind, id: parse(uuid, request.params.targetId) };
      const query = parse(paging.strict(), request.query);
      const scope = `comments:${kind}:${target.id}`;
      response.json(await service.list(getPrincipal(request), target,
        cursorId(query.cursor, scope), query.limit, scope));
    });
    router.post(path, async (request, response) => {
      const target: CommentTarget = { kind, id: parse(uuid, request.params.targetId) };
      const body = parse(createComment, request.body);
      response.status(201).json(await service.create(getPrincipal(request), target, body.body));
    });
  }
  return router;
}
