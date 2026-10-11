import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabase, pool } from './database/pool.js';

const app = createApp({ corsOrigins: env.corsOrigins, checkDatabase });
const server = app.listen(env.port, env.host, () => {
  console.info(`LMS API listening on http://${env.host}:${env.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`API could not start (${error.code ?? 'UNKNOWN'}). Check HOST and PORT.`);
  process.exitCode = 1;
  void pool.end();
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => {
    void pool.end().then(() => {
      clearTimeout(timeout);
    }).catch(() => process.exit(1));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
