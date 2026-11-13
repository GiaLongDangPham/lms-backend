import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabase, pool } from './database/pool.js';
import { createS3Storage } from './modules/materials/storage.js';
import { createDeadlineReminderWorker } from './modules/notifications/deadline-reminder.worker.js';
import { NotificationRepository } from './modules/notifications/notification.repository.js';
import { NotificationService } from './modules/notifications/notification.service.js';

const notificationService = new NotificationService(new NotificationRepository(pool));
const deadlineReminderWorker = createDeadlineReminderWorker(
  () => notificationService.dispatchDeadlineReminders());
const app = createApp({ corsOrigins: env.corsOrigins, checkDatabase,
  business: { pool, auth: { ...env.auth, origins: env.authOrigins }, storage: createS3Storage(),
    uploadLimits: env.uploadLimits, notificationService } });
const server = app.listen(env.port, env.host, () => {
  console.info(`LMS API listening on http://${env.host}:${env.port}`);
  deadlineReminderWorker.start();
});

server.on('error', (error: NodeJS.ErrnoException) => {
  deadlineReminderWorker.stop();
  console.error(`API could not start (${error.code ?? 'UNKNOWN'}). Check HOST and PORT.`);
  process.exitCode = 1;
  void pool.end();
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  deadlineReminderWorker.stop();
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
