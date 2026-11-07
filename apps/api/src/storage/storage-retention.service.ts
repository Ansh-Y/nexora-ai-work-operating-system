import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { reminderRedisConnection } from '../notifications/reminder-policy';
import { StorageProviderFactory } from './storage-provider.factory';

export type StorageRetentionJob =
  | { type: 'retention-sweep'; organizationId?: string; force?: boolean }
  | { type: 'incomplete-upload-cleanup'; organizationId?: string }
  | { type: 'reconcile-failed-deletions'; organizationId?: string };

const RETENTION_QUEUE_NAME = 'nexora-storage-retention';
const RETENTION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

export const MAX_RETRY_DELETION_ATTEMPTS = 5;
export const MAX_SYNCHRONOUS_FALLBACK_BATCH = 25;

@Injectable()
export class StorageRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageRetentionService.name);
  private queue?: Queue<StorageRetentionJob>;
  private worker?: Worker<StorageRetentionJob>;
  private stopping = false;
  private isSweeping = false;
  private readonly pendingOfflineSweeps = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private providerFactory: StorageProviderFactory,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('Storage retention background processing is queued only when REDIS_URL is configured');
      return;
    }

    try {
      const connection = reminderRedisConnection(redisUrl);
      this.queue = new Queue<StorageRetentionJob>(RETENTION_QUEUE_NAME, {
        connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      });

      this.worker = new Worker<StorageRetentionJob>(
        RETENTION_QUEUE_NAME,
        job => this.processJob(job),
        { connection, concurrency: 1, stalledInterval: 30_000 },
      );

      this.queue.on('error', err => this.logger.warn(`Retention queue error: ${err.message}`));
      this.worker.on('error', err => this.logger.warn(`Retention worker error: ${err.message}`));
      this.worker.on('failed', (job, err) => {
        this.logger.error(`Retention job ${job?.id} failed attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 3}: ${err.message}`);
      });

      // Resume pending sweeps on initialization if connection is ready
      await this.resumePendingSweeps();
    } catch (error) {
      this.logger.error(`Storage retention worker could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.worker?.close();
    await this.queue?.close();
  }

  isQueueAvailable(): boolean {
    return Boolean(this.queue && !this.stopping);
  }

  getPendingOfflineSweepCount(): number {
    return this.pendingOfflineSweeps.size;
  }

  async resumePendingSweeps(): Promise<number> {
    if (this.pendingOfflineSweeps.size === 0 || !this.isQueueAvailable()) return 0;
    const count = this.pendingOfflineSweeps.size;
    this.logger.log(`Resuming ${count} deferred retention sweep requests.`);
    const targets = Array.from(this.pendingOfflineSweeps);
    this.pendingOfflineSweeps.clear();

    for (const target of targets) {
      await this.enqueueSweep(target === 'all' ? undefined : target, true).catch(() => undefined);
    }
    return count;
  }

  async enqueueSweep(
    organizationId?: string,
    force = false,
  ): Promise<{ queued: boolean; message: string; sweptCount?: number }> {
    const sweepTarget = organizationId || 'all';

    if (this.isQueueAvailable()) {
      try {
        const jobId = `retention-sweep-${sweepTarget}`;
        await this.queue!.add(
          'retention-sweep',
          { type: 'retention-sweep', organizationId, force },
          { ...RETENTION_JOB_OPTIONS, jobId },
        );
        return { queued: true, message: 'Retention sweep queued for processing.' };
      } catch (err: any) {
        this.logger.warn(`Failed to add sweep to BullMQ queue: ${err.message}. Recording for recovery.`);
      }
    }

    // Queue is unavailable (Redis outage or offline)
    this.pendingOfflineSweeps.add(sweepTarget);

    if (organizationId) {
      await this.prisma.auditEvent.create({
        data: {
          organizationId,
          actorType: 'SYSTEM',
          action: 'storage.retention_sweep.enqueue_failed',
          targetType: 'retention_policy',
          targetId: organizationId,
          metadata: { reason: 'Redis queue offline. Sweep recorded for queue recovery.' },
        },
      }).catch(() => undefined);
    }

    // Safe, strictly bounded fallback if explicitly forced by admin
    if (force && organizationId) {
      this.logger.warn(`Redis queue offline. Executing safe bounded fallback sweep (max ${MAX_SYNCHRONOUS_FALLBACK_BATCH} files).`);
      const result = await this.executeSweep(organizationId, force, MAX_SYNCHRONOUS_FALLBACK_BATCH);
      return {
        queued: false,
        sweptCount: result.sweptCount,
        message: `Queue service offline. Processed bounded batch of ${result.sweptCount} files; remainder will resume upon queue recovery.`,
      };
    }

    return {
      queued: false,
      message: 'Background queue service is currently unavailable. Sweep request has been recorded and will execute automatically when the queue recovers.',
    };
  }

  private async processJob(job: Job<StorageRetentionJob>) {
    if (job.data.type === 'retention-sweep') {
      const sweepRes = await this.executeSweep(job.data.organizationId, job.data.force);
      await this.reconcileFailedDeletions(job.data.organizationId);
      return sweepRes;
    }
    if (job.data.type === 'reconcile-failed-deletions') {
      return this.reconcileFailedDeletions(job.data.organizationId);
    }
    if (job.data.type === 'incomplete-upload-cleanup') {
      return this.cleanupIncompleteUploads(job.data.organizationId);
    }
  }

  async dryRun(organizationId: string) {
    const now = new Date();
    const policy = await this.prisma.organizationRetentionPolicy.findUnique({
      where: { organizationId },
    });

    const candidates = await this.prisma.storageObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        expiresAt: { not: null, lte: now },
      },
      include: {
        holds: {
          where: { releasedAt: null },
          select: { id: true, reason: true, holdType: true, appliedAt: true },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });

    const expiringSoon = await this.prisma.storageObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        expiresAt: {
          gt: now,
          lte: new Date(now.getTime() + 14 * 86400000), // next 14 days
        },
      },
      orderBy: { expiresAt: 'asc' },
      take: 50,
    });

    const eligible = candidates.filter(c => c.holds.length === 0);
    const held = candidates.filter(c => c.holds.length > 0);

    const eligibleBytes = eligible.reduce((acc, f) => acc + f.sizeBytes, 0);
    const heldBytes = held.reduce((acc, f) => acc + f.sizeBytes, 0);

    return {
      organizationId,
      policy: policy ? {
        recordingRetentionDays: policy.recordingRetentionDays,
        documentRetentionDays: policy.documentRetentionDays,
        autoDeleteExpired: policy.autoDeleteExpired,
        manualDeletionAllowed: policy.manualDeletionAllowed,
      } : null,
      dryRunTimestamp: now,
      summary: {
        expiredCount: candidates.length,
        eligibleForDeletionCount: eligible.length,
        eligibleBytes,
        heldCount: held.length,
        heldBytes,
        expiringSoonCount: expiringSoon.length,
      },
      eligibleFiles: eligible.map(f => ({
        id: f.id,
        fileName: f.fileName,
        entityType: f.entityType,
        sizeBytes: f.sizeBytes,
        expiresAt: f.expiresAt,
        createdAt: f.createdAt,
      })),
      heldFiles: held.map(f => ({
        id: f.id,
        fileName: f.fileName,
        entityType: f.entityType,
        sizeBytes: f.sizeBytes,
        expiresAt: f.expiresAt,
        holds: f.holds,
      })),
    };
  }

  async executeSweep(organizationId?: string, force = false, limit?: number) {
    if (this.isSweeping) {
      this.logger.warn('A retention sweep is already in progress. Skipping concurrent run.');
      return { sweptCount: 0, freedBytes: 0, failedCount: 0, heldSkippedCount: 0, skippedConcurrent: true };
    }

    this.isSweeping = true;
    try {
      const now = new Date();
      const orgs = organizationId
        ? await this.prisma.organization.findMany({ where: { id: organizationId }, select: { id: true } })
        : await this.prisma.organization.findMany({ select: { id: true } });

      let sweptCount = 0;
      let freedBytes = 0;
      let failedCount = 0;
      let heldSkippedCount = 0;

      for (const org of orgs) {
        const policy = await this.prisma.organizationRetentionPolicy.findUnique({
          where: { organizationId: org.id },
        });

        if (!policy?.autoDeleteExpired && !force) {
          continue;
        }

        const candidates = await this.prisma.storageObject.findMany({
          where: {
            organizationId: org.id,
            deletedAt: null,
            expiresAt: { not: null, lte: now },
          },
          include: {
            holds: { where: { releasedAt: null } },
          },
          take: limit || 100, // strictly bounded
          orderBy: { expiresAt: 'asc' },
        });

        for (const file of candidates) {
          // 1. Strict hold enforcement
          if (file.holds.length > 0) {
            heldSkippedCount++;
            continue;
          }

          // 2. Skip files already in a retry backoff window
          const existingMeta = file.metadata as Record<string, any> | null;
          if (existingMeta?.deletion?.status === 'PENDING_RETRY') {
            continue;
          }

          try {
            const provider = this.providerFactory.getProvider(file.provider);
            await provider.delete(file.storageKey);

            // Physical deletion succeeded (or already missing) -> mark database record deleted
            await this.prisma.$transaction(async tx => {
              await tx.storageObject.update({
                where: { id: file.id },
                data: {
                  deletedAt: now,
                  metadata: {
                    ...(existingMeta || {}),
                    deletion: {
                      status: 'COMPLETED',
                      completedAt: now.toISOString(),
                    },
                  },
                },
              });

              if (file.entityType === 'DOCUMENT' && file.entityId) {
                await tx.document.deleteMany({ where: { id: file.entityId, organizationId: org.id } });
              }

              await tx.auditEvent.create({
                data: {
                  organizationId: org.id,
                  actorType: 'SYSTEM',
                  action: 'storage.retention_sweep.file_deleted',
                  targetType: 'storage_object',
                  targetId: file.id,
                  metadata: {
                    fileName: file.fileName,
                    sizeBytes: file.sizeBytes,
                    entityType: file.entityType,
                    provider: file.provider,
                    expiresAt: file.expiresAt,
                  },
                },
              });
            });

            sweptCount++;
            freedBytes += file.sizeBytes;
          } catch (error: any) {
            // Physical deletion failed -> DO NOT MARK AS DELETED! Enter retryable state
            failedCount++;
            const attempts = 1;
            const backoffSec = 10;
            const nextRetryAt = new Date(Date.now() + backoffSec * 1000);

            await this.prisma.storageObject.update({
              where: { id: file.id },
              data: {
                metadata: {
                  ...(existingMeta || {}),
                  deletion: {
                    status: 'PENDING_RETRY',
                    attempts,
                    maxAttempts: MAX_RETRY_DELETION_ATTEMPTS,
                    lastAttemptAt: now.toISOString(),
                    nextRetryAt: nextRetryAt.toISOString(),
                    lastError: error?.message || 'Physical deletion failure',
                    requestedBy: 'SYSTEM',
                  },
                },
              },
            });

            await this.prisma.auditEvent.create({
              data: {
                organizationId: org.id,
                actorType: 'SYSTEM',
                action: 'storage.retention_sweep.file_deletion_failed',
                targetType: 'storage_object',
                targetId: file.id,
                metadata: {
                  fileName: file.fileName,
                  storageKey: file.storageKey,
                  provider: file.provider,
                  error: error?.message || 'Physical deletion failure',
                  attempt: attempts,
                },
              },
            });

            this.logger.warn(`Storage delete error for ${file.storageKey}: ${error?.message}. Scheduled for retry.`);
          }
        }
      }

      return { sweptCount, freedBytes, failedCount, heldSkippedCount };
    } finally {
      this.isSweeping = false;
    }
  }

  async reconcileFailedDeletions(organizationId?: string) {
    const now = new Date();
    const candidates = await this.prisma.storageObject.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        deletedAt: null,
      },
      include: {
        holds: { where: { releasedAt: null } },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    let succeeded = 0;
    let failed = 0;
    let cancelledByHold = 0;

    for (const file of candidates) {
      const meta = file.metadata as Record<string, any> | null;
      const deletion = meta?.deletion;
      if (!deletion || deletion.status !== 'PENDING_RETRY') {
        continue;
      }

      // Check nextRetryAt backoff
      if (deletion.nextRetryAt && new Date(deletion.nextRetryAt) > now) {
        continue;
      }

      // 1. Strict hold check during retry (Requirement 9)
      if (file.holds && file.holds.length > 0) {
        cancelledByHold++;
        await this.prisma.storageObject.update({
          where: { id: file.id },
          data: {
            metadata: {
              ...(meta || {}),
              deletion: {
                ...deletion,
                status: 'CANCELLED_HOLD_APPLIED',
                holdReason: file.holds[0].reason,
                cancelledAt: now.toISOString(),
              },
            },
          },
        });

        await this.prisma.auditEvent.create({
          data: {
            organizationId: file.organizationId,
            actorType: 'SYSTEM',
            action: 'storage.deletion.cancelled_by_hold',
            targetType: 'storage_object',
            targetId: file.id,
            metadata: {
              holdId: file.holds[0].id,
              holdType: file.holds[0].holdType,
              reason: file.holds[0].reason,
            },
          },
        });
        continue;
      }

      // 2. Attempt physical deletion retry
      const attempts = (deletion.attempts || 1) + 1;
      const maxAttempts = deletion.maxAttempts || MAX_RETRY_DELETION_ATTEMPTS;

      try {
        const provider = this.providerFactory.getProvider(file.provider);
        await provider.delete(file.storageKey);

        // Success! Mark database record deleted
        await this.prisma.$transaction(async tx => {
          await tx.storageObject.update({
            where: { id: file.id },
            data: {
              deletedAt: now,
              metadata: {
                ...(meta || {}),
                deletion: {
                  ...deletion,
                  status: 'COMPLETED',
                  completedAt: now.toISOString(),
                  attempts,
                },
              },
            },
          });

          if (file.entityType === 'DOCUMENT' && file.entityId) {
            await tx.document.deleteMany({ where: { id: file.entityId, organizationId: file.organizationId } });
          }

          await tx.auditEvent.create({
            data: {
              organizationId: file.organizationId,
              actorType: 'SYSTEM',
              action: 'storage.file.deleted',
              targetType: 'storage_object',
              targetId: file.id,
              metadata: {
                fileName: file.fileName,
                provider: file.provider,
                recovered: true,
                attempts,
              },
            },
          });
        });

        succeeded++;
      } catch (retryErr: any) {
        failed++;
        const isExhausted = attempts >= maxAttempts;
        const backoffSec = Math.min(10 * Math.pow(2, attempts - 1), 3600);
        const nextRetryAt = new Date(Date.now() + backoffSec * 1000);

        await this.prisma.storageObject.update({
          where: { id: file.id },
          data: {
            metadata: {
              ...(meta || {}),
              deletion: {
                ...deletion,
                status: isExhausted ? 'FAILED_PERMANENT' : 'PENDING_RETRY',
                attempts,
                lastAttemptAt: now.toISOString(),
                nextRetryAt: isExhausted ? null : nextRetryAt.toISOString(),
                lastError: retryErr?.message || 'Storage provider deletion retry failure',
              },
            },
          },
        });

        await this.prisma.auditEvent.create({
          data: {
            organizationId: file.organizationId,
            actorType: 'SYSTEM',
            action: isExhausted ? 'storage.deletion.exhausted' : 'storage.deletion.retry_failed',
            targetType: 'storage_object',
            targetId: file.id,
            metadata: {
              fileName: file.fileName,
              storageKey: file.storageKey,
              attempt: attempts,
              maxAttempts,
              error: retryErr?.message || 'Storage provider deletion retry failure',
            },
          },
        });

        this.logger.warn(`Storage deletion retry ${attempts}/${maxAttempts} failed for ${file.id}: ${retryErr.message}`);
      }
    }

    return { succeeded, failed, cancelledByHold };
  }

  async cleanupIncompleteUploads(organizationId?: string) {
    const threshold = new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago
    const pendingObjects = await this.prisma.storageObject.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        uploadStatus: 'PENDING',
        createdAt: { lte: threshold },
        deletedAt: null,
      },
    });

    let cleaned = 0;
    for (const obj of pendingObjects) {
      try {
        const provider = this.providerFactory.getProvider(obj.provider);
        await provider.delete(obj.storageKey).catch(() => undefined);
        await this.prisma.storageObject.update({
          where: { id: obj.id },
          data: { uploadStatus: 'FAILED', deletedAt: new Date() },
        });
        cleaned++;
      } catch (err) {
        this.logger.warn(`Could not cleanup incomplete upload ${obj.id}: ${(err as Error).message}`);
      }
    }

    return { cleaned };
  }
}
