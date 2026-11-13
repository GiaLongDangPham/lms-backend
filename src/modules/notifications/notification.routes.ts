import { Router } from 'express';
import type pg from 'pg';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { paging, parse, uuid } from '../b1/common.js';
import { NotificationController } from './notification.controller.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';

export function createNotificationRouter(pool: pg.Pool, config: AuthConfig, service?: NotificationService) {
  const router = Router();
  const auth = createAuth(pool, config);
  const controller = new NotificationController(service ?? new NotificationService(new NotificationRepository(pool)));
  router.use(auth.authenticate, requireChangedPassword, (_request, response, next) => {
    response.set('Cache-Control', 'no-store'); next();
  });

  router.get('/notifications', async (request, response) => {
    const query = parse(paging.strict(), request.query);
    await controller.list(response, getPrincipal(request), query.cursor, query.limit);
  });

  router.patch('/notifications/:notificationId/read', async (request, response) => {
    await controller.markRead(response, getPrincipal(request), parse(uuid, request.params.notificationId));
  });

  return router;
}
