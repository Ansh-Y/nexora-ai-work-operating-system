import { createHash } from 'node:crypto';
import { Priority, TaskStatus } from '@prisma/client';
import { DetectedRisk, RiskSeverity, RiskType } from './project-health.types';
import { DEFAULT_HEALTH_CONFIG, ProjectHealthConfig } from './project-health-config';

export interface ProjectDataForRisk {
  id: string;
  name: string;
  dueDate: Date | null;
  startDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority;
    dueDate: Date | null;
    startDate: Date | null;
    completedAt: Date | null;
    assigneeId: string | null;
    assignee?: { id: string; name: string } | null;
    createdAt: Date;
    updatedAt: Date;
    blocks: Array<{ blockedTaskId: string }>;
    blockedBy: Array<{ blockingTaskId: string }>;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    targetDate: Date | null;
    completedAt: Date | null;
  }>;
  comments?: Array<{ createdAt: Date }>;
  githubEvents?: Array<{ createdAt: Date }>;
  meetingActionItems?: Array<{ createdAt: Date }>;
}

export function generateRiskFingerprint(riskType: RiskType, affectedIds: string[], extraKey = ''): string {
  const sorted = [...affectedIds].sort();
  const raw = `${riskType}:${sorted.join(',')}:${extraKey}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export class PredictiveRiskEngine {
  constructor(private config: ProjectHealthConfig = DEFAULT_HEALTH_CONFIG) {}

  detectRisks(
    project: ProjectDataForRisk,
    dependencies: Array<{ blockingTaskId: string; blockedTaskId: string }> = [],
    criticalPathTaskIds: Set<string> = new Set(),
    now = new Date(),
    existingRisks: Array<{
      fingerprint: string;
      status: string;
      severity: string;
      dismissReason?: string | null;
      dismissedAt?: Date | null;
      dismissedById?: string | null;
    }> = [],
  ): DetectedRisk[] {
    const criticalPath = criticalPathTaskIds || new Set<string>();
    const risks: DetectedRisk[] = [];
    const activeTasks = project.tasks.filter(
      t => t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED,
    );

    if (activeTasks.length === 0 && project.tasks.length === 0) {
      return risks;
    }

    // 1. OVERDUE_TASKS
    const overdueTasks = activeTasks.filter(t => t.dueDate && t.dueDate < now);
    if (overdueTasks.length > 0) {
      const hasCriticalOverdue = overdueTasks.some(
        t =>
          (t.priority === Priority.URGENT || t.priority === Priority.HIGH) &&
          (now.getTime() - t.dueDate!.getTime() > 3 * 86400000 || criticalPath.has(t.id)),
      );
      const hasHighOverdue = overdueTasks.some(
        t => t.priority === Priority.URGENT || t.priority === Priority.HIGH,
      );

      let severity: RiskSeverity = 'LOW';
      if (hasCriticalOverdue) severity = 'CRITICAL';
      else if (hasHighOverdue || overdueTasks.length >= 3) severity = 'HIGH';
      else if (overdueTasks.some(t => t.priority === Priority.MEDIUM)) severity = 'MEDIUM';

      const taskIds = overdueTasks.map(t => t.id);
      risks.push({
        fingerprint: generateRiskFingerprint('OVERDUE_TASKS', taskIds),
        riskType: 'OVERDUE_TASKS',
        severity,
        title: `${overdueTasks.length} overdue task(s) in project`,
        explanation: `${overdueTasks.length} active task(s) have passed their scheduled deadline. Late tasks delay downstream dependencies and impact project delivery.`,
        evidence: {
          metrics: {
            overdueCount: overdueTasks.length,
            urgentCount: overdueTasks.filter(t => t.priority === Priority.URGENT).length,
            highCount: overdueTasks.filter(t => t.priority === Priority.HIGH).length,
            maxDaysOverdue: Math.max(...overdueTasks.map(t => Math.floor((now.getTime() - t.dueDate!.getTime()) / 86400000))),
          },
          sourceReferences: overdueTasks.map(t => ({
            type: 'task',
            id: t.id,
            title: `${t.title} (due ${t.dueDate?.toISOString().slice(0, 10)})`,
          })),
        },
        recommendedAction: 'Reschedule overdue task dates or reallocate resources to complete high-priority blocked work.',
        confidence: 'HIGH',
        affectedTaskIds: taskIds,
        affectedMilestoneIds: [],
        relevantDueDates: overdueTasks.map(t => t.dueDate!.toISOString()),
      });
    }

    // 2. INSUFFICIENT_PROGRESS (Tasks due within 7 days still in TODO with >= 70% elapsed time)
    const next7Days = new Date(now.getTime() + 7 * 86400000);
    const impendingTasks = activeTasks.filter(t => {
      if (!t.dueDate || t.dueDate < now || t.dueDate > next7Days) return false;
      if (t.status !== TaskStatus.TODO) return false;

      const start = t.startDate || t.createdAt;
      const totalTime = t.dueDate.getTime() - start.getTime();
      const elapsed = now.getTime() - start.getTime();
      return totalTime > 0 && elapsed / totalTime >= 0.7;
    });

    if (impendingTasks.length > 0) {
      const hasHighPriority = impendingTasks.some(
        t => t.priority === Priority.URGENT || t.priority === Priority.HIGH,
      );
      const taskIds = impendingTasks.map(t => t.id);
      risks.push({
        fingerprint: generateRiskFingerprint('INSUFFICIENT_PROGRESS', taskIds),
        riskType: 'INSUFFICIENT_PROGRESS',
        severity: hasHighPriority ? 'HIGH' : 'MEDIUM',
        title: `${impendingTasks.length} upcoming task(s) with no progress recorded`,
        explanation: `These task(s) are due within 7 days and remain in 'To Do' state despite more than 70% of their allotted time window having passed.`,
        evidence: {
          metrics: { count: impendingTasks.length },
          sourceReferences: impendingTasks.map(t => ({
            type: 'task',
            id: t.id,
            title: `${t.title} (due ${t.dueDate?.toISOString().slice(0, 10)})`,
          })),
        },
        recommendedAction: 'Confirm task feasibility with assignees and transition active work to in-progress.',
        confidence: 'HIGH',
        affectedTaskIds: taskIds,
        affectedMilestoneIds: [],
        relevantDueDates: impendingTasks.map(t => t.dueDate!.toISOString()),
      });
    }

    // 3. BLOCKED_HIGH_PRIORITY
    const blockedHighTasks = activeTasks.filter(
      t =>
        (t.priority === Priority.URGENT || t.priority === Priority.HIGH) &&
        (t.status === TaskStatus.BLOCKED || t.blockedBy.length > 0),
    );

    if (blockedHighTasks.length > 0) {
      const isCritical = blockedHighTasks.some(
        t => t.priority === Priority.URGENT || criticalPath.has(t.id),
      );
      const taskIds = blockedHighTasks.map(t => t.id);
      risks.push({
        fingerprint: generateRiskFingerprint('BLOCKED_HIGH_PRIORITY', taskIds),
        riskType: 'BLOCKED_HIGH_PRIORITY',
        severity: isCritical ? 'CRITICAL' : 'HIGH',
        title: `${blockedHighTasks.length} high-priority task(s) currently blocked`,
        explanation: `High or Urgent priority tasks are blocked by incomplete prerequisites. If not resolved promptly, project milestones and critical path delivery will be delayed.`,
        evidence: {
          metrics: {
            count: blockedHighTasks.length,
            onCriticalPath: blockedHighTasks.filter(t => criticalPath.has(t.id)).length,
          },
          sourceReferences: blockedHighTasks.map(t => ({
            type: 'task',
            id: t.id,
            title: `${t.title} [${t.priority}]`,
          })),
        },
        recommendedAction: 'Prioritize resolution of the upstream dependencies blocking these critical tasks.',
        confidence: 'HIGH',
        affectedTaskIds: taskIds,
        affectedMilestoneIds: [],
        relevantDueDates: blockedHighTasks.filter(t => t.dueDate).map(t => t.dueDate!.toISOString()),
      });
    }

    // 4 & 5. DEPENDENCY_BOTTLENECK & MULTI_DOWNSTREAM_BLOCK
    const taskDownstreamMap = new Map<string, string[]>();
    for (const dep of dependencies) {
      const list = taskDownstreamMap.get(dep.blockingTaskId) || [];
      if (!list.includes(dep.blockedTaskId)) {
        list.push(dep.blockedTaskId);
      }
      taskDownstreamMap.set(dep.blockingTaskId, list);
    }
    for (const task of project.tasks) {
      if (task.blocks && task.blocks.length > 0) {
        const list = taskDownstreamMap.get(task.id) || [];
        for (const b of task.blocks) {
          if (!list.includes(b.blockedTaskId)) {
            list.push(b.blockedTaskId);
          }
        }
        taskDownstreamMap.set(task.id, list);
      }
    }

    for (const task of activeTasks) {
      const downstreamIds = taskDownstreamMap.get(task.id) || [];
      if (downstreamIds.length >= 3) {
        risks.push({
          fingerprint: generateRiskFingerprint('MULTI_DOWNSTREAM_BLOCK', [task.id], `count:${downstreamIds.length}`),
          riskType: 'MULTI_DOWNSTREAM_BLOCK',
          severity: criticalPath.has(task.id) ? 'CRITICAL' : 'HIGH',
          title: `Task "${task.title.slice(0, 50)}" blocks ${downstreamIds.length} downstream tasks`,
          explanation: `A single incomplete task is directly preventing ${downstreamIds.length} dependent tasks from proceeding, creating an operational bottleneck.`,
          evidence: {
            metrics: { blockedCount: downstreamIds.length, taskPriority: task.priority },
            sourceReferences: [
              { type: 'task', id: task.id, title: task.title },
              ...downstreamIds.slice(0, 5).map(id => ({ type: 'task', id, title: `Downstream Task ${id.slice(0, 8)}` })),
            ],
          },
          recommendedAction: 'Break this bottleneck task into smaller concurrent work streams or assign additional team members.',
          confidence: 'HIGH',
          affectedTaskIds: [task.id, ...downstreamIds],
          affectedMilestoneIds: [],
          relevantDueDates: task.dueDate ? [task.dueDate.toISOString()] : [],
        });
      } else if (downstreamIds.length === 2 || (downstreamIds.length >= 1 && criticalPath.has(task.id))) {
        risks.push({
          fingerprint: generateRiskFingerprint('DEPENDENCY_BOTTLENECK', [task.id]),
          riskType: 'DEPENDENCY_BOTTLENECK',
          severity: criticalPath.has(task.id) ? 'HIGH' : 'MEDIUM',
          title: `Dependency bottleneck on "${task.title.slice(0, 50)}"`,
          explanation: `This task lies on the critical path or directly gates multiple downstream deliverables.`,
          evidence: {
            metrics: { downstreamCount: downstreamIds.length, isCriticalPath: criticalPath.has(task.id) },
            sourceReferences: [{ type: 'task', id: task.id, title: task.title }],
          },
          recommendedAction: 'Ensure prerequisites are tracked closely and review dependent scheduling.',
          confidence: 'HIGH',
          affectedTaskIds: [task.id, ...downstreamIds],
          affectedMilestoneIds: [],
          relevantDueDates: task.dueDate ? [task.dueDate.toISOString()] : [],
        });
      }
    }

    // 6. MILESTONE_AT_RISK
    const overdueMilestones = project.milestones.filter(m => !m.completedAt && m.targetDate && m.targetDate < now);
    if (overdueMilestones.length > 0) {
      const milestoneIds = overdueMilestones.map(m => m.id);
      risks.push({
        fingerprint: generateRiskFingerprint('MILESTONE_AT_RISK', milestoneIds, 'overdue'),
        riskType: 'MILESTONE_AT_RISK',
        severity: 'CRITICAL',
        title: `${overdueMilestones.length} milestone(s) are overdue`,
        explanation: `One or more project milestones have passed their target dates without being marked complete.`,
        evidence: {
          metrics: { count: overdueMilestones.length },
          sourceReferences: overdueMilestones.map(m => ({
            type: 'milestone',
            id: m.id,
            title: `${m.title} (target: ${m.targetDate?.toISOString().slice(0, 10)})`,
          })),
        },
        recommendedAction: 'Review remaining milestone deliverables and adjust schedule expectations with stakeholders.',
        confidence: 'HIGH',
        affectedTaskIds: [],
        affectedMilestoneIds: milestoneIds,
        relevantDueDates: overdueMilestones.map(m => m.targetDate!.toISOString()),
      });
    }

    const next14Days = new Date(now.getTime() + 14 * 86400000);
    const nearMilestones = project.milestones.filter(
      m => !m.completedAt && m.targetDate && m.targetDate >= now && m.targetDate <= next14Days,
    );

    if (nearMilestones.length > 0 && (overdueTasks.length > 0 || blockedHighTasks.length > 0)) {
      const milestoneIds = nearMilestones.map(m => m.id);
      risks.push({
        fingerprint: generateRiskFingerprint('MILESTONE_AT_RISK', milestoneIds, 'threatened'),
        riskType: 'MILESTONE_AT_RISK',
        severity: 'HIGH',
        title: `${nearMilestones.length} upcoming milestone(s) threatened by active risks`,
        explanation: `Milestones due within 14 days share this project with ${overdueTasks.length} overdue task(s) and ${blockedHighTasks.length} blocked high-priority task(s).`,
        evidence: {
          metrics: {
            milestoneCount: nearMilestones.length,
            overdueTaskCount: overdueTasks.length,
            blockedHighTaskCount: blockedHighTasks.length,
          },
          sourceReferences: nearMilestones.map(m => ({
            type: 'milestone',
            id: m.id,
            title: `${m.title} (due ${m.targetDate?.toISOString().slice(0, 10)})`,
          })),
        },
        recommendedAction: 'Expedite blocking items to preserve milestone target dates.',
        confidence: 'HIGH',
        affectedTaskIds: overdueTasks.map(t => t.id),
        affectedMilestoneIds: milestoneIds,
        relevantDueDates: nearMilestones.map(m => m.targetDate!.toISOString()),
      });
    }

    // 7. DECLINING_MOMENTUM
    const completedTasks = project.tasks.filter(t => t.status === TaskStatus.DONE);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
    const recentlyCompleted = completedTasks.filter(
      t => t.completedAt && t.completedAt >= fourteenDaysAgo,
    );

    if (activeTasks.length >= 3 && completedTasks.length >= 1 && recentlyCompleted.length === 0) {
      risks.push({
        fingerprint: generateRiskFingerprint('DECLINING_MOMENTUM', [project.id]),
        riskType: 'DECLINING_MOMENTUM',
        severity: 'MEDIUM',
        title: 'Project completion momentum has stalled',
        explanation: `Zero tasks were marked completed in the last 14 days, despite ${activeTasks.length} active tasks remaining in progress.`,
        evidence: {
          metrics: {
            activeTasksCount: activeTasks.length,
            historicalCompletedCount: completedTasks.length,
            completedInLast14Days: 0,
          },
          sourceReferences: [{ type: 'project', id: project.id, title: project.name }],
        },
        recommendedAction: 'Schedule a team standup to identify unrecorded progress or address team impediments.',
        confidence: 'MEDIUM',
        affectedTaskIds: activeTasks.slice(0, 5).map(t => t.id),
        affectedMilestoneIds: [],
        relevantDueDates: [],
      });
    }

    // 8. UNASSIGNED_HIGH_PRIORITY
    const unassignedHighTasks = activeTasks.filter(
      t => !t.assigneeId && (t.priority === Priority.URGENT || t.priority === Priority.HIGH || criticalPath.has(t.id)),
    );

    if (unassignedHighTasks.length > 0) {
      const isCritical = unassignedHighTasks.some(
        t => t.priority === Priority.URGENT || criticalPath.has(t.id),
      );
      const taskIds = unassignedHighTasks.map(t => t.id);
      risks.push({
        fingerprint: generateRiskFingerprint('UNASSIGNED_HIGH_PRIORITY', taskIds),
        riskType: 'UNASSIGNED_HIGH_PRIORITY',
        severity: isCritical ? 'HIGH' : 'MEDIUM',
        title: `${unassignedHighTasks.length} high-priority task(s) have no owner`,
        explanation: `Important or critical-path tasks are unassigned. Without designated owners, tasks are frequently overlooked.`,
        evidence: {
          metrics: { count: unassignedHighTasks.length },
          sourceReferences: unassignedHighTasks.map(t => ({
            type: 'task',
            id: t.id,
            title: `${t.title} [${t.priority}]`,
          })),
        },
        recommendedAction: 'Assign designated team members to take ownership of these key deliverables.',
        confidence: 'HIGH',
        affectedTaskIds: taskIds,
        affectedMilestoneIds: [],
        relevantDueDates: unassignedHighTasks.filter(t => t.dueDate).map(t => t.dueDate!.toISOString()),
      });
    }

    // 9. STALE_PROJECT
    const allActivityDates: Date[] = [
      project.updatedAt,
      ...project.tasks.map(t => t.updatedAt),
      ...(project.comments?.map(c => c.createdAt) || []),
      ...(project.githubEvents?.map(e => e.createdAt) || []),
      ...(project.meetingActionItems?.map(a => a.createdAt) || []),
    ];

    const latestActivity = allActivityDates.length ? new Date(Math.max(...allActivityDates.map(d => d.getTime()))) : project.createdAt;
    const daysSinceActivity = Math.floor((now.getTime() - latestActivity.getTime()) / 86400000);

    if (activeTasks.length > 0 && daysSinceActivity >= this.config.stalenessDays) {
      risks.push({
        fingerprint: generateRiskFingerprint('STALE_PROJECT', [project.id], `days:${Math.floor(daysSinceActivity / 7)}`),
        riskType: 'STALE_PROJECT',
        severity: daysSinceActivity >= 28 ? 'MEDIUM' : 'LOW',
        title: `No activity recorded for ${daysSinceActivity} days`,
        explanation: `The project has active tasks but has seen no updates, comments, meeting items, or code integration events in ${daysSinceActivity} days.`,
        evidence: {
          metrics: { daysSinceActivity, activeTasksRemaining: activeTasks.length },
          sourceReferences: [{ type: 'project', id: project.id, title: project.name }],
        },
        recommendedAction: 'Verify whether this project is on hold, paused, or should be formally archived.',
        confidence: 'MEDIUM',
        affectedTaskIds: [],
        affectedMilestoneIds: [],
        relevantDueDates: [],
      });
    }

    // 10. HIGH_WORKLOAD_UPCOMING
    if (project.dueDate && project.dueDate >= now && project.dueDate <= next7Days) {
      const incompleteRatio = activeTasks.length / Math.max(1, project.tasks.length);
      if (incompleteRatio >= 0.4 && activeTasks.length >= 3) {
        const daysLeft = Math.max(1, Math.ceil((project.dueDate.getTime() - now.getTime()) / 86400000));
        risks.push({
          fingerprint: generateRiskFingerprint('HIGH_WORKLOAD_UPCOMING', [project.id]),
          riskType: 'HIGH_WORKLOAD_UPCOMING',
          severity: daysLeft <= 3 ? 'CRITICAL' : 'HIGH',
          title: `Project deadline in ${daysLeft} day(s) with ${activeTasks.length} incomplete tasks`,
          explanation: `${Math.round(incompleteRatio * 100)}% of project tasks remain incomplete with only ${daysLeft} days until the project deadline.`,
          evidence: {
            metrics: {
              daysRemaining: daysLeft,
              incompleteTasksCount: activeTasks.length,
              totalTasksCount: project.tasks.length,
              incompletePercentage: Math.round(incompleteRatio * 100),
            },
            sourceReferences: [{ type: 'project', id: project.id, title: `${project.name} (due ${project.dueDate.toISOString().slice(0, 10)})` }],
          },
          recommendedAction: 'Scope down non-essential tasks, renegotiate the deadline, or prioritize strictly essential launch items.',
          confidence: 'HIGH',
          affectedTaskIds: activeTasks.map(t => t.id),
          affectedMilestoneIds: [],
          relevantDueDates: [project.dueDate.toISOString()],
        });
      }
    }

    if (existingRisks && existingRisks.length > 0) {
      const existingMap = new Map<string, (typeof existingRisks)[0]>();
      for (const r of existingRisks) {
        existingMap.set(r.fingerprint, r);
      }
      for (const risk of risks) {
        const match = existingMap.get(risk.fingerprint);
        if (match && match.status === 'DISMISSED' && match.severity === risk.severity) {
          risk.status = 'DISMISSED';
          risk.dismissalReason = match.dismissReason || undefined;
          risk.dismissedAt = match.dismissedAt ? new Date(match.dismissedAt) : undefined;
          risk.dismissedById = match.dismissedById || undefined;
        } else {
          risk.status = 'ACTIVE';
        }
      }
    } else {
      for (const risk of risks) {
        risk.status = 'ACTIVE';
      }
    }

    return risks;
  }
}
