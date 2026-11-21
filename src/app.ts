import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { TextDecoder } from 'node:util';
import type pg from 'pg';
import { createB1Router } from './modules/b1/router.js';
import { EnrollmentRepository } from './modules/b1/enrollment.repository.js';
import { EnrollmentService } from './modules/b1/enrollment.service.js';
import { createDocsRouter } from './modules/b1/docs.js';
import { ApiError } from './modules/b1/common.js';
import type { AuthConfig } from './modules/b1/auth.js';
import { AssessmentRepository } from './modules/assessment/assessment.repository.js';
import { createAssessmentRouter } from './modules/assessment/assessment.routes.js';
import { AssessmentService } from './modules/assessment/service.js';
import { createAssignmentRouter } from './modules/assignments/assignment.routes.js';
import { createMaterialRouter } from './modules/materials/material.routes.js';
import type { ObjectStorage } from './modules/materials/storage.js';
import type { UploadLimits } from './modules/materials/upload-limits.js';
import { createCommentRouter } from './modules/comments/comment.routes.js';
import { createNotificationRouter } from './modules/notifications/notification.routes.js';
import { NotificationRepository } from './modules/notifications/notification.repository.js';
import { NotificationService } from './modules/notifications/notification.service.js';

interface AppDependencies {
  corsOrigins: string[];
  checkDatabase: () => Promise<void>;
  business?: { pool: pg.Pool; auth: AuthConfig; loginLimit?: number; storage?: ObjectStorage;
    uploadLimits?: Partial<UploadLimits>; notificationService?: NotificationService };
}

export function createApp({ corsOrigins, checkDatabase, business }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || corsOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: '1mb', verify(_request, _response, bytes, encoding) {
    if (encoding !== 'utf-8') throw new ApiError(415, 'UNSUPPORTED_CHARSET', 'JSON requests must use UTF-8.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new ApiError(400, 'INVALID_ENCODING', 'Request JSON must contain valid UTF-8 bytes.'); }
  } }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'lms-backend' });
  });

  app.get('/api/ready', async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({
        status: 'unavailable',
        database: 'disconnected',
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.' },
      });
    }
  });

  if (business) {
    const notificationService = business.notificationService
      ?? new NotificationService(new NotificationRepository(business.pool));
    const assessmentService = new AssessmentService(new AssessmentRepository(business.pool), notificationService);
    const enrollmentService = new EnrollmentService(new EnrollmentRepository(business.pool), assessmentService);
    app.use('/api', createDocsRouter());
    app.use('/api', createB1Router(business.pool, business.auth, enrollmentService, business.loginLimit));
    app.use('/api', createMaterialRouter(business.pool, business.auth, business.storage, business.uploadLimits));
    app.use('/api', createAssignmentRouter(business.pool, business.auth, notificationService));
    app.use('/api', createAssessmentRouter(business.pool, business.auth, assessmentService));
    app.use('/api', createNotificationRouter(business.pool, business.auth, notificationService));
    app.use('/api', createCommentRouter(business.pool, business.auth));
  }
  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (response.headersSent) { _next(error); return; }
    if (error instanceof ApiError) {
      const details = 'details' in error && typeof error.details === 'object' ? error.details : {};
      response.status(error.status).json({ error: { code: error.code, message: error.message, ...details } });
      return;
    }
    const dbCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (['23505', '23503', '23514', '40P01', '40001'].includes(String(dbCode))) {
      response.status(409).json({ error: { code: 'CONFLICT', message: 'The change conflicts with existing data.' } });
      return;
    }
    const type = typeof error === 'object' && error !== null && 'type' in error
      ? error.type : undefined;
    if (type === 'entity.parse.failed') {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
      });
      return;
    }
    if (type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit.' },
      });
      return;
    }
    console.error('An unexpected request error occurred.');
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  };
  app.use(errorHandler);
  return app;
}
