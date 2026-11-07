import type { JobsOptions, RedisOptions } from 'bullmq';
import type { TaskStatus } from '@prisma/client';

export const REMINDER_QUEUE_NAME = 'nexora-deadline-reminders';
export const REMINDER_SCHEDULER_ID = 'daily-deadline-sweep';
export const REMINDER_SCHEDULE = { pattern: '0 9 * * *', tz: 'UTC' } as const;
export const REMINDER_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

export function reminderRedisConnection(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') throw new Error('REDIS_URL must use redis:// or rediss://');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number) => Math.min(attempt * 1_000, 30_000),
  };
}

export function reminderJobTemplate() {
  return { name: 'deadline-sweep', data: {}, opts: REMINDER_JOB_OPTIONS } as const;
}

export function isDeadlineReminderEligible(status: TaskStatus | string, dueDate: Date | null, now: Date) {
  return status !== 'DONE' && status !== 'CANCELLED' && dueDate !== null && dueDate.getTime() <= now.getTime() + 86_400_000;
}

export function deadlineReminderEventKey(taskId: string, dueDate: Date, now: Date) {
  return `deadline:${taskId}:${dueDate.toISOString()}:${now.toISOString().slice(0, 10)}`;
}

export function nextDailySweepUtc(after: Date) {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), 9, 0, 0, 0));
  if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function nextSchedulerRetryDelay(currentDelayMs: number) {
  return Math.min(Math.max(currentDelayMs, 1_000) * 2, 60_000);
}
