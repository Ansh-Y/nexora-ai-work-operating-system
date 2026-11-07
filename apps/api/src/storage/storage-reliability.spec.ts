import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';
import {
  MAX_RETRY_DELETION_ATTEMPTS,
  MAX_SYNCHRONOUS_FALLBACK_BATCH,
  StorageRetentionService,
} from './storage-retention.service';
import { StorageProvider } from './storage.types';
import { Principal } from '../common/auth.types';

function createMockPrisma() {
  const objects: any[] = [];
  const auditEvents: any[] = [];
  const policies: any[] = [];
  const holds: any[] = [];

  return {
    _data: { objects, auditEvents, policies, holds },
    storageObject: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          objects.find(
            o =>
              (!where.id || o.id === where.id) &&
              (!where.organizationId || o.organizationId === where.organizationId) &&
              (where.deletedAt === undefined || (where.deletedAt === null ? o.deletedAt === null : o.deletedAt !== null)),
          ) || null
        );
      }),
      findMany: vi.fn(async ({ where, take }: any) => {
        let list = objects.filter(o => {
          if (where?.organizationId && o.organizationId !== where.organizationId) return false;
          if (where?.deletedAt === null && o.deletedAt !== null) return false;
          if (where?.expiresAt?.lte && (!o.expiresAt || o.expiresAt > where.expiresAt.lte)) return false;
          return true;
        });
        if (take) list = list.slice(0, take);
        return list;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return objects.find(o => o.id === where.id) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const item = objects.find(o => o.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = { id: data.id || `obj-${Math.random()}`, holds: [], ...data };
        objects.push(item);
        return item;
      }),
    },
    organizationRetentionPolicy: {
      findUnique: vi.fn(async ({ where }: any) => {
        return policies.find(p => p.organizationId === where.organizationId) || null;
      }),
    },
    organization: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.id) return [{ id: where.id }];
        return [{ id: 'org-1' }, { id: 'org-2' }];
      }),
    },
    document: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: any) => {
        auditEvents.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (cb: any) => cb({
      storageObject: {
        update: vi.fn(async ({ where, data }: any) => {
          const item = objects.find(o => o.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        }),
      },
      document: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      auditEvent: {
        create: vi.fn(async ({ data }: any) => {
          auditEvents.push(data);
          return data;
        }),
      },
    })),
  };
}

describe('Storage reliability remediation unit tests', () => {
  const adminUser: Principal = {
    sub: 'user-admin',
    email: 'admin@nexora.test',
    name: 'Admin',
    orgId: 'org-1',
    role: 'OWNER',
  };

  const otherTenantAdmin: Principal = {
    sub: 'user-tenant-2',
    email: 'admin2@nexora.test',
    name: 'Admin 2',
    orgId: 'org-2',
    role: 'OWNER',
  };

  describe('Issue 1: S3 failure handling, retries, and holds', () => {
    it('handles S3 deletion timeout: preserves record without deletedAt and transitions to PENDING_RETRY', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 's3',
        delete: vi.fn(async () => {
          throw new Error('S3 delete timed out after 30000ms');
        }),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);
      const service = new StorageService(prisma as any, providerFactory as any, retentionService);

      // Seed an active file
      const file = await prisma.storageObject.create({
        data: {
          id: 'file-s3-timeout',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/report.pdf',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'abc',
          entityType: 'DOCUMENT',
          provider: 's3',
          deletedAt: null,
          metadata: {},
        },
      });

      // Attempt manual deletion
      await expect(service.deleteFile(adminUser, file.id)).rejects.toThrow(BadGatewayException);

      // Verify DB record is NOT marked deleted
      expect(file.deletedAt).toBeNull();

      // Verify retryable state recorded in metadata
      expect(file.metadata.deletion).toBeDefined();
      expect(file.metadata.deletion.status).toBe('PENDING_RETRY');
      expect(file.metadata.deletion.attempts).toBe(1);
      expect(file.metadata.deletion.lastError).toContain('S3 delete timed out');

      // Verify audit event
      const audit = prisma._data.auditEvents.find(e => e.action === 'storage.file.deletion_failed');
      expect(audit).toBeDefined();
      expect(audit.metadata.status).toBe('PENDING_RETRY');
    });

    it('handles S3 permission failure: executeSweep records failure and does not mark deletedAt', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 's3',
        delete: vi.fn(async () => {
          throw new Error('S3 delete failed with status 403');
        }),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);

      const file = await prisma.storageObject.create({
        data: {
          id: 'file-perm-fail',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/forbidden.pdf',
          fileName: 'forbidden.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          sha256: 'xyz',
          entityType: 'DOCUMENT',
          provider: 's3',
          expiresAt: new Date(Date.now() - 10000), // expired
          deletedAt: null,
          metadata: {},
        },
      });

      // Run sweep
      const sweepRes = await retentionService.executeSweep('org-1', true);
      expect(sweepRes.failedCount).toBe(1);
      expect(sweepRes.sweptCount).toBe(0);

      // DB record must NOT be deleted
      expect(file.deletedAt).toBeNull();
      expect(file.metadata.deletion.status).toBe('PENDING_RETRY');
      expect(file.metadata.deletion.lastError).toContain('403');
    });

    it('recovers failed deletion on subsequent retry: marks deletedAt and completes', async () => {
      const prisma = createMockPrisma();
      let shouldFail = true;
      const mockProvider: Partial<StorageProvider> = {
        name: 's3',
        delete: vi.fn(async () => {
          if (shouldFail) throw new Error('Temporary S3 network glitch');
          return; // succeeds on retry
        }),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);

      const file = await prisma.storageObject.create({
        data: {
          id: 'file-retry-recovery',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/recover.pdf',
          fileName: 'recover.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'abc',
          entityType: 'DOCUMENT',
          provider: 's3',
          deletedAt: null,
          metadata: {
            deletion: {
              status: 'PENDING_RETRY',
              attempts: 1,
              nextRetryAt: new Date(Date.now() - 1000).toISOString(), // past nextRetryAt
            },
          },
        },
      });

      // Provider now succeeds
      shouldFail = false;

      // Run reconciliation
      const recResult = await retentionService.reconcileFailedDeletions('org-1');
      expect(recResult.succeeded).toBe(1);
      expect(recResult.failed).toBe(0);

      // File is now fully deleted
      expect(file.deletedAt).not.toBeNull();
      expect(file.metadata.deletion.status).toBe('COMPLETED');
      expect(file.metadata.deletion.attempts).toBe(2);

      const recoveryAudit = prisma._data.auditEvents.find(
        e => e.action === 'storage.file.deleted' && e.metadata.recovered === true,
      );
      expect(recoveryAudit).toBeDefined();
    });

    it('treats an already-missing object as a successful idempotent deletion', async () => {
      const prisma = createMockPrisma();
      // When S3 returns 404 or disk returns ENOENT, provider.delete resolves void (does not throw)
      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {
          // Idempotent: file was already gone
          return;
        }),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);
      const service = new StorageService(prisma as any, providerFactory as any, retentionService);

      const file = await prisma.storageObject.create({
        data: {
          id: 'file-already-missing',
          organizationId: 'org-1',
          storageKey: 'org-1/audio/gone.mp3',
          fileName: 'gone.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 500,
          sha256: '123',
          entityType: 'MEETING_RECORDING',
          provider: 'local',
          deletedAt: null,
          metadata: {},
        },
      });

      const res = await service.deleteFile(adminUser, file.id);
      expect(res.deleted).toBe(true);
      expect(file.deletedAt).not.toBeNull();
      expect(file.metadata.deletion.status).toBe('COMPLETED');
    });

    it('prevents concurrent duplicate sweep executions from corrupting state', async () => {
      const prisma = createMockPrisma();
      let resolveDelete: () => void;
      const deletePromise = new Promise<void>(r => { resolveDelete = r; });

      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {
          await deletePromise;
        }),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);

      await prisma.storageObject.create({
        data: {
          id: 'file-concurrency',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/concurrent.pdf',
          fileName: 'concurrent.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'cde',
          entityType: 'DOCUMENT',
          provider: 'local',
          expiresAt: new Date(Date.now() - 5000),
          deletedAt: null,
          metadata: {},
        },
      });

      // Start first sweep (runs asynchronously and waits on deletePromise)
      const sweep1Promise = retentionService.executeSweep('org-1', true);

      // Attempt second sweep immediately while first is in progress
      const sweep2 = await retentionService.executeSweep('org-1', true);
      expect(sweep2.skippedConcurrent).toBe(true);
      expect(sweep2.sweptCount).toBe(0);

      // Release first sweep
      resolveDelete!();
      const sweep1 = await sweep1Promise;
      expect(sweep1.sweptCount).toBe(1);
    });

    it('aborts and cancels deletion retry if an active legal hold is applied prior to retry', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 's3',
        delete: vi.fn(async () => {}),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);

      // File was previously in retry state
      const file = await prisma.storageObject.create({
        data: {
          id: 'file-hold-during-retry',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/held-during-retry.pdf',
          fileName: 'held-during-retry.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          sha256: 'held123',
          entityType: 'DOCUMENT',
          provider: 's3',
          deletedAt: null,
          metadata: {
            deletion: {
              status: 'PENDING_RETRY',
              attempts: 1,
              nextRetryAt: new Date(Date.now() - 1000).toISOString(),
            },
          },
          holds: [
            {
              id: 'hold-patent-1',
              organizationId: 'org-1',
              storageObjectId: 'file-hold-during-retry',
              holdType: 'LEGAL',
              reason: 'Subpoena received prior to retry',
              releasedAt: null,
            },
          ],
        },
      });

      // Run reconciliation
      const recResult = await retentionService.reconcileFailedDeletions('org-1');
      expect(recResult.cancelledByHold).toBe(1);
      expect(recResult.succeeded).toBe(0);

      // File MUST NOT be deleted!
      expect(file.deletedAt).toBeNull();
      expect(file.metadata.deletion.status).toBe('CANCELLED_HOLD_APPLIED');
      expect(file.metadata.deletion.holdReason).toBe('Subpoena received prior to retry');

      // Provider delete must not have been called
      expect(mockProvider.delete).not.toHaveBeenCalled();

      // Audit event emitted
      const cancelAudit = prisma._data.auditEvents.find(e => e.action === 'storage.deletion.cancelled_by_hold');
      expect(cancelAudit).toBeDefined();
    });

    it('enforces tenant isolation during retry and reconciliation', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {}),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(prisma as any, { get: () => null } as any, providerFactory as any);

      // Tenant 1 file in retry
      const tenant1File = await prisma.storageObject.create({
        data: {
          id: 'file-tenant-1',
          organizationId: 'org-1',
          storageKey: 'org-1/docs/t1.pdf',
          fileName: 't1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256: 't1',
          entityType: 'DOCUMENT',
          provider: 'local',
          deletedAt: null,
          metadata: {
            deletion: {
              status: 'PENDING_RETRY',
              attempts: 1,
              nextRetryAt: new Date(Date.now() - 1000).toISOString(),
            },
          },
        },
      });

      // Tenant 2 reconciles their workspace
      await retentionService.reconcileFailedDeletions('org-2');

      // Tenant 1 file MUST remain untouched
      expect(tenant1File.deletedAt).toBeNull();
      expect(tenant1File.metadata.deletion.status).toBe('PENDING_RETRY');
    });
  });

  describe('Issue 2: Redis outage, bounded sweeps, and recovery', () => {
    it('does not run an unbounded sweep when Redis is unavailable and records pending sweep', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {}),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      // Service initialized with no Redis URL -> queue unavailable
      const retentionService = new StorageRetentionService(
        prisma as any,
        { get: () => null } as any,
        providerFactory as any,
      );

      expect(retentionService.isQueueAvailable()).toBe(false);

      // Automated/routine enqueue request (force = false)
      const res = await retentionService.enqueueSweep('org-1', false);
      expect(res.queued).toBe(false);
      expect(res.message).toContain('currently unavailable');
      expect(retentionService.getPendingOfflineSweepCount()).toBe(1);

      // Audit event logged for observability
      const failedAudit = prisma._data.auditEvents.find(e => e.action === 'storage.retention_sweep.enqueue_failed');
      expect(failedAudit).toBeDefined();
    });

    it('strictly bounds synchronous fallback sweep to MAX_SYNCHRONOUS_FALLBACK_BATCH when forced offline', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {}),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(
        prisma as any,
        { get: () => null } as any,
        providerFactory as any,
      );

      // Seed 50 expired files for org-1
      for (let i = 0; i < 50; i++) {
        await prisma.storageObject.create({
          data: {
            id: `expired-${i}`,
            organizationId: 'org-1',
            storageKey: `org-1/docs/expired-${i}.pdf`,
            fileName: `expired-${i}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 100,
            sha256: `hash-${i}`,
            entityType: 'DOCUMENT',
            provider: 'local',
            expiresAt: new Date(Date.now() - 5000),
            deletedAt: null,
            metadata: {},
          },
        });
      }

      // Forced sweep while offline
      const res = await retentionService.enqueueSweep('org-1', true);
      expect(res.queued).toBe(false);
      expect(res.sweptCount).toBeLessThanOrEqual(MAX_SYNCHRONOUS_FALLBACK_BATCH);
      expect(res.sweptCount).toBe(25);
      expect(res.message).toContain('Processed bounded batch');
    });

    it('automatically resumes deferred sweeps when Redis recovery occurs', async () => {
      const prisma = createMockPrisma();
      const mockProvider: Partial<StorageProvider> = {
        name: 'local',
        delete: vi.fn(async () => {}),
      };
      const providerFactory = { getProvider: () => mockProvider as StorageProvider };
      const retentionService = new StorageRetentionService(
        prisma as any,
        { get: () => null } as any,
        providerFactory as any,
      );

      // Queue offline initially
      await retentionService.enqueueSweep('org-1', false);
      await retentionService.enqueueSweep('org-2', false);
      expect(retentionService.getPendingOfflineSweepCount()).toBe(2);

      // Mock BullMQ queue recovery
      const mockQueue = {
        add: vi.fn(async () => ({ id: 'mock-job-id' })),
      };
      (retentionService as any).queue = mockQueue;

      expect(retentionService.isQueueAvailable()).toBe(true);

      // Trigger resume
      const resumed = await retentionService.resumePendingSweeps();
      expect(resumed).toBe(2);
      expect(retentionService.getPendingOfflineSweepCount()).toBe(0);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  });
});
