import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('GitHub workflow automation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let otherToken: string;
  let orgId: string;
  let projectId: string;
  let foreignTaskId: string;
  let linkedRepoId: string;
  let webhookSecret: string;

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
      .send({ name: 'Automation Owner', email: `auto-owner-${stamp}@nexora.test`, password: 'SecurePass!2026', organizationName: `Auto Org ${stamp}` })
      .expect(201);
    ownerToken = registered.body.accessToken;
    orgId = registered.body.workspace.id;

    // 2. Setup project
    const projectRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Workflow Engine', description: 'GitHub workflow automation testing' })
      .expect(201);
    projectId = projectRes.body.id;

    // 3. Setup viewer in same workspace
    const invite = await request(app.getHttpServer())
      .post('/api/organizations/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: `auto-viewer-${stamp}@nexora.test`, role: 'VIEWER' })
      .expect(201);
    const viewerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Auto Viewer', email: `auto-viewer-${stamp}@nexora.test`, password: 'SecurePass!2026', inviteToken: invite.body.token })
      .expect(201);
    viewerToken = viewerRes.body.accessToken;

    // 4. Setup foreign workspace and task for cross-tenant testing
    const otherRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Foreign Owner', email: `auto-other-${stamp}@nexora.test`, password: 'SecurePass!2026', organizationName: `Foreign Org ${stamp}` })
      .expect(201);
    otherToken = otherRes.body.accessToken;
    const foreignProject = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Foreign Project' })
      .expect(201);
    const foreignTaskRes = await request(app.getHttpServer())
      .post(`/api/projects/${foreignProject.body.id}/tasks`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Isolated foreign task' })
      .expect(201);
    foreignTaskId = foreignTaskRes.body.id;

    // 5. Connect GitHub via mocked OAuth
    const githubFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gho_automation_test_token', token_type: 'bearer', scope: 'repo,admin:repo_hook' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/user')) {
        return new Response(JSON.stringify({ id: 554433, login: 'nexora-bot', name: 'Nexora Bot' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/user/repos')) {
        return new Response(JSON.stringify([{ id: 987654321, name: 'auto-repo', full_name: 'nexora-org/auto-repo', default_branch: 'main', private: true, owner: { login: 'nexora-org' } }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/repositories/987654321')) {
        return new Response(JSON.stringify({ id: 987654321, name: 'auto-repo', full_name: 'nexora-org/auto-repo', default_branch: 'main', private: true, owner: { login: 'nexora-org' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/applications/nexora-e2e-client/grant')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', githubFetch);

    const connectRes = await request(app.getHttpServer()).post('/api/integrations/github/connect').set('Authorization', `Bearer ${ownerToken}`).send({}).expect(201);
    const authUrl = new URL(connectRes.body.authorizationUrl);
    const oauthState = authUrl.searchParams.get('state');

    await request(app.getHttpServer()).get('/api/integrations/github/callback').query({ code: 'valid-oauth-code', state: oauthState }).expect(302);

    const linkedRepo = await request(app.getHttpServer())
      .post('/api/integrations/github/repositories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ repositoryId: '987654321', projectId })
      .expect(201);
    linkedRepoId = linkedRepo.body.id;

    const hookRes = await request(app.getHttpServer())
      .post(`/api/integrations/github/repositories/${linkedRepoId}/webhook`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    webhookSecret = hookRes.body.secret;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });

  it('enforces RBAC on rule management: viewers are rejected with 403', async () => {
    await request(app.getHttpServer())
      .post('/api/integrations/github/rules')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Unauthorized Rule',
        triggerEvent: 'PULL_REQUEST_MERGED',
        action: 'TRANSITION_TASK_STATUS',
        targetStatus: 'DONE',
        executionMode: 'AUTOMATIC',
      })
      .expect(403);
  });

  it('creates, lists, and configures workspace automation rules', async () => {
    // 1. Automatic rule for merged PRs
    const mergeRule = await request(app.getHttpServer())
      .post('/api/integrations/github/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Auto-complete task on main PR merge',
        triggerEvent: 'PULL_REQUEST_MERGED',
        action: 'TRANSITION_TASK_STATUS',
        targetStatus: 'DONE',
        executionMode: 'AUTOMATIC',
        repositoryId: linkedRepoId,
        projectId,
        conditions: { branch: 'main' },
      })
      .expect(201);

    expect(mergeRule.body.name).toBe('Auto-complete task on main PR merge');
    expect(mergeRule.body.executionMode).toBe('AUTOMATIC');
    expect(mergeRule.body.isEnabled).toBe(true);

    // 2. Approval-required rule for opened PRs
    const reviewRule = await request(app.getHttpServer())
      .post('/api/integrations/github/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Move to In Review on PR opened',
        triggerEvent: 'PULL_REQUEST_OPENED',
        action: 'TRANSITION_TASK_STATUS',
        targetStatus: 'IN_REVIEW',
        executionMode: 'APPROVAL_REQUIRED',
        repositoryId: linkedRepoId,
      })
      .expect(201);

    expect(reviewRule.body.executionMode).toBe('APPROVAL_REQUIRED');

    // List rules
    const listRes = await request(app.getHttpServer())
      .get('/api/integrations/github/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects cross-tenant and invalid task references without modifying foreign state', async () => {
    // Payload with foreign task ID
    const crossTenantPayload = {
      action: 'closed',
      repository: { id: 987654321 },
      pull_request: {
        number: 101,
        title: 'Cross tenant attempt',
        body: `Trying to close foreign task NEXORA-TASK:${foreignTaskId}`,
        merged: true,
        head: { ref: 'main', sha: 'cross999' },
      },
    };
    const body = Buffer.from(JSON.stringify(crossTenantPayload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', sig)
      .send(crossTenantPayload)
      .expect(201);

    expect(res.body.linkedTaskId).toBeNull();
    // Foreign task remains unchanged
    const foreignTask = await prisma.task.findUniqueOrThrow({ where: { id: foreignTaskId } });
    expect(foreignTask.status).not.toBe('DONE');
  });

  it('skips rule execution when conditions (branch filter) do not match', async () => {
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Branch condition test task' })
      .expect(201);

    const mismatchPayload = {
      action: 'closed',
      repository: { id: 987654321 },
      pull_request: {
        number: 102,
        title: 'Feature branch PR',
        body: `NEXORA-TASK:${task.body.id}`,
        merged: true,
        head: { ref: 'feature/experimental', sha: 'exp123' },
      },
    };
    const body = Buffer.from(JSON.stringify(mismatchPayload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', sig)
      .send(mismatchPayload)
      .expect(201);

    expect(res.body.automations).toHaveLength(0);
    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id } });
    expect(unchanged.status).toBe('TODO');
  });

  it('automatically transitions task on matching merged PR and deduplicates replays', async () => {
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Auto-merge target task' })
      .expect(201);

    const deliveryId = randomUUID();
    const payload = {
      action: 'closed',
      repository: { id: 987654321 },
      pull_request: {
        number: 103,
        title: 'Production PR',
        body: `Fixes NEXORA-TASK:${task.body.id}`,
        merged: true,
        head: { ref: 'main', sha: 'prod123' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    // First delivery -> executed
    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', deliveryId)
      .set('x-hub-signature-256', sig)
      .send(payload)
      .expect(201);

    expect(res.body.automations).toHaveLength(1);
    expect(res.body.automations[0].status).toBe('EXECUTED');

    const updatedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id } });
    expect(updatedTask.status).toBe('DONE');
    expect(updatedTask.completedAt).not.toBeNull();

    // Replay delivery -> deduplicated
    const replayRes = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', deliveryId)
      .set('x-hub-signature-256', sig)
      .send(payload)
      .expect(201);

    expect(replayRes.body.duplicate).toBe(true);

    // Loop prevention: new delivery on already DONE task is skipped
    const repeatPayload = { ...payload, pull_request: { ...payload.pull_request, number: 104 } };
    const repeatBody = Buffer.from(JSON.stringify(repeatPayload));
    const repeatSig = `sha256=${createHmac('sha256', webhookSecret).update(repeatBody).digest('hex')}`;
    const loopRes = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', repeatSig)
      .send(repeatPayload)
      .expect(201);

    expect(loopRes.body.automations).toHaveLength(0);
  });

  it('human approval workflow: creates proposal, blocks viewer approval, executes on manager approval', async () => {
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Task requiring approval' })
      .expect(201);

    const payload = {
      action: 'opened',
      repository: { id: 987654321 },
      pull_request: {
        number: 105,
        title: 'Review proposal PR',
        body: `Linked: NEXORA-TASK:${task.body.id}`,
        head: { ref: 'feature/proposal', sha: 'prop123' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', sig)
      .send(payload)
      .expect(201);

    expect(res.body.automations).toHaveLength(1);
    expect(res.body.automations[0].status).toBe('PENDING_APPROVAL');

    // Task is not mutated yet
    const beforeApproval = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id } });
    expect(beforeApproval.status).toBe('TODO');

    const runId = res.body.automations[0].id;

    // Viewer cannot approve
    await request(app.getHttpServer())
      .post(`/api/integrations/github/runs/${runId}/approve`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    // Manager approves
    const approveRes = await request(app.getHttpServer())
      .post(`/api/integrations/github/runs/${runId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    expect(approveRes.body.approved).toBe(true);

    const afterApproval = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id } });
    expect(afterApproval.status).toBe('IN_REVIEW');

    // Cannot approve again
    await request(app.getHttpServer())
      .post(`/api/integrations/github/runs/${runId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('human approval workflow: records manager rejection without altering task status', async () => {
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Task to reject proposal' })
      .expect(201);

    const payload = {
      action: 'opened',
      repository: { id: 987654321 },
      pull_request: {
        number: 106,
        title: 'PR to be rejected',
        body: `NEXORA-TASK:${task.body.id}`,
        head: { ref: 'feature/reject', sha: 'rej123' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', sig)
      .send(payload)
      .expect(201);

    const runId = res.body.automations[0].id;

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/integrations/github/runs/${runId}/reject`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'PR description does not meet acceptance criteria' })
      .expect(201);

    expect(rejectRes.body.rejected).toBe(true);

    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id } });
    expect(unchanged.status).toBe('TODO');

    const run = await prisma.gitHubAutomationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('REJECTED');
  });

  it('disabled rules do not execute on subsequent webhook events', async () => {
    // Get existing approval rule
    const rules = await request(app.getHttpServer())
      .get('/api/integrations/github/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ruleToDisable = rules.body.find((r: any) => r.triggerEvent === 'PULL_REQUEST_OPENED');
    expect(ruleToDisable).toBeDefined();

    // Toggle off
    const toggleRes = await request(app.getHttpServer())
      .post(`/api/integrations/github/rules/${ruleToDisable.id}/toggle`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(toggleRes.body.isEnabled).toBe(false);

    // Deliver PR opened event
    const task = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Task while rule is disabled' })
      .expect(201);

    const payload = {
      action: 'opened',
      repository: { id: 987654321 },
      pull_request: {
        number: 107,
        title: 'PR while disabled',
        body: `NEXORA-TASK:${task.body.id}`,
        head: { ref: 'feature/disabled-test', sha: 'dis123' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;

    const res = await request(app.getHttpServer())
      .post('/api/integrations/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', sig)
      .send(payload)
      .expect(201);

    expect(res.body.automations).toHaveLength(0);
  });

  it('task activity returns linked events and runs, and audit logs verify compliance', async () => {
    const runs = await request(app.getHttpServer())
      .get('/api/integrations/github/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(runs.body.length).toBeGreaterThanOrEqual(1);

    // Check task activity endpoint for the first executed task
    const executedRun = runs.body.find((r: any) => r.status === 'EXECUTED');
    if (executedRun && executedRun.taskId) {
      const act = await request(app.getHttpServer())
        .get(`/api/integrations/github/tasks/${executedRun.taskId}/activity`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(act.body.taskId).toBe(executedRun.taskId);
      expect(act.body.runs.length).toBeGreaterThanOrEqual(1);
    }

    // Check audit events
    const auditLogs = await prisma.auditEvent.findMany({
      where: {
        organizationId: orgId,
        action: {
          in: [
            'github.automation_rule.created',
            'github.automation.proposed',
            'github.automation.approved',
            'github.automation.rejected',
          ],
        },
      },
    });

    const loggedActions = auditLogs.map(a => a.action);
    expect(loggedActions).toContain('github.automation_rule.created');
    expect(loggedActions).toContain('github.automation.proposed');
    expect(loggedActions).toContain('github.automation.approved');
    expect(loggedActions).toContain('github.automation.rejected');
  });
});
