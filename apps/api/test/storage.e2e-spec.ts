import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageRetentionService } from '../src/storage/storage-retention.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('Storage & retention management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retentionService: StorageRetentionService;
  let ownerToken: string;
  let viewerToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectId: string;
  let uploadedStorageId: string;
  let legalHoldId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SPEECH_TO_TEXT_PROVIDER).useValue(meetingTestSpeechProvider)
      .overrideProvider(MEETING_ANALYSIS_PROVIDER).useValue(meetingTestAnalysisProvider)
      .compile();

    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    retentionService = app.get(StorageRetentionService);

    // 1. Setup workspace owner
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Storage Admin',
        email: `storage-owner-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        organizationName: `Storage Org ${stamp}`,
      })
      .expect(201);
    ownerToken = registered.body.accessToken;
    orgId = registered.body.workspace.id;

    // 2. Setup project
    const projectRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Storage Project', description: 'Testing storage & retention' })
      .expect(201);
    projectId = projectRes.body.id;

    // 3. Setup viewer
    const invite = await request(app.getHttpServer())
      .post('/api/organizations/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: `storage-viewer-${stamp}@nexora.test`, role: 'VIEWER' })
      .expect(201);
    const viewerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Storage Viewer',
        email: `storage-viewer-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        inviteToken: invite.body.token,
      })
      .expect(201);
    viewerToken = viewerRes.body.accessToken;

    // 4. Setup foreign workspace owner
    const foreign = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Storage Owner',
        email: `storage-foreign-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreign.body.accessToken;
    foreignOrgId = foreign.body.workspace.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Storage overview and metrics', () => {
    it('returns storage summary and default retention policy', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/storage/summary')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.provider.name).toBe('local');
      expect(res.body.usage.totalFiles).toBe(0);
      expect(res.body.usage.totalBytes).toBe(0);
      expect(res.body.retentionPolicy).toBeDefined();
      expect(res.body.retentionPolicy.recordingRetentionDays).toBeNull();
      expect(res.body.retentionPolicy.documentRetentionDays).toBeNull();
      expect(res.body.retentionPolicy.manualDeletionAllowed).toBe(true);
    });
  });

  describe('Document upload & validation', () => {
    it('uploads a valid PDF document with SHA-256 and metadata', async () => {
      const pdfContent = Buffer.from('%PDF-1.4 sample document content for e2e testing %%EOF');

      const res = await request(app.getHttpServer())
        .post('/api/storage/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('projectId', projectId)
        .attach('file', pdfContent, 'architecture-specs.pdf')
        .expect(201);

      expect(res.body.storageObject).toBeDefined();
      uploadedStorageId = res.body.storageObject.id;
      expect(uploadedStorageId).toBeDefined();
      expect(res.body.storageObject.fileName).toBe('architecture-specs.pdf');
      expect(res.body.storageObject.mimeType).toBe('application/pdf');
      expect(res.body.storageObject.entityType).toBe('DOCUMENT');
      expect(res.body.storageObject.sizeBytes).toBe(pdfContent.length);
      expect(res.body.storageObject.sha256).toHaveLength(64);

      // Verify Document record was created
      const doc = await prisma.document.findFirst({
        where: { storageObjectId: uploadedStorageId },
      });
      expect(doc).toBeDefined();
      expect(doc?.organizationId).toBe(orgId);
    });

    it('rejects spoofed executables pretending to be documents', async () => {
      const fakeDoc = Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000binary payload');

      const res = await request(app.getHttpServer())
        .post('/api/storage/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', fakeDoc, 'report.pdf')
        .expect(400);

      expect(res.body.message).toContain('document type could not be verified');
    });
  });

  describe('File streaming and tenant isolation', () => {
    it('allows owner to download the uploaded document stream', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/storage/files/${uploadedStorageId}/download`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('architecture-specs.pdf');
      expect(res.body.toString()).toContain('%PDF-1.4 sample document content');
    });

    it('denies foreign organization from downloading or viewing the file', async () => {
      await request(app.getHttpServer())
        .get(`/api/storage/files/${uploadedStorageId}/download`)
        .set('Authorization', `Bearer ${foreignOwnerToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/storage/files/${uploadedStorageId}`)
        .set('Authorization', `Bearer ${foreignOwnerToken}`)
        .expect(404);
    });
  });

  describe('Signed temporary URLs and public access', () => {
    it('generates a signed download URL and verifies public download works without Bearer token', async () => {
      const urlRes = await request(app.getHttpServer())
        .get(`/api/storage/files/${uploadedStorageId}/download-url?expiresIn=300`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(urlRes.body.url).toBeDefined();
      expect(urlRes.body.expiresInSeconds).toBe(300);

      const parsedUrl = new URL(urlRes.body.url);
      const token = parsedUrl.searchParams.get('token');
      expect(token).toBeTruthy();

      // Download publicly via signed-download route
      const publicDownload = await request(app.getHttpServer())
        .get(`/api/storage/signed-download?token=${token}`)
        .expect(200);

      expect(publicDownload.headers['content-type']).toBe('application/pdf');
      expect(publicDownload.body.toString()).toContain('%PDF-1.4');
    });

    it('rejects tampered or malformed signed download tokens', async () => {
      await request(app.getHttpServer())
        .get('/api/storage/signed-download?token=tampered-token-value')
        .expect(404);
    });
  });

  describe('Retention policy administration', () => {
    it('prevents VIEWER from updating retention policy', async () => {
      await request(app.getHttpServer())
        .put('/api/storage/retention/policy')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          recordingRetentionDays: 30,
          documentRetentionDays: 60,
          autoDeleteExpired: true,
          manualDeletionAllowed: true,
        })
        .expect(403);
    });

    it('allows OWNER to update retention policy and logs audit event', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/storage/retention/policy')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          recordingRetentionDays: 90,
          documentRetentionDays: 180,
          autoDeleteExpired: true,
          manualDeletionAllowed: true,
        })
        .expect(200);

      expect(res.body.recordingRetentionDays).toBe(90);
      expect(res.body.documentRetentionDays).toBe(180);
      expect(res.body.autoDeleteExpired).toBe(true);

      // Verify audit event
      const audit = await prisma.auditEvent.findFirst({
        where: {
          organizationId: orgId,
          action: 'storage.retention_policy.updated',
        },
      });
      expect(audit).toBeDefined();
    });
  });

  describe('Legal & compliance holds enforcement', () => {
    it('prevents VIEWER from applying legal holds', async () => {
      await request(app.getHttpServer())
        .post(`/api/storage/files/${uploadedStorageId}/holds`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          holdType: 'LEGAL',
          reason: 'Unauthorized viewer attempt',
        })
        .expect(403);
    });

    it('allows OWNER to apply a LEGAL hold protecting the file', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/storage/files/${uploadedStorageId}/holds`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          holdType: 'LEGAL',
          reason: 'Active patent litigation hold',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.holdType).toBe('LEGAL');
      expect(res.body.reason).toBe('Active patent litigation hold');
      expect(res.body.releasedAt).toBeNull();
      legalHoldId = res.body.id;

      // Verify file now reports active hold
      const fileRes = await request(app.getHttpServer())
        .get('/api/storage/files')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const targetFile = fileRes.body.items.find((f: any) => f.id === uploadedStorageId);
      expect(targetFile).toBeDefined();
      expect(targetFile.hasActiveHold).toBe(true);
      expect(targetFile.holds).toHaveLength(1);
    });

    it('strictly prevents deletion of a held file', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/storage/files/${uploadedStorageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);

      expect(res.body.message).toContain('active legal or operational hold');

      // Verify file still exists in database
      const check = await prisma.storageObject.findUnique({
        where: { id: uploadedStorageId },
      });
      expect(check).not.toBeNull();
      expect(check?.deletedAt).toBeNull();
    });
  });

  describe('Retention dry run & background sweep', () => {
    let expiredFileId: string;

    beforeAll(async () => {
      // Create an expired unheld file directly for sweep testing
      const pdfBuffer = Buffer.from('%PDF-1.4 expired document content %%EOF');
      const createRes = await request(app.getHttpServer())
        .post('/api/storage/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', pdfBuffer, 'scratch.pdf')
        .expect(201);

      expiredFileId = createRes.body.storageObject.id;

      // Manually set expiresAt in past
      await prisma.storageObject.update({
        where: { id: expiredFileId },
        data: {
          expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
        },
      });
    });

    it('dry run previews expired files while preserving held files', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/storage/retention/dry-run')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.expiredCount).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.eligibleForDeletionCount).toBeGreaterThanOrEqual(1);

      const eligibleIds = res.body.eligibleFiles.map((f: any) => f.id);
      expect(eligibleIds).toContain(expiredFileId);
      // Held file must NOT be in eligibleFiles
      expect(eligibleIds).not.toContain(uploadedStorageId);
    });

    it('retention sweep deletes expired files and preserves held files', async () => {
      // Run sweep directly on retention service to ensure synchronous completion
      await retentionService.executeSweep(orgId, true);

      // Expired file is now marked as deleted
      const checkExpired = await prisma.storageObject.findUnique({
        where: { id: expiredFileId },
      });
      expect(checkExpired?.deletedAt).not.toBeNull();

      // Held file is preserved
      const checkHeld = await prisma.storageObject.findUnique({
        where: { id: uploadedStorageId },
      });
      expect(checkHeld?.deletedAt).toBeNull();
    });
  });

  describe('Hold release and manual deletion', () => {
    it('allows OWNER to release the legal hold with audit trail', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/storage/holds/${legalHoldId}/release`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ releaseReason: 'Litigation concluded with settlement' })
        .expect(200);

      expect(res.body.releasedAt).not.toBeNull();
      expect(res.body.releaseReason).toBe('Litigation concluded with settlement');

      // Verify audit event
      const audit = await prisma.auditEvent.findFirst({
        where: {
          organizationId: orgId,
          action: 'storage.hold.released',
        },
      });
      expect(audit).toBeDefined();
    });

    it('permits manual deletion after all holds are released', async () => {
      await request(app.getHttpServer())
        .delete(`/api/storage/files/${uploadedStorageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const check = await prisma.storageObject.findUnique({
        where: { id: uploadedStorageId },
      });
      expect(check?.deletedAt).not.toBeNull();
    });
  });
});
