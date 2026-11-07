import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REMINDER_JOB_OPTIONS, reminderRedisConnection } from '../src/notifications/reminder-policy';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

const redisUrl = process.env.REDIS_URL;
const queueName = `nexora-reliability-${process.pid}-${Date.now()}`;
const connection = redisUrl ? reminderRedisConnection(redisUrl) : null;

describe.skipIf(!connection)('BullMQ deadline worker reliability (Redis integration)', () => {
  let queue: Queue;
  let events: QueueEvents;
  let worker: Worker;

  beforeAll(async () => {
    queue = new Queue(queueName, { connection: connection! });
    events = new QueueEvents(queueName, { connection: connection! });
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  it('reconnects after a targeted Redis disconnect', async () => {
    const client = new Redis(redisUrl!);
    const admin = new Redis(redisUrl!);
    client.on('error', () => undefined);
    admin.on('error', () => undefined);
    try {
      await Promise.all([client.ping(), admin.ping()]);
      let disconnected = false;
      const recovered = new Promise<void>(resolveReady => {
        client.on('close', () => { disconnected = true; });
        client.on('ready', () => { if (disconnected) resolveReady(); });
      });
      const clientId = String(await client.call('CLIENT', 'ID'));
      expect(await admin.call('CLIENT', 'KILL', 'ID', clientId)).toBe(1);
      await Promise.race([
        recovered,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis client did not reconnect')), 10_000)),
      ]);
      expect(await client.ping()).toBe('PONG');
    } finally {
      await Promise.all([client.quit().catch(() => undefined), admin.quit().catch(() => undefined)]);
    }
  }, 15_000);

  it('retries jobs to exhaustion, deduplicates repeated job IDs, and waits for active work on shutdown', async () => {
    let attempts = 0;
    let deliveries = 0;
    let releaseActive!: () => void;
    let signalActive!: () => void;
    const activeGate = new Promise<void>(resolveGate => { releaseActive = resolveGate; });
    const activeStarted = new Promise<void>(resolveStarted => { signalActive = resolveStarted; });
    worker = new Worker(queueName, async job => {
      if (job.name === 'always-fails') { attempts++; throw new Error('intentional retry test'); }
      if (job.name === 'dedupe') { deliveries++; return 'done'; }
      if (job.name === 'active') { signalActive(); await activeGate; return 'drained'; }
    }, { connection: connection!, concurrency: 1 });
    await worker.waitUntilReady();

    const failedId = `${queueName}-failed`;
    const failed = await queue.add('always-fails', {}, { jobId: failedId, attempts: 2, backoff: { type: 'fixed', delay: 10 }, removeOnFail: false });
    await expect(failed.waitUntilFinished(events, 10_000)).rejects.toThrow('intentional retry test');
    expect(await failed.getState()).toBe('failed');
    expect((await queue.getJob(failedId))?.attemptsMade).toBe(2);
    expect(attempts).toBe(2);
    expect(REMINDER_JOB_OPTIONS.attempts).toBe(5);

    const dedupeId = `${queueName}-dedupe`;
    const [first, duplicate] = await Promise.all([
      queue.add('dedupe', {}, { jobId: dedupeId, removeOnComplete: false }),
      queue.add('dedupe', {}, { jobId: dedupeId, removeOnComplete: false }),
    ]);
    expect(first.id).toBe(duplicate.id);
    await expect(first.waitUntilFinished(events, 10_000)).resolves.toBe('done');
    expect(deliveries).toBe(1);

    await queue.add('active', {});
    await activeStarted;
    let closed = false;
    const closePromise = worker.close().then(() => { closed = true; });
    await new Promise(resolveDelay => setTimeout(resolveDelay, 30));
    expect(closed).toBe(false);
    releaseActive();
    await closePromise;
    expect(closed).toBe(true);
    worker = undefined as unknown as Worker;
  }, 30_000);
});
