import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';

interface AppDependencies {
  corsOrigins: string[];
  checkDatabase: () => Promise<void>;
}

export function createApp({ corsOrigins, checkDatabase }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || corsOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: '1mb' }));

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

  // Register business module routers here after D1/D2 pass CP1.
  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
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
