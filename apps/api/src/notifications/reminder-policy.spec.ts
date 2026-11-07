import { describe, expect, it } from 'vitest';
import { deadlineReminderEventKey, isDeadlineReminderEligible, nextDailySweepUtc, nextSchedulerRetryDelay, REMINDER_JOB_OPTIONS, REMINDER_SCHEDULE, reminderRedisConnection } from './reminder-policy';

describe('deadline reminder policy', () => {
  it('keeps the scheduler anchored to 09:00 UTC through both DST transition seasons', () => {
    expect(REMINDER_SCHEDULE).toEqual({ pattern: '0 9 * * *', tz: 'UTC' });
    const afterUsSpringForward = nextDailySweepUtc(new Date('2026-03-08T08:30:00.000Z'));
    const afterEuropeSpringForward = nextDailySweepUtc(new Date('2026-03-29T08:30:00.000Z'));
    const afterAutumnFallback = nextDailySweepUtc(new Date('2026-11-01T08:30:00.000Z'));
    expect(afterUsSpringForward.toISOString()).toBe('2026-03-08T09:00:00.000Z');
    expect(afterEuropeSpringForward.toISOString()).toBe('2026-03-29T09:00:00.000Z');
    expect(afterAutumnFallback.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    // Local renderings differ by timezone and DST; the stored/scheduled instant remains UTC.
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric' }).format(afterUsSpringForward)).toBe('1 AM');
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric' }).format(afterEuropeSpringForward)).toBe('11');
  });

  it('sets bounded reconnection and retry-exhaustion policy', () => {
    expect(REMINDER_JOB_OPTIONS).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 30_000 } });
    expect(nextSchedulerRetryDelay(1_000)).toBe(2_000);
    expect(nextSchedulerRetryDelay(40_000)).toBe(60_000);
    expect(nextSchedulerRetryDelay(60_000)).toBe(60_000);
    expect(reminderRedisConnection('rediss://worker:secret@redis.example:6380/2')).toMatchObject({
      host: 'redis.example', port: 6380, username: 'worker', password: 'secret', db: 2,
      maxRetriesPerRequest: null, tls: {},
    });
    const connection = reminderRedisConnection('redis://localhost:6379');
    expect(connection).toMatchObject({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    expect(connection.retryStrategy?.(100)).toBe(30_000);
    expect(() => reminderRedisConnection('http://localhost:6379')).toThrow(/redis:\/\/ or rediss:\/\//);
  });

  it('skips completed, cancelled, undated, and distant tasks', () => {
    const now = new Date('2026-11-07T09:00:00.000Z');
    const dueSoon = new Date('2026-11-08T08:59:59.999Z');
    expect(isDeadlineReminderEligible('TODO', dueSoon, now)).toBe(true);
    expect(isDeadlineReminderEligible('DONE', dueSoon, now)).toBe(false);
    expect(isDeadlineReminderEligible('CANCELLED', dueSoon, now)).toBe(false);
    expect(isDeadlineReminderEligible('TODO', null, now)).toBe(false);
    expect(isDeadlineReminderEligible('TODO', new Date('2026-11-08T09:00:00.001Z'), now)).toBe(false);
  });

  it('makes same-deadline delivery idempotent and treats a changed deadline as a new reminder', () => {
    const now = new Date('2026-11-07T09:00:00.000Z');
    const due = new Date('2026-11-08T09:00:00.000Z');
    expect(deadlineReminderEventKey('task-1', due, now)).toBe(deadlineReminderEventKey('task-1', due, now));
    expect(deadlineReminderEventKey('task-1', due, now)).not.toBe(deadlineReminderEventKey('task-1', new Date('2026-11-09T09:00:00.000Z'), now));
    expect(deadlineReminderEventKey('task-1', due, now)).not.toBe(deadlineReminderEventKey('task-1', due, new Date('2026-11-08T09:00:00.000Z')));
  });
});
