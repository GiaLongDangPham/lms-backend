export interface DeadlineReminderWorkerOptions {
  intervalMs?: number;
  logger?: Pick<Console,'error'>;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

export function createDeadlineReminderWorker(dispatch: () => Promise<number>,
  options: DeadlineReminderWorkerOptions = {}) {
  const intervalMs = options.intervalMs ?? 300_000;
  const logger = options.logger ?? console;
  const timers = options.timers ?? { setInterval, clearInterval };
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let started = false;

  async function run(): Promise<void> {
    if (!started || running) return;
    running = true;
    try {
      await dispatch();
    } catch {
      logger.error('Deadline reminder dispatch failed.');
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      timer = timers.setInterval(() => { void run(); },intervalMs);
      void run();
    },
    stop(): void {
      if (!started) return;
      started = false;
      if (timer !== undefined) timers.clearInterval(timer);
      timer = undefined;
    },
  };
}
