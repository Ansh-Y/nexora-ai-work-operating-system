import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationRole, Priority, TaskStatus, WorkflowActionType, WorkflowRunStatus, WorkflowTriggerType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('AI Workflow Automation (Release 4.2.3 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectId: string;
  let taskId: string;
  let ruleId: string;

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

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // 1. Primary workspace owner
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Automation Manager',
        email: `auto-owner-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Automation Org ${stamp}`,
      })
      .expect(201);
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.workspace.id;

    // 2. Secondary workspace owner (tenant isolation)
    const foreignReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Lead',
        email: `foreign-auto-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignReg.body.accessToken;
    foreignOrgId = foreignReg.body.workspace.id;

    // 3. Viewer in primary org (RBAC testing)
    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash('Password!2026', 10);
    const viewerUser = await prisma.user.create({
      data: {
        name: 'Readonly Viewer',
        email: `viewer-${stamp}@nexora.test`,
        passwordHash: hashed,
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: viewerUser.id,
        role: OrganizationRole.VIEWER,
      },
    });
    const viewerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `viewer-${stamp}@nexora.test`, password: 'Password!2026' })
      .expect(201);
    viewerToken = viewerLoginRes.body.accessToken;

    // 4. Create sample project and task
    const projectRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Workflow Pipeline Alpha',
        description: 'Test project for workflow automations',
      })
      .expect(201);
    projectId = projectRes.body.id;

    const taskRes = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Fix Payment Gateway Deadlock',
        description: 'Critical database deadlock on transaction commit',
        priority: Priority.URGENT,
        status: TaskStatus.IN_PROGRESS,
      })
      .expect(201);
    taskId = taskRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Viewer cannot create automation rules (403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/automations/rules')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Unauthorized Rule',
        triggerEvent: WorkflowTriggerType.TASK_MARKED_BLOCKED,
        action: WorkflowActionType.AI_TASK_RECOMMENDATION,
      })
      .expect(403);
  });

  it('2. Manager creates an automation rule with conditions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/automations/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Auto-Mitigate Blocked Tasks',
        description: 'Generates AI recovery recommendations when urgent tasks are marked blocked',
        triggerEvent: WorkflowTriggerType.TASK_MARKED_BLOCKED,
        action: WorkflowActionType.AI_TASK_RECOMMENDATION,
        conditions: { priority: Priority.URGENT },
        requiresApproval: true,
        isEnabled: true,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Auto-Mitigate Blocked Tasks');
    expect(res.body.triggerEvent).toBe(WorkflowTriggerType.TASK_MARKED_BLOCKED);
    expect(res.body.action).toBe(WorkflowActionType.AI_TASK_RECOMMENDATION);
    ruleId = res.body.id;
  });

  it('3. Multi-tenant isolation: Foreign org cannot view primary rules', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ai/automations/rules')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(200);

    expect(res.body.find((r: any) => r.id === ruleId)).toBeUndefined();
  });

  it('4. Event Trigger & Condition Matching: Marking task BLOCKED creates a pending run', async () => {
    // Update task to BLOCKED
    await request(app.getHttpServer())
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: TaskStatus.BLOCKED })
      .expect(200);

    // Give asynchronous trigger evaluation a brief tick to persist run
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify run was created in PENDING_APPROVAL
    const runsRes = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ status: WorkflowRunStatus.PENDING_APPROVAL })
      .expect(200);

    expect(runsRes.body.length).toBeGreaterThan(0);
    const targetRun = runsRes.body.find((r: any) => r.ruleId === ruleId);
    expect(targetRun).toBeDefined();
    expect(targetRun.status).toBe(WorkflowRunStatus.PENDING_APPROVAL);
    expect(targetRun.explanation).toContain('BLOCKED');
    expect(targetRun.proposedAction).toBeDefined();
  });

  it('5. Idempotency: Duplicate event does not create duplicate pending runs', async () => {
    const initialRuns = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const countBefore = initialRuns.body.length;

    // Simulate same trigger again on same task
    await request(app.getHttpServer())
      .post('/api/ai/automations/simulate-trigger')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        trigger: WorkflowTriggerType.TASK_MARKED_BLOCKED,
        taskId,
      })
      .expect(200);

    const afterRuns = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // Count should be unchanged because dedupeKey prevented duplication
    expect(afterRuns.body.length).toBe(countBefore);
  });

  it('6. Viewer cannot approve automation runs (403 Forbidden)', async () => {
    const runsRes = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const run = runsRes.body.find((r: any) => r.ruleId === ruleId);

    await request(app.getHttpServer())
      .post(`/api/ai/automations/runs/${run.id}/approve`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('7. Manager approves automation run -> action executes and audits', async () => {
    const runsRes = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const run = runsRes.body.find((r: any) => r.ruleId === ruleId);

    const approveRes = await request(app.getHttpServer())
      .post(`/api/ai/automations/runs/${run.id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ notes: 'Approved recovery recommendation' })
      .expect(200);

    expect(approveRes.body.status).toBe(WorkflowRunStatus.EXECUTED);
    expect(approveRes.body.executedAt).toBeDefined();
    expect(approveRes.body.reviewedBy).toBeDefined();

    // Verify audit log entry
    const auditRes = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const auditEntry = auditRes.body.find((a: any) => a.action === 'automation.run.approved');
    expect(auditEntry).toBeDefined();
    expect(auditEntry.targetId).toBe(run.id);
  });

  it('8. Rejection workflow: Rejecting a run transitions status to REJECTED', async () => {
    // Create rule for overdue notification
    const overdueRule = await request(app.getHttpServer())
      .post('/api/ai/automations/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Alert PM on Overdue Tasks',
        triggerEvent: WorkflowTriggerType.TASK_OVERDUE,
        action: WorkflowActionType.NOTIFY_PROJECT_MANAGER,
        requiresApproval: true,
      })
      .expect(201);

    // Create an overdue task
    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const overdueTask = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Overdue Sprint Cleanup',
        dueDate: pastDate,
        priority: Priority.HIGH,
      })
      .expect(201);

    // Trigger deadline sweep
    await request(app.getHttpServer())
      .post('/api/ai/automations/scan-deadlines')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const runsRes = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const overdueRun = runsRes.body.find(
      (r: any) => r.ruleId === overdueRule.body.id && r.status === WorkflowRunStatus.PENDING_APPROVAL,
    );
    expect(overdueRun).toBeDefined();

    // Reject the run
    const rejectRes = await request(app.getHttpServer())
      .post(`/api/ai/automations/runs/${overdueRun.id}/reject`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Team lead already acknowledged offline' })
      .expect(200);

    expect(rejectRes.body.status).toBe(WorkflowRunStatus.REJECTED);
    expect(rejectRes.body.errorMessage).toBe('Team lead already acknowledged offline');
  });

  it('9. Revalidation safety: Deleting task before approval aborts execution with clean failure', async () => {
    // Create new task and rule for task proposal
    const tempTask = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Ephemeral Task for Deletion Test' })
      .expect(201);

    const propRule = await request(app.getHttpServer())
      .post('/api/ai/automations/rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Propose Status Advance',
        triggerEvent: WorkflowTriggerType.TASK_CREATED,
        action: WorkflowActionType.CREATE_TASK_PROPOSAL,
        requiresApproval: true,
      })
      .expect(201);

    // Simulate trigger on this task
    await request(app.getHttpServer())
      .post('/api/ai/automations/simulate-trigger')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        trigger: WorkflowTriggerType.TASK_CREATED,
        taskId: tempTask.body.id,
      })
      .expect(200);

    const runs = await request(app.getHttpServer())
      .get('/api/ai/automations/runs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const targetRun = runs.body.find((r: any) => r.taskId === tempTask.body.id);
    expect(targetRun).toBeDefined();

    // Now delete the task
    await request(app.getHttpServer())
      .delete(`/api/tasks/${tempTask.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // Attempt to approve -> Revalidation catches that target task is gone
    const failRes = await request(app.getHttpServer())
      .post(`/api/ai/automations/runs/${targetRun.id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);

    expect(failRes.body.message).toContain('Target task no longer exists');

    // Run status is updated to FAILED
    const runAfter = await request(app.getHttpServer())
      .get(`/api/ai/automations/runs/${targetRun.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(runAfter.body.status).toBe(WorkflowRunStatus.FAILED);
  });

  it('10. Dashboard Stats endpoint returns consolidated metrics', async () => {
    const statsRes = await request(app.getHttpServer())
      .get('/api/ai/automations/stats')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(statsRes.body.totalRules).toBeGreaterThanOrEqual(2);
    expect(statsRes.body.activeRules).toBeGreaterThanOrEqual(2);
    expect(statsRes.body.executedActions).toBeGreaterThanOrEqual(1);
    expect(statsRes.body.recentRuns).toBeDefined();
    expect(Array.isArray(statsRes.body.recentRuns)).toBe(true);
  });
});
