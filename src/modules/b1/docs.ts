import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

export function createDocsRouter() {
  const router = Router();
  const json = readFileSync(fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url)), 'utf8');
  const spec = JSON.parse(json);
  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    swaggerOptions: { persistAuthorization: false, withCredentials: true },
  }));
  return router;
}
