import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';
import { StorageProviderFactory } from './storage-provider.factory';
import { StorageRetentionService } from './storage-retention.service';
import { FileValidator } from './file-validator';
import {
  CreateRetentionHoldDto,
  ListStorageFilesQueryDto,
  ReleaseRetentionHoldDto,
  UpdateRetentionPolicyDto,
} from './storage.dto';
import { UploadFilePayload } from './storage.types';

@Injectable()
export class StorageService {
  constructor(
    private prisma: PrismaService,
    private providerFactory: StorageProviderFactory,
    private retentionService: StorageRetentionService,
  ) {}

  private assertAdmin(user: Principal) {
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only organization owners and admins can configure retention policies.');
    }
  }

  private assertManager(user: Principal) {
    if (user.role !== 'OWNER' && user.role !== 'ADMIN' && user.role !== 'PROJECT_MANAGER') {
      throw new ForbiddenException('Only owners, admins, and project managers can manage files and legal holds.');
    }
  }

  async getSummary(user: Principal) {
    const activeProviderName = this.providerFactory.getActiveProviderName();
    const provider = this.providerFactory.getProvider();

    const [totalAgg, recordingAgg, documentAgg, activeHoldsCount, policy, expiringSoonCount] = await Promise.all([
      this.prisma.storageObject.aggregate({
        where: { organizationId: user.orgId, deletedAt: null },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.storageObject.aggregate({
        where: { organizationId: user.orgId, entityType: 'MEETING_RECORDING', deletedAt: null },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.storageObject.aggregate({
        where: { organizationId: user.orgId, entityType: 'DOCUMENT', deletedAt: null },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileRetentionHold.count({
        where: { organizationId: user.orgId, releasedAt: null },
      }),
      this.prisma.organizationRetentionPolicy.findUnique({
        where: { organizationId: user.orgId },
      }),
      this.prisma.storageObject.count({
        where: {
          organizationId: user.orgId,
          deletedAt: null,
          expiresAt: {
            gt: new Date(),
            lte: new Date(Date.now() + 14 * 86400000),
          },
        },
      }),
    ]);

    return {
      provider: {
        name: activeProviderName,
        isCloud: activeProviderName === 's3',
        description: activeProviderName === 's3' ? 'Private S3 Compatible Object Storage' : 'Private Local Storage (Encrypted at Rest)',
      },
      usage: {
        totalBytes: totalAgg._sum.sizeBytes ?? 0,
        totalFiles: totalAgg._count._all ?? 0,
        recordingBytes: recordingAgg._sum.sizeBytes ?? 0,
        recordingFiles: recordingAgg._count._all ?? 0,
        documentBytes: documentAgg._sum.sizeBytes ?? 0,
        documentFiles: documentAgg._count._all ?? 0,
        activeHoldsCount,
        expiringSoonCount,
      },
      retentionPolicy: policy ? {
        recordingRetentionDays: policy.recordingRetentionDays,
        documentRetentionDays: policy.documentRetentionDays,
        autoDeleteExpired: policy.autoDeleteExpired,
        manualDeletionAllowed: policy.manualDeletionAllowed,
      } : {
        recordingRetentionDays: null,
        documentRetentionDays: null,
        autoDeleteExpired: false,
        manualDeletionAllowed: true,
      },
    };
  }

  async listFiles(user: Principal, query: ListStorageFilesQueryDto) {
    const where: Prisma.StorageObjectWhereInput = {
      organizationId: user.orgId,
      deletedAt: null,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.status ? { uploadStatus: query.status } : {}),
      ...(query.search ? { fileName: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
    };

    if (query.hasHold !== undefined) {
      if (query.hasHold) {
        where.holds = { some: { releasedAt: null } };
      } else {
        where.holds = { none: { releasedAt: null } };
      }
    }

    if (query.expiringDays) {
      const now = new Date();
      where.expiresAt = {
        gt: now,
        lte: new Date(now.getTime() + query.expiringDays * 86400000),
      };
    }

    const take = Math.min(query.take ?? 50, 200);
    const skip = query.skip ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.storageObject.findMany({
        where,
        include: {
          holds: {
            where: { releasedAt: null },
            select: { id: true, reason: true, holdType: true, appliedAt: true, appliedBy: { select: { id: true, name: true } } },
          },
          document: { select: { id: true, title: true, projectId: true } },
          recording: { select: { id: true, meetingId: true, version: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.storageObject.count({ where }),
    ]);

    return {
      items: items.map(item => ({
        id: item.id,
        fileName: item.fileName,
        entityType: item.entityType,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        provider: item.provider,
        uploadStatus: item.uploadStatus,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        lastAccessedAt: item.lastAccessedAt,
        hasActiveHold: item.holds.length > 0,
        holds: item.holds,
        linkedDocument: item.document,
        linkedRecording: item.recording,
      })),
      total,
      take,
      skip,
    };
  }

  async uploadDocument(user: Principal, file: UploadFilePayload, projectId?: string) {
    if (user.role === 'VIEWER') throw new ForbiddenException('Viewers cannot upload documents.');

    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, organizationId: user.orgId, archivedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found in this workspace.');
    }

    const validated = FileValidator.validateDocument(file);
    const policy = await this.prisma.organizationRetentionPolicy.findUnique({
      where: { organizationId: user.orgId },
    });

    const expiresAt = policy?.documentRetentionDays
      ? new Date(Date.now() + policy.documentRetentionDays * 86400000)
      : null;

    const storageObjectId = randomUUID();
    const documentId = randomUUID();
    const storageKey = `${user.orgId}/documents/${storageObjectId}_${validated.fileName}`;

    const provider = this.providerFactory.getProvider();
    await provider.upload(storageKey, validated.buffer, validated.mimeType, {
      organizationId: user.orgId,
      documentId,
      originalName: validated.fileName,
    });

    // Extract text for text-based formats
    let extractedText: string | null = null;
    if (['text/plain', 'text/markdown', 'application/json', 'text/csv'].includes(validated.mimeType)) {
      extractedText = validated.buffer.toString('utf8').slice(0, 50_000);
    }

    const { document, storageObject } = await this.prisma.$transaction(async tx => {
      const stObj = await tx.storageObject.create({
        data: {
          id: storageObjectId,
          organizationId: user.orgId,
          provider: provider.name,
          storageKey,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          sha256: validated.sha256,
          entityType: 'DOCUMENT',
          entityId: documentId,
          uploadStatus: 'READY',
          expiresAt,
        },
      });

      const doc = await tx.document.create({
        data: {
          id: documentId,
          organizationId: user.orgId,
          projectId: projectId ?? null,
          title: validated.fileName,
          mimeType: validated.mimeType,
          storageKey,
          storageObjectId,
          extractedText,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: user.orgId,
          actorType: 'USER',
          actorId: user.sub,
          action: 'document.uploaded',
          targetType: 'document',
          targetId: documentId,
          metadata: {
            fileName: validated.fileName,
            sizeBytes: validated.sizeBytes,
            mimeType: validated.mimeType,
            storageKey,
          },
        },
      });

      return { document: doc, storageObject: stObj };
    });

    return {
      document,
      storageObject: {
        id: storageObject.id,
        fileName: storageObject.fileName,
        mimeType: storageObject.mimeType,
        sizeBytes: storageObject.sizeBytes,
        sha256: storageObject.sha256,
        entityType: storageObject.entityType,
        provider: storageObject.provider,
        expiresAt: storageObject.expiresAt,
      },
    };
  }

  async getDownloadUrl(user: Principal, storageObjectId: string, expiresInSeconds = 900) {
    const file = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, organizationId: user.orgId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('Storage file not found.');

    const meta = file.metadata as Record<string, any> | null;
    if (meta?.deletion?.status === 'PENDING_RETRY' || meta?.deletion?.status === 'FAILED_PERMANENT') {
      throw new NotFoundException('Storage file is pending deletion and unavailable.');
    }

    const provider = this.providerFactory.getProvider(file.provider);
    const url = await provider.generatePresignedDownloadUrl(file.storageKey, expiresInSeconds, file.fileName);

    await this.prisma.storageObject.update({
      where: { id: file.id },
      data: { lastAccessedAt: new Date() },
    }).catch(() => undefined);

    return {
      url,
      expiresInSeconds,
      provider: file.provider,
      fileName: file.fileName,
      mimeType: file.mimeType,
    };
  }

  async getFileStream(user: Principal, storageObjectId: string) {
    const file = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, organizationId: user.orgId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('Storage file not found.');

    const meta = file.metadata as Record<string, any> | null;
    if (meta?.deletion?.status === 'PENDING_RETRY' || meta?.deletion?.status === 'FAILED_PERMANENT') {
      throw new NotFoundException('Storage file is pending deletion and unavailable.');
    }

    const provider = this.providerFactory.getProvider(file.provider);
    const stream = await provider.stream(file.storageKey);

    await this.prisma.storageObject.update({
      where: { id: file.id },
      data: { lastAccessedAt: new Date() },
    }).catch(() => undefined);

    return {
      stream,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  async deleteFile(user: Principal, storageObjectId: string) {
    this.assertManager(user);

    const file = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, organizationId: user.orgId, deletedAt: null },
      include: {
        holds: { where: { releasedAt: null } },
      },
    });
    if (!file) throw new NotFoundException('Storage file not found.');

    // Check legal/operational holds
    if (file.holds.length > 0) {
      throw new BadRequestException('Cannot delete a file that is currently under an active legal or operational hold.');
    }

    // Check policy manual deletion allowance
    const policy = await this.prisma.organizationRetentionPolicy.findUnique({
      where: { organizationId: user.orgId },
    });
    if (policy && policy.manualDeletionAllowed === false && user.role !== 'OWNER') {
      throw new ForbiddenException('Manual file deletion is disabled by the organization retention policy.');
    }

    const provider = this.providerFactory.getProvider(file.provider);
    const now = new Date();
    const existingMeta = (file.metadata as Record<string, any>) || {};

    try {
      await provider.delete(file.storageKey);

      // Physical deletion succeeded (or already missing) -> mark database record deleted
      await this.prisma.$transaction(async tx => {
        await tx.storageObject.update({
          where: { id: file.id },
          data: {
            deletedAt: now,
            metadata: {
              ...existingMeta,
              deletion: {
                status: 'COMPLETED',
                completedAt: now.toISOString(),
              },
            },
          },
        });

        if (file.entityType === 'DOCUMENT' && file.entityId) {
          await tx.document.deleteMany({ where: { id: file.entityId, organizationId: user.orgId } });
        }

        await tx.auditEvent.create({
          data: {
            organizationId: user.orgId,
            actorType: 'USER',
            actorId: user.sub,
            action: 'storage.file.deleted',
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

      return { deleted: true, fileId: file.id };
    } catch (err: any) {
      // Physical deletion failed -> DO NOT MARK AS DELETED! Enter retryable state
      const attempts = 1;
      const backoffSec = 10;
      const nextRetryAt = new Date(Date.now() + backoffSec * 1000);

      await this.prisma.storageObject.update({
        where: { id: file.id },
        data: {
          metadata: {
            ...existingMeta,
            deletion: {
              status: 'PENDING_RETRY',
              attempts,
              maxAttempts: 5,
              lastAttemptAt: now.toISOString(),
              nextRetryAt: nextRetryAt.toISOString(),
              lastError: err?.message || 'Storage provider deletion failure',
              requestedBy: user.sub,
            },
          },
        },
      });

      await this.prisma.auditEvent.create({
        data: {
          organizationId: user.orgId,
          actorType: 'USER',
          actorId: user.sub,
          action: 'storage.file.deletion_failed',
          targetType: 'storage_object',
          targetId: file.id,
          metadata: {
            fileName: file.fileName,
            provider: file.provider,
            storageKey: file.storageKey,
            error: err?.message || 'Storage provider deletion failure',
            attempt: attempts,
            status: 'PENDING_RETRY',
          },
        },
      });

      throw new BadGatewayException(
        `Failed to physically delete object from storage provider: ${err?.message || 'Provider error'}. Deletion has been scheduled for background retry.`
      );
    }
  }

  async applyHold(user: Principal, storageObjectId: string, dto: CreateRetentionHoldDto) {
    this.assertManager(user);

    const file = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, organizationId: user.orgId, deletedAt: null },
    });
    if (!file) throw new NotFoundException('Storage file not found.');

    const hold = await this.prisma.fileRetentionHold.create({
      data: {
        organizationId: user.orgId,
        storageObjectId: file.id,
        reason: dto.reason.trim(),
        holdType: dto.holdType ?? 'LEGAL',
        appliedById: user.sub,
      },
      include: {
        appliedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        organizationId: user.orgId,
        actorType: 'USER',
        actorId: user.sub,
        action: 'storage.hold.applied',
        targetType: 'file_retention_hold',
        targetId: hold.id,
        metadata: {
          storageObjectId: file.id,
          fileName: file.fileName,
          holdType: hold.holdType,
          reason: hold.reason,
        },
      },
    });

    return hold;
  }

  async releaseHold(user: Principal, holdId: string, dto: ReleaseRetentionHoldDto) {
    this.assertManager(user);

    const hold = await this.prisma.fileRetentionHold.findFirst({
      where: { id: holdId, organizationId: user.orgId },
    });
    if (!hold) throw new NotFoundException('Retention hold not found.');
    if (hold.releasedAt) throw new BadRequestException('This hold has already been released.');

    const released = await this.prisma.fileRetentionHold.update({
      where: { id: hold.id },
      data: {
        releasedById: user.sub,
        releasedAt: new Date(),
        releaseReason: dto.releaseReason ? dto.releaseReason.trim() : null,
      },
      include: {
        releasedBy: { select: { id: true, name: true } },
        appliedBy: { select: { id: true, name: true } },
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        organizationId: user.orgId,
        actorType: 'USER',
        actorId: user.sub,
        action: 'storage.hold.released',
        targetType: 'file_retention_hold',
        targetId: released.id,
        metadata: {
          storageObjectId: hold.storageObjectId,
          releaseReason: released.releaseReason,
        },
      },
    });

    return released;
  }

  async getRetentionPolicy(user: Principal) {
    const policy = await this.prisma.organizationRetentionPolicy.findUnique({
      where: { organizationId: user.orgId },
    });

    return policy || {
      recordingRetentionDays: null,
      documentRetentionDays: null,
      autoDeleteExpired: false,
      manualDeletionAllowed: true,
    };
  }

  async updateRetentionPolicy(user: Principal, dto: UpdateRetentionPolicyDto) {
    this.assertAdmin(user);

    const policy = await this.prisma.organizationRetentionPolicy.upsert({
      where: { organizationId: user.orgId },
      create: {
        organizationId: user.orgId,
        recordingRetentionDays: dto.recordingRetentionDays,
        documentRetentionDays: dto.documentRetentionDays,
        autoDeleteExpired: dto.autoDeleteExpired ?? false,
        manualDeletionAllowed: dto.manualDeletionAllowed ?? true,
      },
      update: {
        recordingRetentionDays: dto.recordingRetentionDays !== undefined ? dto.recordingRetentionDays : undefined,
        documentRetentionDays: dto.documentRetentionDays !== undefined ? dto.documentRetentionDays : undefined,
        autoDeleteExpired: dto.autoDeleteExpired !== undefined ? dto.autoDeleteExpired : undefined,
        manualDeletionAllowed: dto.manualDeletionAllowed !== undefined ? dto.manualDeletionAllowed : undefined,
      },
    });

    // Update expiration on active files if days modified
    if (dto.documentRetentionDays !== undefined) {
      if (dto.documentRetentionDays === null) {
        await this.prisma.storageObject.updateMany({
          where: { organizationId: user.orgId, entityType: 'DOCUMENT', deletedAt: null },
          data: { expiresAt: null },
        });
      } else {
        const docs = await this.prisma.storageObject.findMany({
          where: { organizationId: user.orgId, entityType: 'DOCUMENT', deletedAt: null },
          select: { id: true, createdAt: true },
        });
        for (const doc of docs) {
          const expiresAt = new Date(doc.createdAt.getTime() + dto.documentRetentionDays * 86400000);
          await this.prisma.storageObject.update({ where: { id: doc.id }, data: { expiresAt } });
        }
      }
    }

    if (dto.recordingRetentionDays !== undefined) {
      if (dto.recordingRetentionDays === null) {
        await this.prisma.storageObject.updateMany({
          where: { organizationId: user.orgId, entityType: 'MEETING_RECORDING', deletedAt: null },
          data: { expiresAt: null },
        });
      } else {
        const recs = await this.prisma.storageObject.findMany({
          where: { organizationId: user.orgId, entityType: 'MEETING_RECORDING', deletedAt: null },
          select: { id: true, createdAt: true },
        });
        for (const rec of recs) {
          const expiresAt = new Date(rec.createdAt.getTime() + dto.recordingRetentionDays * 86400000);
          await this.prisma.storageObject.update({ where: { id: rec.id }, data: { expiresAt } });
        }
      }
    }

    await this.prisma.auditEvent.create({
      data: {
        organizationId: user.orgId,
        actorType: 'USER',
        actorId: user.sub,
        action: 'storage.retention_policy.updated',
        targetType: 'organization_retention_policy',
        targetId: policy.id,
        metadata: {
          recordingRetentionDays: policy.recordingRetentionDays,
          documentRetentionDays: policy.documentRetentionDays,
          autoDeleteExpired: policy.autoDeleteExpired,
          manualDeletionAllowed: policy.manualDeletionAllowed,
        },
      },
    });

    return policy;
  }

  async dryRunRetention(user: Principal) {
    return this.retentionService.dryRun(user.orgId);
  }

  async triggerRetentionSweep(user: Principal) {
    this.assertAdmin(user);
    const result = await this.retentionService.enqueueSweep(user.orgId, true);
    return {
      queued: result.queued,
      organizationId: user.orgId,
      message: result.message,
      sweptCount: result.sweptCount,
    };
  }
}
