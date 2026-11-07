import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { reminderRedisConnection } from '../notifications/reminder-policy';
import { StorageProviderFactory } from './storage-provider.factory';

export type StorageRetentionJob =
  | { type: 'retention-sweep'; organizationId?: string; force?: boolean }
  | { type: 'incomplete-upload-cleanup'; organizationId?: string };

const RETENTION_QUEUE_NAME = 'nexora-storage-retention';
const RETENTION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

@Injectable()
export class StorageRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageRetentionService.name);
  private queue?: Queue<StorageRetentionJob>;
  private worker?: Worker<StorageRetentionJob>;
  private stopping = false;

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
    } catch (error) {
      this.logger.error(`Storage retention worker could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueueSweep(organizationId?: string, force = false): Promise<boolean> {
    if (!this.queue || this.stopping) {
      // Run synchronously if Redis queue unavailable
      await this.executeSweep(organizationId, force);
      return false;
    }

    await this.queue.add(
      'retention-sweep',
      { type: 'retention-sweep', organizationId, force },
      { ...RETENTION_JOB_OPTIONS, jobId: `retention-sweep-${organizationId || 'all'}-${Date.now()}` },
    );
    return true;
  }

  private async processJob(job: Job<StorageRetentionJob>) {
    if (job.data.type === 'retention-sweep') {
      return this.executeSweep(job.data.organizationId, job.data.force);
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

  async executeSweep(organizationId?: string, force = false) {
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
      });

      for (const file of candidates) {
        if (file.holds.length > 0) {
          heldSkippedCount++;
          continue;
        }

        try {
          const provider = this.providerFactory.getProvider(file.provider);
          await provider.delete(file.storageKey).catch(err => {
            this.logger.warn(`Storage delete error for ${file.storageKey}: ${(err as Error).message}`);
          });

          await this.prisma.$transaction(async tx => {
            await tx.storageObject.update({
              where: { id: file.id },
              data: { deletedAt: now },
            });

            await tx.auditEvent.create({
              data: {
                organizationId: org.id,
                actorType: 'SYSTEM',
                action: 'storage.file.expired',
                targetType: 'storage_object',
                targetId: file.id,
                metadata: {
                  fileName: file.fileName,
                  sizeBytes: file.sizeBytes,
                  entityType: file.entityType,
                  provider: file.provider,
                },
              },
            });
          });

          sweptCount++;
          freedBytes += file.sizeBytes;
        } catch (error) {
          failedCount++;
          this.logger.error(`Failed to sweep file ${file.id}: ${(error as Error).message}`);
        }
      }
    }

    return { sweptCount, freedBytes, failedCount, heldSkippedCount };
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
