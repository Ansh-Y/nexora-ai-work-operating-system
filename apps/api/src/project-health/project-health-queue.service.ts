import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { reminderRedisConnection } from '../notifications/reminder-policy';
import { ProjectHealthService } from './project-health.service';

export interface ProjectHealthJobData {
  organizationId: string;
  projectId?: string;
  forceSnapshot?: boolean;
}

export const HEALTH_QUEUE_NAME = 'nexora-project-health';

@Injectable()
export class ProjectHealthQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectHealthQueueService.name);
  private queue?: Queue<ProjectHealthJobData>;
  private worker?: Worker<ProjectHealthJobData>;
  private stopping = false;
  private intervalTimer?: NodeJS.Timeout;

  constructor(
    private config: ConfigService,
    @Inject(forwardRef(() => ProjectHealthService))
    private healthService: ProjectHealthService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('Project Health background queue disabled because REDIS_URL is not configured.');
      return;
    }

    try {
      const connection = reminderRedisConnection(redisUrl);
      this.queue = new Queue<ProjectHealthJobData>(HEALTH_QUEUE_NAME, {
        connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      });

      this.worker = new Worker<ProjectHealthJobData>(
        HEALTH_QUEUE_NAME,
        job => this.processHealthJob(job),
        { connection, concurrency: 2, stalledInterval: 30_000 },
      );

      this.queue.on('error', err => this.logger.warn(`Health queue error: ${err.message}`));
      this.worker.on('error', err => this.logger.warn(`Health worker error: ${err.message}`));
      this.worker.on('failed', (job, err) => {
        this.logger.error(`Health calculation job ${job?.id} failed on attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 3}: ${err.message}`);
      });

      // Periodic check every 60 minutes
      this.intervalTimer = setInterval(() => {
        void this.enqueuePeriodicRecalculation();
      }, 60 * 60_000);
      this.intervalTimer.unref?.();

      this.logger.log('Project Health background calculation queue initialized.');
    } catch (error) {
      this.logger.warn(`Project Health background queue could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async enqueueProjectRecalculation(organizationId: string, projectId: string, forceSnapshot = false) {
    if (!this.queue || this.stopping) {
      // Safe fallback if Redis queue is offline: execute directly in safe bounded mode
      try {
        await this.healthService.calculateAndPersistProjectHealth(organizationId, projectId, forceSnapshot);
      } catch (err) {
        this.logger.warn(`Synchronous fallback health calculation failed for project ${projectId}: ${(err as Error).message}`);
      }
      return;
    }

    try {
      await this.queue.add(
        'project-recalculation',
        { organizationId, projectId, forceSnapshot },
        {
          jobId: `health-calc-${projectId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    } catch (err) {
      this.logger.warn(`Could not enqueue health calculation for project ${projectId}: ${(err as Error).message}`);
    }
  }

  async enqueueOrganizationSweep(organizationId: string) {
    if (!this.queue || this.stopping) return;

    try {
      await this.queue.add(
        'org-health-sweep',
        { organizationId },
        {
          jobId: `health-sweep-${organizationId}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      this.logger.warn(`Could not enqueue organization health sweep for ${organizationId}: ${(err as Error).message}`);
    }
  }

  private async processHealthJob(job: Job<ProjectHealthJobData>) {
    const { organizationId, projectId, forceSnapshot } = job.data;
    if (projectId) {
      await this.healthService.calculateAndPersistProjectHealth(organizationId, projectId, forceSnapshot);
    } else {
      // Organization sweep: bounded batch of up to 10 active projects at a time
      await this.healthService.calculateOrganizationBatch(organizationId, 10);
    }
  }

  private async enqueuePeriodicRecalculation() {
    if (!this.queue || this.stopping) return;
    try {
      const orgIds = await this.healthService.getActiveOrganizationIds();
      for (const orgId of orgIds) {
        await this.enqueueOrganizationSweep(orgId);
      }
    } catch (err) {
      this.logger.warn(`Periodic health sweep enqueue error: ${(err as Error).message}`);
    }
  }
}
