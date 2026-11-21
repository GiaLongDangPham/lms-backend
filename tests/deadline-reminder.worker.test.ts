import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeadlineReminderWorker } from '../src/modules/notifications/deadline-reminder.worker.js';

describe('deadline reminder worker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('dispatches immediately and once per five-minute tick', async () => {
    const dispatch = vi.fn(async () => 2);
    const worker = createDeadlineReminderWorker(dispatch);

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    worker.stop();
  });

  it('skips ticks while a dispatch is pending and resumes after it settles', async () => {
    let resolveFirst!: (value: number) => void;
    const first = new Promise<number>(resolve => { resolveFirst=resolve; });
    const dispatch = vi.fn().mockReturnValueOnce(first).mockResolvedValue(0);
    const worker = createDeadlineReminderWorker(dispatch);

    worker.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    resolveFirst(1);
    await first;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(dispatch).toHaveBeenCalledTimes(2);
    worker.stop();
  });

  it('retries after rejection and logs only a sanitized message', async () => {
    const logger = { error: vi.fn() };
    const dispatch = vi.fn().mockRejectedValueOnce(
      new Error('postgresql://admin:secret@private-host/lms')).mockResolvedValue(0);
    const worker = createDeadlineReminderWorker(dispatch,{logger});

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith('Deadline reminder dispatch failed.');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(dispatch).toHaveBeenCalledTimes(2);
    worker.stop();
  });

  it('starts and stops idempotently and performs no dispatch after stop', async () => {
    const dispatch = vi.fn(async () => 0);
    const worker = createDeadlineReminderWorker(dispatch);
    worker.start(); worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    worker.stop(); worker.stop();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
