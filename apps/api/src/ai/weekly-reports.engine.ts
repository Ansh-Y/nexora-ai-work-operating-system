import { Priority, TaskStatus } from '@prisma/client';

export interface RawProjectData {
  id: string;
  name: string;
  description?: string | null;
  tasks: Array<{
    id: string;
    title: string;
    description?: string | null;
    status: TaskStatus;
    priority: Priority;
    dueDate?: Date | string | null;
    startDate?: Date | string | null;
    completedAt?: Date | string | null;
    createdAt: Date | string;
    assigneeId?: string | null;
    assignee?: { id: string; name: string; email?: string } | null;
    blockedBy?: Array<{ blockingTask: { id: string; title: string; status: TaskStatus } }>;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    description?: string | null;
    targetDate?: Date | string | null;
    completedAt?: Date | string | null;
  }>;
  healthSnapshot?: {
    score: number;
    classification: string;
    explanation?: string | null;
  } | null;
  activeRisks?: Array<{
    id: string;
    title: string;
    severity: string;
    recommendedAction?: string;
  }>;
  meetings?: Array<{
    id: string;
    title: string;
    startsAt: Date | string;
    decisions: Array<{ id: string; title: string; evidence?: string | null }>;
    actionItems: Array<{ id: string; title: string; status: string; assigneeId?: string | null }>;
  }>;
  roster?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
}

export interface CalculatedReportMetrics {
  totalTasks: number;
  completedTasks: number;
  completedThisPeriod: number;
  createdThisPeriod: number;
  pendingTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  completionRate: number; // percentage 0-100
  healthScore: number;
  healthClassification: string;
  milestonesTotal: number;
  milestonesCompleted: number;
  milestonesApproaching: number;
}

export interface MemberWorkloadSummary {
  memberId: string;
  name: string;
  email: string;
  role: string;
  assignedCount: number;
  activeCount: number;
  completedThisPeriod: number;
  overdueCount: number;
}

export interface WeeklyReportActionRecommendation {
  id: string;
  title: string;
  category: 'DELIVERY' | 'RISK' | 'CAPACITY' | 'ALIGNMENT';
  rationale: string;
  priority: 'URGENT' | 'HIGH' | 'MEDIUM';
  targetTaskId?: string;
  targetMilestoneId?: string;
}

export interface StructuredWeeklyReportData {
  projectId: string;
  projectName: string;
  projectDescription?: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  generatedAt: string; // ISO
  metrics: CalculatedReportMetrics;
  executiveSummary: string;
  progressOverview: {
    completedTasks: Array<{ id: string; title: string; completedAt: string }>;
    createdTasks: Array<{ id: string; title: string; priority: Priority }>;
    upcomingMilestones: Array<{ id: string; title: string; targetDate: string }>;
  };
  blockersAndRisks: {
    blockedTasks: Array<{ id: string; title: string; blockedByTitles: string[] }>;
    overdueTasks: Array<{ id: string; title: string; priority: Priority; dueDate: string }>;
    projectRisks: Array<{ id: string; title: string; severity: string; action: string }>;
  };
  teamWorkload: {
    members: MemberWorkloadSummary[];
    unassignedHighPriorityCount: number;
  };
  meetingInsights: {
    totalMeetings: number;
    decisionsCount: number;
    decisions: Array<{ meetingTitle: string; title: string }>;
    openActionItemsCount: number;
  };
  recommendations: WeeklyReportActionRecommendation[];
}

export class WeeklyReportEngine {
  /**
   * Deterministically calculates reporting period boundaries.
   */
  static resolvePeriod(
    periodStartInput?: Date | string | null,
    periodEndInput?: Date | string | null,
    now: Date = new Date(),
  ): { periodStart: Date; periodEnd: Date } {
    const periodEnd = periodEndInput ? new Date(periodEndInput) : now;
    const periodStart = periodStartInput
      ? new Date(periodStartInput)
      : new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { periodStart, periodEnd };
  }

  /**
   * Calculates deterministic numerical metrics from actual project data.
   */
  static calculateMetrics(
    data: RawProjectData,
    periodStart: Date,
    periodEnd: Date,
  ): CalculatedReportMetrics {
    const tasks = data.tasks || [];
    const totalTasks = tasks.length;

    let completedTasks = 0;
    let completedThisPeriod = 0;
    let createdThisPeriod = 0;
    let pendingTasks = 0;
    let overdueTasks = 0;
    let blockedTasks = 0;

    const startMs = periodStart.getTime();
    const endMs = periodEnd.getTime();

    for (const t of tasks) {
      const isDone = t.status === TaskStatus.DONE;
      const isCancelled = t.status === TaskStatus.CANCELLED;

      if (isDone) completedTasks++;
      if (!isDone && !isCancelled) pendingTasks++;
      if (t.status === TaskStatus.BLOCKED) blockedTasks++;

      // Completed in period
      if (isDone && t.completedAt) {
        const cMs = new Date(t.completedAt).getTime();
        if (cMs >= startMs && cMs <= endMs) completedThisPeriod++;
      }

      // Created in period
      const crMs = new Date(t.createdAt).getTime();
      if (crMs >= startMs && crMs <= endMs) createdThisPeriod++;

      // Overdue relative to periodEnd
      if (!isDone && !isCancelled && t.dueDate) {
        const dMs = new Date(t.dueDate).getTime();
        if (dMs < endMs) overdueTasks++;
      }
    }

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const milestones = data.milestones || [];
    const milestonesTotal = milestones.length;
    const milestonesCompleted = milestones.filter(m => m.completedAt != null).length;

    // Milestones approaching within 14 days of periodEnd
    const horizonMs = endMs + 14 * 24 * 60 * 60 * 1000;
    const milestonesApproaching = milestones.filter(m => {
      if (m.completedAt) return false;
      if (!m.targetDate) return false;
      const tMs = new Date(m.targetDate).getTime();
      return tMs >= endMs && tMs <= horizonMs;
    }).length;

    const healthScore = data.healthSnapshot?.score ?? (blockedTasks > 0 || overdueTasks > 0 ? 60 : 85);
    const healthClassification =
      data.healthSnapshot?.classification ?? (healthScore >= 80 ? 'ON_TRACK' : healthScore >= 60 ? 'AT_RISK' : 'CRITICAL');

    return {
      totalTasks,
      completedTasks,
      completedThisPeriod,
      createdThisPeriod,
      pendingTasks,
      overdueTasks,
      blockedTasks,
      completionRate,
      healthScore,
      healthClassification,
      milestonesTotal,
      milestonesCompleted,
      milestonesApproaching,
    };
  }

  /**
   * Aggregates team workload objectively without fabricated ranking scores.
   */
  static aggregateWorkload(
    data: RawProjectData,
    periodStart: Date,
    periodEnd: Date,
  ): { members: MemberWorkloadSummary[]; unassignedHighPriorityCount: number } {
    const tasks = data.tasks || [];
    const roster = data.roster || [];
    const startMs = periodStart.getTime();
    const endMs = periodEnd.getTime();

    // Map members
    const memberMap = new Map<string, MemberWorkloadSummary>();
    for (const m of roster) {
      memberMap.set(m.id, {
        memberId: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        assignedCount: 0,
        activeCount: 0,
        completedThisPeriod: 0,
        overdueCount: 0,
      });
    }

    let unassignedHighPriorityCount = 0;

    for (const t of tasks) {
      const isDone = t.status === TaskStatus.DONE;
      const isCancelled = t.status === TaskStatus.CANCELLED;
      const isOverdue = !isDone && !isCancelled && t.dueDate && new Date(t.dueDate).getTime() < endMs;

      if (!t.assigneeId) {
        if (!isDone && !isCancelled && (t.priority === Priority.URGENT || t.priority === Priority.HIGH)) {
          unassignedHighPriorityCount++;
        }
        continue;
      }

      let summary = memberMap.get(t.assigneeId);
      if (!summary) {
        // Assignee not in workspace roster list
        summary = {
          memberId: t.assigneeId,
          name: t.assignee?.name || 'Team Member',
          email: t.assignee?.email || '',
          role: 'MEMBER',
          assignedCount: 0,
          activeCount: 0,
          completedThisPeriod: 0,
          overdueCount: 0,
        };
        memberMap.set(t.assigneeId, summary);
      }

      summary.assignedCount++;
      if (!isDone && !isCancelled) summary.activeCount++;
      if (isOverdue) summary.overdueCount++;
      if (isDone && t.completedAt) {
        const cMs = new Date(t.completedAt).getTime();
        if (cMs >= startMs && cMs <= endMs) summary.completedThisPeriod++;
      }
    }

    return {
      members: Array.from(memberMap.values()),
      unassignedHighPriorityCount,
    };
  }

  /**
   * Generates grounded narrative summary and recommendations from verified facts.
   */
  static generateExecutiveSummary(
    data: RawProjectData,
    metrics: CalculatedReportMetrics,
    periodStart: Date,
    periodEnd: Date,
  ): string {
    const pName = data.name;
    const startStr = periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    let summary = `For the reporting period ${startStr} to ${endStr}, ${pName} registered an overall completion rate of ${metrics.completionRate}% (${metrics.completedTasks} of ${metrics.totalTasks} total tasks closed). `;

    if (metrics.completedThisPeriod > 0) {
      summary += `The team completed ${metrics.completedThisPeriod} task${metrics.completedThisPeriod > 1 ? 's' : ''} this week, while ${metrics.createdThisPeriod} new work item${metrics.createdThisPeriod > 1 ? 's were' : ' was'} introduced. `;
    } else {
      summary += `No tasks were marked completed during this specific weekly window. `;
    }

    if (metrics.blockedTasks > 0 || metrics.overdueTasks > 0) {
      summary += `Attention is required on ${metrics.blockedTasks} currently blocked task${metrics.blockedTasks > 1 ? 's' : ''} and ${metrics.overdueTasks} overdue item${metrics.overdueTasks > 1 ? 's' : ''}, maintaining health classification at ${metrics.healthClassification} (Score: ${metrics.healthScore}/100).`;
    } else {
      summary += `Work is progressing on schedule with zero active blockers and zero overdue tasks, reflecting an ${metrics.healthClassification} health rating (Score: ${metrics.healthScore}/100).`;
    }

    return summary;
  }

  /**
   * Generates grounded, actionable recommendations for the upcoming week.
   */
  static generateRecommendations(
    data: RawProjectData,
    metrics: CalculatedReportMetrics,
    workload: { members: MemberWorkloadSummary[]; unassignedHighPriorityCount: number },
  ): WeeklyReportActionRecommendation[] {
    const recommendations: WeeklyReportActionRecommendation[] = [];
    const tasks = data.tasks || [];
    let recId = 1;

    // 1. Blocker resolution
    const blockedTasks = tasks.filter(t => t.status === TaskStatus.BLOCKED);
    if (blockedTasks.length > 0) {
      const firstBlocked = blockedTasks[0];
      const upstream = firstBlocked.blockedBy?.map(b => b.blockingTask.title).join(', ');
      recommendations.push({
        id: `rec-${recId++}`,
        title: `Unblock "${firstBlocked.title}"`,
        category: 'DELIVERY',
        rationale: upstream
          ? `Task is blocked by prerequisite upstream delivery: ${upstream}. Immediate team alignment required.`
          : `Task is flagged as BLOCKED without specified dependencies. Clarify impediments with assignee.`,
        priority: 'URGENT',
        targetTaskId: firstBlocked.id,
      });
    }

    // 2. Overdue task re-planning
    const overdueTasks = tasks.filter(
      t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED,
    );
    if (overdueTasks.length > 0) {
      const topOverdue = overdueTasks[0];
      recommendations.push({
        id: `rec-${recId++}`,
        title: `Re-evaluate Schedule for "${topOverdue.title}"`,
        category: 'RISK',
        rationale: `Task missed scheduled due date of ${new Date(topOverdue.dueDate!).toLocaleDateString()}. Re-estimate remaining effort and reset milestone expectation.`,
        priority: topOverdue.priority === Priority.URGENT ? 'URGENT' : 'HIGH',
        targetTaskId: topOverdue.id,
      });
    }

    // 3. Unassigned high-priority work
    if (workload.unassignedHighPriorityCount > 0) {
      recommendations.push({
        id: `rec-${recId++}`,
        title: `Assign Owners to ${workload.unassignedHighPriorityCount} High-Priority Task${workload.unassignedHighPriorityCount > 1 ? 's' : ''}`,
        category: 'CAPACITY',
        rationale: `${workload.unassignedHighPriorityCount} critical or urgent work item(s) remain unassigned. Use AI Smart Assignment to balance workload.`,
        priority: 'HIGH',
      });
    }

    // 4. Milestone approaching
    const approachingMilestones = (data.milestones || []).filter(m => !m.completedAt && m.targetDate);
    if (approachingMilestones.length > 0) {
      const nearest = approachingMilestones[0];
      recommendations.push({
        id: `rec-${recId++}`,
        title: `Conduct Target Readiness Check for Milestone "${nearest.title}"`,
        category: 'ALIGNMENT',
        rationale: `Milestone is targeted for ${new Date(nearest.targetDate!).toLocaleDateString()}. Confirm remaining deliverables with project leads.`,
        priority: 'MEDIUM',
        targetMilestoneId: nearest.id,
      });
    }

    // Fallback if no issues exist
    if (recommendations.length === 0) {
      recommendations.push({
        id: `rec-${recId++}`,
        title: 'Maintain Current Execution Rhythm',
        category: 'DELIVERY',
        rationale: 'Project is pacing cleanly with 0 blockers and no overdue deliverables. Continue daily progress syncs.',
        priority: 'MEDIUM',
      });
    }

    return recommendations;
  }

  /**
   * Builds the complete structured report.
   */
  static buildStructuredReport(
    data: RawProjectData,
    periodStartInput?: Date | string | null,
    periodEndInput?: Date | string | null,
    customNarrative?: string | null,
  ): StructuredWeeklyReportData {
    const { periodStart, periodEnd } = this.resolvePeriod(periodStartInput, periodEndInput);
    const metrics = this.calculateMetrics(data, periodStart, periodEnd);
    const workload = this.aggregateWorkload(data, periodStart, periodEnd);
    const baseSummary = this.generateExecutiveSummary(data, metrics, periodStart, periodEnd);
    const executiveSummary = customNarrative ? `${baseSummary} Strategic Focus: ${customNarrative}` : baseSummary;
    const recommendations = this.generateRecommendations(data, metrics, workload);

    const tasks = data.tasks || [];
    const startMs = periodStart.getTime();
    const endMs = periodEnd.getTime();

    // Progress details
    const completedTasks = tasks
      .filter(t => t.status === TaskStatus.DONE && t.completedAt && new Date(t.completedAt).getTime() >= startMs && new Date(t.completedAt).getTime() <= endMs)
      .map(t => ({ id: t.id, title: t.title, completedAt: new Date(t.completedAt!).toISOString() }));

    const createdTasks = tasks
      .filter(t => new Date(t.createdAt).getTime() >= startMs && new Date(t.createdAt).getTime() <= endMs)
      .map(t => ({ id: t.id, title: t.title, priority: t.priority }));

    const upcomingMilestones = (data.milestones || [])
      .filter(m => !m.completedAt && m.targetDate)
      .map(m => ({ id: m.id, title: m.title, targetDate: new Date(m.targetDate!).toISOString() }));

    // Blockers and risks
    const blockedTasks = tasks
      .filter(t => t.status === TaskStatus.BLOCKED)
      .map(t => ({
        id: t.id,
        title: t.title,
        blockedByTitles: (t.blockedBy || []).map(b => b.blockingTask.title),
      }));

    const overdueTasks = tasks
      .filter(t => t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED && t.dueDate && new Date(t.dueDate).getTime() < endMs)
      .map(t => ({ id: t.id, title: t.title, priority: t.priority, dueDate: new Date(t.dueDate!).toISOString() }));

    const projectRisks = (data.activeRisks || []).map(r => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      action: r.recommendedAction || 'Review active risk mitigations.',
    }));

    // Meetings
    const meetings = data.meetings || [];
    const allDecisions = meetings.flatMap(m => m.decisions.map(d => ({ meetingTitle: m.title, title: d.title })));
    const openActionItemsCount = meetings.flatMap(m => m.actionItems).filter(a => a.status !== 'DONE').length;

    return {
      projectId: data.id,
      projectName: data.name,
      projectDescription: data.description || undefined,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      metrics,
      executiveSummary,
      progressOverview: {
        completedTasks,
        createdTasks,
        upcomingMilestones,
      },
      blockersAndRisks: {
        blockedTasks,
        overdueTasks,
        projectRisks,
      },
      teamWorkload: workload,
      meetingInsights: {
        totalMeetings: meetings.length,
        decisionsCount: allDecisions.length,
        decisions: allDecisions,
        openActionItemsCount,
      },
      recommendations,
    };
  }
}
