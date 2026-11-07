import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('Project Health Scoring & Concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectAId: string;
  let projectBId: string;
  let foreignProjectId: string;

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

    // 1. Setup workspace owner
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Health Admin',
        email: `health-owner-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        organizationName: `Health Org ${stamp}`,
      })
      .expect(201);
    ownerToken = registered.body.accessToken;
    orgId = registered.body.workspace.id;

    // 2. Setup project A
    const projARes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Alpha Concurrency Project', description: 'Testing concurrent health recalculations' })
      .expect(201);
    projectAId = projARes.body.id;

    // Add tasks to Project A
    await request(app.getHttpServer())
      .post(`/api/projects/${projectAId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Task Alpha Done',
        priority: 'HIGH',
        status: 'DONE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/projects/${projectAId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Task Alpha Overdue',
        priority: 'URGENT',
        status: 'TODO',
        dueDate: new Date(Date.now() - 5 * 86400000).toISOString(),
      })
      .expect(201);

    // 3. Setup project B
    const projBRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Beta Concurrency Project', description: 'Testing multi-project concurrency' })
      .expect(201);
    projectBId = projBRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/projects/${projectBId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Task Beta Healthy',
        priority: 'MEDIUM',
        status: 'DONE',
      })
      .expect(201);

    // 4. Setup viewer in org
    const invite = await request(app.getHttpServer())
      .post('/api/organizations/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: `health-viewer-${stamp}@nexora.test`, role: 'VIEWER' })
      .expect(201);

    const viewerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Health Viewer',
        email: `health-viewer-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        inviteToken: invite.body.token,
      })
      .expect(201);
    viewerToken = viewerRes.body.accessToken;

    // 5. Setup foreign workspace owner
    const foreignReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Admin',
        email: `foreign-health-${stamp}@nexora.test`,
        password: 'SecurePass!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignReg.body.accessToken;
    foreignOrgId = foreignReg.body.workspace.id;

    const foreignProjRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({ name: 'Foreign Project', description: 'Cross tenant isolation test' })
      .expect(201);
    foreignProjectId = foreignProjRes.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serializes concurrent recalculations for the same project and avoids duplicate snapshots', async () => {
    // Verify no snapshots exist yet for Project A
    const initialCount = await prisma.projectHealthSnapshot.count({
      where: { organizationId: orgId, projectId: projectAId },
    });
    expect(initialCount).toBe(0);

    // Dispatch 5 concurrent recalculation requests simultaneously for Project A
    const recalculatePromises = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post(`/api/health/projects/${projectAId}/recalculate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ force: false }),
    );

    const responses = await Promise.all(recalculatePromises);

    // All 5 requests should succeed
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('score');
      expect(res.body).toHaveProperty('classification');
    }

    // Advisory lock serialization and debounce check MUST ensure exactly ONE snapshot was created
    const finalCount = await prisma.projectHealthSnapshot.count({
      where: { organizationId: orgId, projectId: projectAId },
    });
    expect(finalCount).toBe(1);
  });

  it('allows concurrent recalculations for different projects without contention', async () => {
    // Dispatch simultaneous recalculations for Project A and Project B
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/health/projects/${projectAId}/recalculate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ force: true }), // force snapshot update for A
      request(app.getHttpServer())
        .post(`/api/health/projects/${projectBId}/recalculate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ force: false }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    expect(resA.body.projectId).toBe(projectAId);
    expect(resB.body.projectId).toBe(projectBId);

    const countB = await prisma.projectHealthSnapshot.count({
      where: { organizationId: orgId, projectId: projectBId },
    });
    expect(countB).toBe(1);
  });

  it('strictly enforces tenant isolation across organizations', async () => {
    // Foreign user attempting to access Project A's health
    const getRes = await request(app.getHttpServer())
      .get(`/api/health/projects/${projectAId}`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`);
    expect(getRes.status).toBe(404);

    // Foreign user attempting to recalculate Project A's health
    const postRes = await request(app.getHttpServer())
      .post(`/api/health/projects/${projectAId}/recalculate`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({ force: true });
    expect(postRes.status).toBe(404);
  });

  it('enforces RBAC: forbids viewers from recalculating health or dismissing risks', async () => {
    // Viewer cannot recalculate
    const recalcRes = await request(app.getHttpServer())
      .post(`/api/health/projects/${projectAId}/recalculate`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ force: false });
    expect(recalcRes.status).toBe(403);

    // Get active risks on Project A
    const risksRes = await request(app.getHttpServer())
      .get(`/api/health/projects/${projectAId}/risks?status=ACTIVE`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const risks = risksRes.body.risks;
    expect(risks.length).toBeGreaterThan(0);
    const riskId = risks[0].id;

    // Viewer cannot dismiss risk
    const dismissRes = await request(app.getHttpServer())
      .post(`/api/health/projects/${projectAId}/risks/${riskId}/dismiss`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ reason: 'Attempt by viewer' });
    expect(dismissRes.status).toBe(403);

    // Owner can dismiss risk
    const ownerDismissRes = await request(app.getHttpServer())
      .post(`/api/health/projects/${projectAId}/risks/${riskId}/dismiss`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Reviewed and scheduled in next cycle' });
    expect(ownerDismissRes.status).toBe(201);
    expect(ownerDismissRes.body.status).toBe('DISMISSED');
  });
});
