import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  OrganizationRole,
  Priority,
  TaskStatus,
  WorkflowActionType,
  WorkflowRunStatus,
  WorkflowTriggerType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TasksService } from '../tasks/tasks.service';
import { Principal } from '../common/auth.types';
import {
  AutomationEventContext,
  AutomationTaskContext,
  WorkflowAutomationEngine,
} from './workflow-automation.engine';
import {
  ApproveWorkflowRunDto,
  CreateWorkflowRuleDto,
  RejectWorkflowRunDto,
  SimulateWorkflowEventDto,
  UpdateWorkflowRuleDto,
} from './workflow-automation.dto';

@Injectable()
export class WorkflowAutomationService {
  private readonly logger = new Logger(WorkflowAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    @Inject(forwardRef(() => TasksService))
    private tasks: TasksService,
  ) {}

  private assertCanManage(user: Principal) {
    if (
      user.role !== OrganizationRole.OWNER &&
      user.role !== OrganizationRole.ADMIN &&
      user.role !== OrganizationRole.PROJECT_MANAGER
    ) {
      throw new ForbiddenException(
        'Only project managers, admins, and workspace owners can manage automations and approve runs',
      );
    }
  }

  // ==========================================
  // SCAN OVERDUE TASKS & MILESTONES
  // ==========================================
  async scanOverdueTasks(organizationId: string) {
    const now = new Date();
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        organizationId,
        dueDate: { lt: now },
        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
      },
      include: {
        project: { select: { id: true, name: true, ownerId: true } },
        assignee: { select: { id: true, name: true } },
      },
    });

    const allRuns: any[] = [];
    for (const t of overdueTasks) {
      const runs = await this.evaluateEvent(organizationId, {
        trigger: WorkflowTriggerType.TASK_OVERDUE,
        organizationId,
        projectId: t.projectId,
        projectName: t.project.name,
        projectOwnerId: t.project.ownerId,
        task: {
          id: t.id,
          projectId: t.projectId,
          projectName: t.project.name,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          assigneeId: t.assigneeId,
          assigneeName: t.assignee?.name,
          labels: t.labels,
        },
        now,
      });
      allRuns.push(...runs);
    }
    return allRuns;
  }

  async scanApproachingMilestones(organizationId: string, daysAhead = 7) {
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const milestones = await this.prisma.milestone.findMany({
      where: {
        organizationId,
        targetDate: { gte: now, lte: horizon },
        completedAt: null,
      },
      include: {
        project: { select: { id: true, name: true, ownerId: true } },
      },
    });

    const allRuns: any[] = [];
    for (const m of milestones) {
      const runs = await this.evaluateEvent(organizationId, {
        trigger: WorkflowTriggerType.MILESTONE_APPROACHING,
        organizationId,
        projectId: m.projectId,
        projectName: m.project.name,
        projectOwnerId: m.project.ownerId,
        milestone: {
          id: m.id,
          projectId: m.projectId,
          projectName: m.project.name,
          title: m.title,
          targetDate: m.targetDate,
        },
        now,
      });
      allRuns.push(...runs);
    }
    return allRuns;
  }

  // ==========================================
  // DASHBOARD STATS
  // ==========================================
  async getDashboardStats(user: Principal) {
    const orgId = user.orgId;
    const [totalRules, activeRules, pendingApprovals, executedActions, failedExecutions, recentRuns] =
      await Promise.all([
        this.prisma.workflowAutomationRule.count({ where: { organizationId: orgId } }),
        this.prisma.workflowAutomationRule.count({
          where: { organizationId: orgId, isEnabled: true },
        }),
        this.prisma.workflowAutomationRun.count({
          where: { organizationId: orgId, status: WorkflowRunStatus.PENDING_APPROVAL },
        }),
        this.prisma.workflowAutomationRun.count({
          where: { organizationId: orgId, status: WorkflowRunStatus.EXECUTED },
        }),
        this.prisma.workflowAutomationRun.count({
          where: { organizationId: orgId, status: WorkflowRunStatus.FAILED },
        }),
        this.prisma.workflowAutomationRun.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            rule: { select: { id: true, name: true, triggerEvent: true, action: true } },
            project: { select: { id: true, name: true } },
            task: { select: { id: true, title: true, status: true, priority: true } },
            reviewedBy: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);

    return {
      totalRules,
      activeRules,
      pendingApprovals,
      executedActions,
      failedExecutions,
      recentRuns,
    };
  }

  // ==========================================
  // RULE MANAGEMENT
  // ==========================================
  async listRules(user: Principal) {
    return this.prisma.workflowAutomationRule.findMany({
      where: { organizationId: user.orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { runs: true } },
      },
    });
  }

  async getRule(user: Principal, id: string) {
    const rule = await this.prisma.workflowAutomationRule.findFirst({
      where: { id, organizationId: user.orgId },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!rule) throw new NotFoundException('Workflow automation rule not found');
    return rule;
  }

  async createRule(user: Principal, dto: CreateWorkflowRuleDto) {
    this.assertCanManage(user);

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: user.orgId },
      });
      if (!project) throw new NotFoundException('Specified project was not found in this workspace');
    }

    const rule = await this.prisma.workflowAutomationRule.create({
      data: {
        organizationId: user.orgId,
        projectId: dto.projectId || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        triggerEvent: dto.triggerEvent,
        action: dto.action,
        conditions: dto.conditions || {},
        actionConfig: dto.actionConfig || {},
        requiresApproval: dto.requiresApproval !== undefined ? dto.requiresApproval : true,
        isEnabled: dto.isEnabled !== undefined ? dto.isEnabled : true,
        createdById: user.sub,
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'automation.rule.created',
      targetType: 'automation_rule',
      targetId: rule.id,
      metadata: { name: rule.name, trigger: rule.triggerEvent, action: rule.action },
    });

    this.realtime.broadcast(user.orgId, 'automation.rule_created', { ruleId: rule.id });
    return rule;
  }

  async updateRule(user: Principal, id: string, dto: UpdateWorkflowRuleDto) {
    this.assertCanManage(user);

    const existing = await this.prisma.workflowAutomationRule.findFirst({
      where: { id, organizationId: user.orgId },
    });
    if (!existing) throw new NotFoundException('Workflow automation rule not found');

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: user.orgId },
      });
      if (!project) throw new NotFoundException('Specified project was not found in this workspace');
    }

    const updated = await this.prisma.workflowAutomationRule.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        description: dto.description !== undefined ? dto.description.trim() : undefined,
        triggerEvent: dto.triggerEvent,
        action: dto.action,
        projectId: dto.projectId !== undefined ? dto.projectId : undefined,
        conditions: dto.conditions !== undefined ? dto.conditions : undefined,
        actionConfig: dto.actionConfig !== undefined ? dto.actionConfig : undefined,
        requiresApproval: dto.requiresApproval !== undefined ? dto.requiresApproval : undefined,
        isEnabled: dto.isEnabled !== undefined ? dto.isEnabled : undefined,
        updatedById: user.sub,
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'automation.rule.updated',
      targetType: 'automation_rule',
      targetId: updated.id,
      metadata: { changed: Object.keys(dto) },
    });

    this.realtime.broadcast(user.orgId, 'automation.rule_updated', { ruleId: updated.id });
    return updated;
  }

  async deleteRule(user: Principal, id: string) {
    this.assertCanManage(user);

    const existing = await this.prisma.workflowAutomationRule.findFirst({
      where: { id, organizationId: user.orgId },
    });
    if (!existing) throw new NotFoundException('Workflow automation rule not found');

    await this.prisma.workflowAutomationRule.delete({ where: { id } });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'automation.rule.deleted',
      targetType: 'automation_rule',
      targetId: id,
      metadata: { name: existing.name },
    });

    this.realtime.broadcast(user.orgId, 'automation.rule_deleted', { ruleId: id });
    return { deleted: true };
  }

  // ==========================================
  // RUNS / APPROVAL CENTRE
  // ==========================================
  async listRuns(user: Principal, status?: WorkflowRunStatus) {
    return this.prisma.workflowAutomationRun.findMany({
      where: {
        organizationId: user.orgId,
        status: status || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        rule: { select: { id: true, name: true, triggerEvent: true, action: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, status: true, priority: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async getRun(user: Principal, id: string) {
    const run = await this.prisma.workflowAutomationRun.findFirst({
      where: { id, organizationId: user.orgId },
      include: {
        rule: true,
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, status: true, priority: true, dueDate: true, assigneeId: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!run) throw new NotFoundException('Workflow automation run not found');
    return run;
  }

  // ==========================================
  // EVENT EVALUATION (Trigger detection & action generation)
  // ==========================================
  async evaluateEvent(organizationId: string, event: AutomationEventContext) {
    // 1. Find all active rules matching this trigger
    const rules = await this.prisma.workflowAutomationRule.findMany({
      where: {
        organizationId,
        isEnabled: true,
        triggerEvent: event.trigger,
      },
    });

    if (rules.length === 0) return [];

    const now = event.now || new Date();
    const createdRuns: any[] = [];

    // Ensure roster & workspaceTasks are populated if needed
    let roster = event.roster;
    let workspaceTasks = event.workspaceTasks;
    if (!roster || !workspaceTasks) {
      const [memberships, dbTasks] = await Promise.all([
        this.prisma.membership.findMany({
          where: { organizationId },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        this.prisma.task.findMany({
          where: { organizationId },
          select: { id: true, assigneeId: true, status: true, priority: true },
        }),
      ]);
      roster = memberships.map(m => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      }));
      workspaceTasks = dbTasks;
      event.roster = roster;
      event.workspaceTasks = workspaceTasks;
    }

    for (const rule of rules) {
      // Check project filter
      if (rule.projectId && rule.projectId !== event.projectId && rule.projectId !== event.task?.projectId) {
        continue;
      }

      // Check condition filters
      const matches = WorkflowAutomationEngine.checkConditions(rule.conditions as any, event, now);
      if (!matches) continue;

      // Idempotency / deduplication check
      const entityId = event.task?.id || event.milestone?.id || event.projectId || 'org';
      const dedupeKey = WorkflowAutomationEngine.buildDedupeKey(rule.id, event.trigger, entityId, now);

      const existingRun = await this.prisma.workflowAutomationRun.findFirst({
        where: { organizationId, dedupeKey },
      });
      if (existingRun) {
        this.logger.debug(`Skipping duplicate automation run for dedupeKey: ${dedupeKey}`);
        continue;
      }

      // Generate action proposal
      const proposal = WorkflowAutomationEngine.generateActionProposal(
        rule.action,
        event,
        (rule.actionConfig as any) || {},
        rule.requiresApproval,
      );

      // Create Run record
      const run = await this.prisma.workflowAutomationRun.create({
        data: {
          organizationId,
          ruleId: rule.id,
          projectId: event.projectId || event.task?.projectId || null,
          taskId: event.task?.id || null,
          milestoneId: event.milestone?.id || null,
          triggerEvent: event.trigger,
          action: rule.action,
          status: rule.requiresApproval ? WorkflowRunStatus.PENDING_APPROVAL : WorkflowRunStatus.EXECUTED,
          dedupeKey,
          explanation: proposal.explanation,
          proposedAction: proposal as any,
          executedAt: rule.requiresApproval ? null : now,
        },
        include: {
          rule: { select: { id: true, name: true, triggerEvent: true, action: true } },
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true, status: true, priority: true } },
        },
      });

      // Update rule last execution
      await this.prisma.workflowAutomationRule.update({
        where: { id: rule.id },
        data: {
          lastExecutedAt: now,
          lastExecutionStatus: rule.requiresApproval
            ? WorkflowRunStatus.PENDING_APPROVAL
            : WorkflowRunStatus.EXECUTED,
        },
      });

      if (rule.requiresApproval) {
        // Dispatch alert to PM or Workspace Owner
        const recipient = event.projectOwnerId || rule.createdById;
        if (recipient) {
          await this.notifications.notifyUsers(
            organizationId,
            [recipient],
            NotificationType.WORKFLOW_APPROVAL,
            'Automation Action Awaiting Review',
            `${proposal.title} — ${rule.name}`,
            `auto_run:${run.id}`,
            {
              category: NotificationCategory.AI,
              priority: NotificationPriority.HIGH,
              actionUrl: `/automations`,
              metadata: { runId: run.id, ruleId: rule.id },
            },
          );
        }
        this.realtime.broadcast(organizationId, 'automation.run_created', { runId: run.id });
      } else {
        // Automatically execute non-approval actions
        await this.executeAction(organizationId, run);
      }

      createdRuns.push(run);
    }

    return createdRuns;
  }

  // ==========================================
  // APPROVE & EXECUTE
  // ==========================================
  async approveRun(user: Principal, id: string, dto?: ApproveWorkflowRunDto) {
    this.assertCanManage(user);

    const run = await this.prisma.workflowAutomationRun.findFirst({
      where: { id, organizationId: user.orgId },
      include: {
        rule: true,
        task: true,
        project: true,
      },
    });

    if (!run) throw new NotFoundException('Workflow automation run not found');
    if (run.status !== WorkflowRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`This run is already ${run.status}`);
    }

    // Revalidation check before execution: Ensure target task/project still exists
    const targetTaskId = run.taskId || (run.proposedAction as any)?.payload?.taskId;
    if (targetTaskId) {
      const taskExists = await this.prisma.task.findFirst({
        where: { id: targetTaskId, organizationId: user.orgId },
      });
      if (!taskExists) {
        await this.prisma.workflowAutomationRun.update({
          where: { id },
          data: {
            status: WorkflowRunStatus.FAILED,
            errorMessage: 'Target task was deleted before execution could take place.',
            reviewedById: user.sub,
            reviewedAt: new Date(),
          },
        });
        throw new BadRequestException('Target task no longer exists. Execution aborted.');
      }
    }

    try {
      const executionResult = await this.executeAction(user.orgId, run, user);
      const now = new Date();

      const updatedRun = await this.prisma.workflowAutomationRun.update({
        where: { id },
        data: {
          status: WorkflowRunStatus.EXECUTED,
          reviewedById: user.sub,
          reviewedAt: now,
          executedAt: now,
          executionResult: executionResult as any,
          errorMessage: null,
        },
        include: {
          rule: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true, status: true, priority: true } },
          reviewedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await this.prisma.workflowAutomationRule.update({
        where: { id: run.ruleId },
        data: {
          lastExecutedAt: now,
          lastExecutionStatus: WorkflowRunStatus.EXECUTED,
        },
      });

      await this.audit.append({
        organizationId: user.orgId,
        actorType: 'USER',
        actorId: user.sub,
        action: 'automation.run.approved',
        targetType: 'automation_run',
        targetId: id,
        metadata: {
          ruleName: run.rule.name,
          action: run.action,
          notes: dto?.notes,
        },
      });

      this.realtime.broadcast(user.orgId, 'automation.run_updated', {
        runId: id,
        status: WorkflowRunStatus.EXECUTED,
      });

      return updatedRun;
    } catch (err) {
      const errorMsg = (err as Error).message || 'Execution error';
      await this.prisma.workflowAutomationRun.update({
        where: { id },
        data: {
          status: WorkflowRunStatus.FAILED,
          errorMessage: errorMsg,
          reviewedById: user.sub,
          reviewedAt: new Date(),
        },
      });

      await this.prisma.workflowAutomationRule.update({
        where: { id: run.ruleId },
        data: {
          lastExecutionStatus: WorkflowRunStatus.FAILED,
        },
      });

      throw new BadRequestException(`Execution failed: ${errorMsg}`);
    }
  }

  // ==========================================
  // REJECT RUN
  // ==========================================
  async rejectRun(user: Principal, id: string, dto?: RejectWorkflowRunDto) {
    this.assertCanManage(user);

    const run = await this.prisma.workflowAutomationRun.findFirst({
      where: { id, organizationId: user.orgId },
      include: { rule: true },
    });

    if (!run) throw new NotFoundException('Workflow automation run not found');
    if (run.status !== WorkflowRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`This run is already ${run.status}`);
    }

    const now = new Date();
    const reason = dto?.reason?.trim() || 'Rejected by reviewer';

    const updatedRun = await this.prisma.workflowAutomationRun.update({
      where: { id },
      data: {
        status: WorkflowRunStatus.REJECTED,
        reviewedById: user.sub,
        reviewedAt: now,
        errorMessage: reason,
      },
      include: {
        rule: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, status: true, priority: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.workflowAutomationRule.update({
      where: { id: run.ruleId },
      data: {
        lastExecutedAt: now,
        lastExecutionStatus: WorkflowRunStatus.REJECTED,
      },
    });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'automation.run.rejected',
      targetType: 'automation_run',
      targetId: id,
      metadata: { ruleName: run.rule.name, reason },
    });

    this.realtime.broadcast(user.orgId, 'automation.run_updated', {
      runId: id,
      status: WorkflowRunStatus.REJECTED,
    });

    return updatedRun;
  }

  // ==========================================
  // RETRY RUN
  // ==========================================
  async retryRun(user: Principal, id: string) {
    this.assertCanManage(user);

    const run = await this.prisma.workflowAutomationRun.findFirst({
      where: { id, organizationId: user.orgId },
      include: { rule: true, task: true },
    });

    if (!run) throw new NotFoundException('Workflow automation run not found');
    if (run.status !== WorkflowRunStatus.FAILED) {
      throw new BadRequestException('Only failed automation runs can be retried');
    }

    return this.approveRun(user, id, { notes: 'Retried after previous failure' });
  }

  // ==========================================
  // SIMULATE / TEST TRIGGER
  // ==========================================
  async simulateTrigger(user: Principal, dto: SimulateWorkflowEventDto) {
    this.assertCanManage(user);

    let taskContext: AutomationTaskContext | undefined = undefined;
    let projectContext: { id: string; name: string } | undefined = undefined;
    let projectOwnerId = user.sub;

    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: dto.taskId, organizationId: user.orgId },
        include: { project: true, assignee: true },
      });
      if (task) {
        taskContext = {
          id: task.id,
          projectId: task.projectId,
          projectName: task.project?.name,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          assigneeId: task.assigneeId,
          assigneeName: task.assignee?.name,
          labels: task.labels,
        };
        projectContext = {
          id: task.project.id,
          name: task.project.name,
        };
        projectOwnerId = task.project.ownerId;
      }
    } else if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: user.orgId },
      });
      if (project) {
        projectContext = { id: project.id, name: project.name };
        projectOwnerId = project.ownerId;
      }
    }

    const event: AutomationEventContext = {
      trigger: dto.trigger,
      organizationId: user.orgId,
      projectId: projectContext?.id,
      projectName: projectContext?.name,
      projectOwnerId,
      task: taskContext,
      projectHealth: {
        score: 58,
        classification: 'AT_RISK',
        activeRisksCount: 2,
        activeRisks: ['Critical path bottleneck', 'Upcoming milestone risk'],
      },
    };

    const runs = await this.evaluateEvent(user.orgId, event);
    return {
      message: `Simulated trigger ${dto.trigger}`,
      matchedRunsCount: runs.length,
      runs,
    };
  }

  // ==========================================
  // INTERNAL ACTION EXECUTION
  // ==========================================
  private async executeAction(
    organizationId: string,
    run: any,
    reviewerUser?: Principal,
  ): Promise<Record<string, any>> {
    const proposed = (run.proposedAction as any) || {};
    const payload = proposed.payload || {};

    const systemUser: Principal = reviewerUser || {
      sub: run.reviewedById || run.rule?.createdById || '00000000-0000-0000-0000-000000000000',
      orgId: organizationId,
      role: OrganizationRole.PROJECT_MANAGER,
      email: 'automation@nexora.local',
      name: 'NEXORA Automation',
    };

    switch (run.action) {
      case WorkflowActionType.RECOMMEND_TASK_ASSIGNEE: {
        if (run.taskId && payload.assigneeId) {
          await this.tasks.update(systemUser, run.taskId, {
            assigneeId: payload.assigneeId,
          });
          return {
            assignedTo: payload.assigneeId,
            assigneeName: payload.assigneeName,
            status: 'APPLIED',
          };
        }
        return { notice: 'No candidate to assign' };
      }

      case WorkflowActionType.AI_TASK_RECOMMENDATION:
      case WorkflowActionType.CREATE_TASK_PROPOSAL: {
        if (run.taskId) {
          const updateData: any = {};
          if (payload.suggestedPriority || payload.targetPriority) {
            updateData.priority = payload.suggestedPriority || payload.targetPriority;
          }
          if (payload.statusChange || payload.targetStatus) {
            updateData.status = payload.statusChange || payload.targetStatus;
          }

          if (Object.keys(updateData).length > 0) {
            await this.tasks.update(systemUser, run.taskId, updateData);
          }

          // Also record a comment documenting the automated recommendation
          if (payload.recommendation) {
            await this.prisma.comment.create({
              data: {
                organizationId,
                taskId: run.taskId,
                authorId: systemUser.sub,
                body: `🤖 **AI Workflow Automation (${run.rule?.name || 'Recommendation'}):**\n${payload.recommendation}`,
              },
            });
          }

          return { updated: true, fields: updateData, recommendation: payload.recommendation };
        }
        return { notice: 'No task affected' };
      }

      case WorkflowActionType.NOTIFY_PROJECT_MANAGER: {
        const recipient = payload.recipientId || run.project?.ownerId;
        if (recipient) {
          await this.notifications.notifyUsers(
            organizationId,
            [recipient],
            NotificationType.WORKFLOW_EXECUTION,
            payload.title || 'Automation Alert',
            payload.body || 'Review required for project event',
            `notice:${run.id}:${Date.now()}`,
            {
              category: NotificationCategory.AI,
              priority: NotificationPriority.MEDIUM,
              actionUrl: `/automations`,
              metadata: { runId: run.id, ruleId: run.ruleId },
            },
          );
          return { notifiedUser: recipient, title: payload.title };
        }
        return { notice: 'No recipient identified' };
      }

      case WorkflowActionType.GENERATE_HEALTH_SUMMARY: {
        const projectId = run.projectId || payload.projectId;
        if (projectId) {
          const project = await this.prisma.project.findFirst({
            where: { id: projectId, organizationId },
          });
          if (project?.ownerId) {
            await this.notifications.notifyUsers(
              organizationId,
              [project.ownerId],
              NotificationType.PROJECT_HEALTH,
              payload.title || `Health Diagnostic: ${project.name}`,
              payload.summary || 'Health evaluation complete.',
              `health_summary:${run.id}`,
              {
                category: NotificationCategory.PROJECT,
                priority: NotificationPriority.MEDIUM,
                actionUrl: `/health?projectId=${projectId}`,
                metadata: { projectId, runId: run.id },
              },
            );
          }
          return { summaryGenerated: true, projectId };
        }
        return { notice: 'No project identified' };
      }

      default:
        return { status: 'COMPLETED_GENERIC' };
    }
  }
}
