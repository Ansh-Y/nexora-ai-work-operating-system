import { Priority, TaskStatus, WorkflowActionType, WorkflowTriggerType } from '@prisma/client';

export interface AutomationTaskContext {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate?: Date | string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  labels?: string[];
}

export interface AutomationMilestoneContext {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  targetDate?: Date | string | null;
}

export interface AutomationHealthContext {
  score: number;
  classification: 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';
  activeRisksCount?: number;
  activeRisks?: string[];
}

export interface AutomationTeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AutomationEventContext {
  trigger: WorkflowTriggerType;
  organizationId: string;
  projectId?: string;
  projectName?: string;
  projectOwnerId?: string;
  task?: AutomationTaskContext;
  previousTaskState?: {
    status?: TaskStatus;
    priority?: Priority;
    assigneeId?: string | null;
  };
  milestone?: AutomationMilestoneContext;
  projectHealth?: AutomationHealthContext;
  roster?: AutomationTeamMember[];
  workspaceTasks?: Array<{
    id: string;
    assigneeId?: string | null;
    status: TaskStatus;
    priority: Priority;
  }>;
  now?: Date;
}

export interface AutomationRuleConditions {
  projectId?: string;
  priority?: Priority;
  status?: TaskStatus;
  minDaysOverdue?: number;
  healthClassification?: 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';
}

export interface AutomationActionProposal {
  action: WorkflowActionType;
  title: string;
  explanation: string;
  expectedOutcome: string;
  targetEntity: {
    type: 'task' | 'project' | 'notification' | 'milestone';
    id?: string;
    name?: string;
  };
  payload: Record<string, any>;
  requiresApproval: boolean;
}

export class WorkflowAutomationEngine {
  /**
   * Deterministic condition matching against real event context.
   */
  static checkConditions(
    conditions: AutomationRuleConditions | null | undefined,
    context: AutomationEventContext,
    now: Date = context.now || new Date(),
  ): boolean {
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    // 1. Project condition
    if (conditions.projectId) {
      const targetProjId =
        context.projectId ||
        context.task?.projectId ||
        context.milestone?.projectId;
      if (targetProjId !== conditions.projectId) {
        return false;
      }
    }

    // 2. Task priority condition
    if (conditions.priority) {
      if (!context.task || context.task.priority !== conditions.priority) {
        return false;
      }
    }

    // 3. Task status condition
    if (conditions.status) {
      if (!context.task || context.task.status !== conditions.status) {
        return false;
      }
    }

    // 4. Days overdue condition (for TASK_OVERDUE or any task with dueDate)
    if (typeof conditions.minDaysOverdue === 'number' && conditions.minDaysOverdue > 0) {
      if (!context.task?.dueDate) {
        return false;
      }
      const due = new Date(context.task.dueDate).getTime();
      const current = now.getTime();
      const diffDays = Math.floor((current - due) / (1000 * 60 * 60 * 24));
      if (diffDays < conditions.minDaysOverdue) {
        return false;
      }
    }

    // 5. Project health classification condition
    if (conditions.healthClassification) {
      if (!context.projectHealth || context.projectHealth.classification !== conditions.healthClassification) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generates a transparent, grounded AI action proposal.
   */
  static generateActionProposal(
    action: WorkflowActionType,
    context: AutomationEventContext,
    actionConfig: Record<string, any> = {},
    requiresApproval = true,
  ): AutomationActionProposal {
    const task = context.task;
    const projectName = context.projectName || task?.projectName || 'Project';

    switch (action) {
      case WorkflowActionType.AI_TASK_RECOMMENDATION: {
        const isBlocked = task?.status === TaskStatus.BLOCKED || context.trigger === WorkflowTriggerType.TASK_MARKED_BLOCKED;
        const isOverdue = context.trigger === WorkflowTriggerType.TASK_OVERDUE;

        let explanation = `Task "${task?.title || 'Unknown'}" requires attention.`;
        let expectedOutcome = `Execute recommended recovery steps to unblock delivery.`;
        let recommendation = 'Review upstream dependencies and redistribute priority work items.';

        if (isBlocked) {
          explanation = `Task "${task?.title}" was flagged as BLOCKED. Downstream delivery is at risk unless dependency resolution or re-scoping occurs.`;
          expectedOutcome = `Notify team leads, split off unblocked prerequisites, and update task status once ready.`;
          recommendation = 'Investigate blocking dependency, conduct immediate sync with assignee, and escalate if needed.';
        } else if (isOverdue) {
          explanation = `Task "${task?.title}" has passed its scheduled deadline in ${projectName}. Overdue items degrade project velocity and health scores.`;
          expectedOutcome = `Adjust deadline or assign supporting resources to prevent cumulative delivery delay.`;
          recommendation = 'Perform priority reassessment, verify scope boundaries, and reset milestone target.';
        }

        return {
          action,
          title: `AI Task Recommendation: ${task?.title || projectName}`,
          explanation,
          expectedOutcome,
          targetEntity: {
            type: 'task',
            id: task?.id,
            name: task?.title,
          },
          payload: {
            taskId: task?.id,
            projectId: task?.projectId || context.projectId,
            recommendation,
            suggestedPriority: actionConfig.targetPriority || task?.priority || Priority.HIGH,
            statusChange: actionConfig.targetStatus || undefined,
          },
          requiresApproval,
        };
      }

      case WorkflowActionType.RECOMMEND_TASK_ASSIGNEE: {
        const roster = context.roster || [];
        const workspaceTasks = context.workspaceTasks || [];

        // Select candidate with the least active workload
        let chosenCandidate = roster[0];
        let minWorkload = Infinity;

        if (roster.length > 0) {
          for (const member of roster) {
            // Count open tasks assigned to this member
            const activeCount = workspaceTasks.filter(
              t => t.assigneeId === member.id && t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED,
            ).length;
            if (activeCount < minWorkload) {
              minWorkload = activeCount;
              chosenCandidate = member;
            }
          }
        }

        const candidateName = chosenCandidate?.name || 'Available Team Member';
        const candidateId = chosenCandidate?.id || null;

        const explanation = chosenCandidate
          ? `Recommended ${candidateName} based on lowest active task load (${minWorkload === Infinity ? 0 : minWorkload} active tasks) and project availability.`
          : 'Workspace roster has no available members to automatically assign.';

        return {
          action,
          title: `Smart Assignee Recommendation: ${task?.title || 'Task'}`,
          explanation,
          expectedOutcome: `Assign ${candidateName} to ${task?.title || 'the task'} to balance team capacity.`,
          targetEntity: {
            type: 'task',
            id: task?.id,
            name: task?.title,
          },
          payload: {
            taskId: task?.id,
            assigneeId: candidateId,
            assigneeName: candidateName,
            activeWorkload: minWorkload === Infinity ? 0 : minWorkload,
          },
          requiresApproval,
        };
      }

      case WorkflowActionType.NOTIFY_PROJECT_MANAGER: {
        const triggerDesc =
          context.trigger === WorkflowTriggerType.TASK_OVERDUE
            ? `is overdue`
            : context.trigger === WorkflowTriggerType.TASK_MARKED_BLOCKED
            ? `is marked BLOCKED`
            : context.trigger === WorkflowTriggerType.PROJECT_HEALTH_AT_RISK
            ? `health degraded to ${context.projectHealth?.classification || 'AT_RISK'}`
            : `triggered automation rule`;

        const title = `Alert: ${task?.title ? `Task ${task.title}` : projectName} ${triggerDesc}`;
        const body = `Automated escalation notice for ${projectName}: Immediate review advised to preserve schedule integrity.`;

        return {
          action,
          title: `Notify Project Manager: ${projectName}`,
          explanation: `Automated alert dispatched to project management leadership regarding critical event: ${context.trigger}.`,
          expectedOutcome: `Send in-app notification to project owner/manager with direct incident link.`,
          targetEntity: {
            type: 'notification',
            id: context.projectOwnerId,
            name: 'Project Leadership',
          },
          payload: {
            recipientId: context.projectOwnerId,
            title,
            body,
            projectId: context.projectId || task?.projectId,
            taskId: task?.id,
          },
          requiresApproval,
        };
      }

      case WorkflowActionType.GENERATE_HEALTH_SUMMARY: {
        const score = context.projectHealth?.score ?? 65;
        const classification = context.projectHealth?.classification || 'AT_RISK';
        const risksCount = context.projectHealth?.activeRisksCount ?? 0;

        const summary = `Project "${projectName}" health stands at ${score}/100 (${classification}). There are ${risksCount} active risks recorded. High-priority interventions recommended on blockers and overdue dependencies.`;

        return {
          action,
          title: `Health Diagnostic Summary: ${projectName}`,
          explanation: `Synthesized current metrics, risk factors, and progress trajectory into an executive diagnostic brief.`,
          expectedOutcome: `Publish health summary to project team for actionable awareness.`,
          targetEntity: {
            type: 'project',
            id: context.projectId || task?.projectId,
            name: projectName,
          },
          payload: {
            projectId: context.projectId || task?.projectId,
            score,
            classification,
            summary,
          },
          requiresApproval,
        };
      }

      case WorkflowActionType.CREATE_TASK_PROPOSAL: {
        const targetStatus = actionConfig.targetStatus || TaskStatus.IN_PROGRESS;
        const targetPriority = actionConfig.targetPriority || Priority.URGENT;

        const explanation = `Workflow rule identified an update proposal for "${task?.title || 'Task'}": adjust status/priority to maintain project momentum.`;
        const expectedOutcome = `Update task status to "${targetStatus}" or priority to "${targetPriority}" upon approval.`;

        return {
          action,
          title: `Task Update Proposal: ${task?.title || 'Task'}`,
          explanation,
          expectedOutcome,
          targetEntity: {
            type: 'task',
            id: task?.id,
            name: task?.title,
          },
          payload: {
            taskId: task?.id,
            targetStatus,
            targetPriority,
          },
          requiresApproval,
        };
      }

      default: {
        throw new Error(`Unsupported workflow action: ${action}`);
      }
    }
  }

  /**
   * Deterministic idempotency / dedupe key generator.
   */
  static buildDedupeKey(
    ruleId: string,
    trigger: WorkflowTriggerType,
    entityId: string,
    bucketDate: Date = new Date(),
  ): string {
    const ymd = bucketDate.toISOString().slice(0, 10);
    return `${ruleId}:${trigger}:${entityId}:${ymd}`;
  }
}
