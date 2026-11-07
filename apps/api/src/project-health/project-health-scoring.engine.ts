import { Priority, TaskStatus } from '@prisma/client';
import {
  DimensionScores,
  HealthCalculationResult,
  HealthClassification,
} from './project-health.types';
import { DEFAULT_HEALTH_CONFIG, ProjectHealthConfig } from './project-health-config';
import { ProjectDataForRisk } from './predictive-risk.engine';
import { PredictiveRiskEngine } from './predictive-risk.engine';
import { ProjectForecastEngine } from './project-forecast.engine';
import { ProjectRecommendationsEngine } from './project-recommendations.engine';

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export class ProjectHealthScoringEngine {
  private riskEngine: PredictiveRiskEngine;
  private forecastEngine: ProjectForecastEngine;
  private recommendationsEngine: ProjectRecommendationsEngine;

  constructor(private config: ProjectHealthConfig = DEFAULT_HEALTH_CONFIG) {
    this.riskEngine = new PredictiveRiskEngine(config);
    this.forecastEngine = new ProjectForecastEngine();
    this.recommendationsEngine = new ProjectRecommendationsEngine();
  }

  calculateHealth(
    project: ProjectDataForRisk,
    dependencies: Array<{ blockingTaskId: string; blockedTaskId: string }> = [],
    criticalPathTaskIds: Set<string> = new Set(),
    now = new Date(),
  ): HealthCalculationResult {
    // If dependencies not explicitly supplied, extract from tasks
    const effectiveDependencies = dependencies.length > 0
      ? dependencies
      : project.tasks.flatMap(t => (t.blockedBy || []).map(b => ({ blockingTaskId: b.blockingTaskId, blockedTaskId: t.id })));
    // Filter active and countable tasks (exclude CANCELLED)
    const allCountableTasks = project.tasks.filter(t => t.status !== TaskStatus.CANCELLED);
    const activeTasks = allCountableTasks.filter(t => t.status !== TaskStatus.DONE);
    const completedTasks = allCountableTasks.filter(t => t.status === TaskStatus.DONE);

    // Check project exclusion status
    const isExcluded =
      project.status === 'COMPLETED' ||
      project.status === 'ARCHIVED';

    // Check data completeness
    const completeness = this.calculateDataCompleteness(project, allCountableTasks);

    // Dimension A: Task Completion and Progress (Weight: 25%)
    const taskCompletionDetail = this.calculateTaskCompletionScore(
      project,
      allCountableTasks,
      completedTasks,
      activeTasks,
      now,
    );

    // Dimension B: Deadline Performance (Weight: 25%)
    const deadlineDetail = this.calculateDeadlinePerformanceScore(
      project,
      activeTasks,
      criticalPathTaskIds,
      now,
    );

    // Dimension C: Blockers and Dependencies (Weight: 25%)
    const blockersDetail = this.calculateBlockersAndDependenciesScore(
      activeTasks,
      effectiveDependencies,
      criticalPathTaskIds,
      now,
    );

    // Dimension D: Milestone Performance (Weight: 15%)
    const milestoneDetail = this.calculateMilestonePerformanceScore(
      project,
      activeTasks,
      now,
    );

    // Dimension E: Recent Activity and Momentum (Weight: 10%)
    const activityDetail = this.calculateRecentActivityScore(
      project,
      completedTasks,
      now,
    );

    const dimensionScores: DimensionScores = {
      taskCompletion: taskCompletionDetail,
      deadlinePerformance: deadlineDetail,
      blockersAndDependencies: blockersDetail,
      milestonePerformance: milestoneDetail,
      recentActivity: activityDetail,
    };

    // Detect risks
    const risks = this.riskEngine.detectRisks(
      project,
      dependencies,
      criticalPathTaskIds,
      now,
    );

    // Generate forecast
    const forecast = this.forecastEngine.forecastProject(project, now);

    // Generate recommendations
    const recommendations = this.recommendationsEngine.generateRecommendations(
      project,
      risks,
    );

    const activeRisksCount = {
      total: risks.length,
      critical: risks.filter(r => r.severity === 'CRITICAL').length,
      high: risks.filter(r => r.severity === 'HIGH').length,
      medium: risks.filter(r => r.severity === 'MEDIUM').length,
      low: risks.filter(r => r.severity === 'LOW').length,
    };

    // Determine final score and classification
    let overallScore: number | null = null;
    let classification: HealthClassification;
    let explanation = '';

    if (isExcluded) {
      classification = 'EXCLUDED';
      overallScore = null;
      explanation = project.status === 'COMPLETED' ? 'Project is marked completed.' : 'Project is archived.';
    } else if (allCountableTasks.length === 0) {
      classification = 'INSUFFICIENT_DATA';
      overallScore = null;
      explanation = 'No tasks have been created in this project. Add tasks and deadlines to enable health tracking.';
    } else {
      const w = this.config.weights;
      overallScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            taskCompletionDetail.score * w.taskCompletion +
              deadlineDetail.score * w.deadlinePerformance +
              blockersDetail.score * w.blockersAndDependencies +
              milestoneDetail.score * w.milestonePerformance +
              activityDetail.score * w.recentActivity,
          ),
        ),
      );

      if (overallScore >= this.config.thresholds.healthyMinScore) {
        classification = 'HEALTHY';
        explanation = `Project is in good health (${overallScore}/100) with strong deadline performance and minimal blockers.`;
      } else if (overallScore >= this.config.thresholds.atRiskMinScore) {
        classification = 'AT_RISK';
        explanation = `Project is at risk (${overallScore}/100) due to ${risks.length} active risk(s) affecting completion pace.`;
      } else {
        classification = 'CRITICAL';
        explanation = `Project is in critical condition (${overallScore}/100). Critical blockers, overdue items, or dependency gridlocks require immediate intervention.`;
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      score: overallScore,
      classification,
      algorithmVersion: this.config.algorithmVersion,
      dataCompleteness: completeness,
      dimensionScores,
      activeRisksCount,
      risks,
      forecast,
      recommendations,
      explanation,
      calculatedAt: now,
    };
  }

  private calculateDataCompleteness(
    project: ProjectDataForRisk,
    tasks: Array<{ dueDate: Date | null; assigneeId: string | null }>,
  ): number {
    if (tasks.length === 0) return 0.05;

    let points = 0;
    // Task volume points (up to 0.35)
    points += tasks.length >= 5 ? 0.35 : tasks.length >= 2 ? 0.25 : 0.15;

    // Due date coverage points (up to 0.25)
    const withDueDate = tasks.filter(t => t.dueDate !== null).length;
    points += (withDueDate / tasks.length) * 0.25;

    // Assignee coverage points (up to 0.20)
    const withAssignee = tasks.filter(t => t.assigneeId !== null).length;
    points += (withAssignee / tasks.length) * 0.20;

    // Project due date points (0.10)
    if (project.dueDate) points += 0.10;

    // Milestone points (0.10)
    if (project.milestones.length > 0) points += 0.10;

    return Number(Math.min(1.0, points).toFixed(2));
  }

  private calculateTaskCompletionScore(
    project: ProjectDataForRisk,
    allTasks: ProjectDataForRisk['tasks'],
    completedTasks: ProjectDataForRisk['tasks'],
    activeTasks: ProjectDataForRisk['tasks'],
    now: Date,
  ): DimensionScores['taskCompletion'] {
    const total = allTasks.length;
    if (total === 0) {
      return {
        score: 50,
        weight: this.config.weights.taskCompletion,
        weightedScore: 50 * this.config.weights.taskCompletion,
        metrics: { total: 0, completed: 0, active: 0, completionRate: 0 },
        notes: ['No tasks recorded.'],
      };
    }

    const completedCount = completedTasks.length;
    const inProgressCount = activeTasks.filter(
      t => t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.IN_REVIEW,
    ).length;

    // Raw completion percentage
    const rawRate = (completedCount + inProgressCount * 0.25) / total;

    // Priority-weighted progress
    let totalWeight = 0;
    let earnedWeight = 0;
    for (const t of allTasks) {
      const w = PRIORITY_WEIGHTS[t.priority] || 2;
      totalWeight += w;
      if (t.status === TaskStatus.DONE) earnedWeight += w;
      else if (t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.IN_REVIEW) earnedWeight += w * 0.25;
    }
    const weightedRate = totalWeight > 0 ? earnedWeight / totalWeight : rawRate;

    // Expected progress based on elapsed project duration
    let expectedProgressScore = 100;
    const notes: string[] = [];

    if (project.startDate && project.dueDate && project.dueDate > project.startDate) {
      const totalDuration = project.dueDate.getTime() - project.startDate.getTime();
      const elapsed = Math.max(0, now.getTime() - project.startDate.getTime());
      const expectedRatio = Math.min(1.0, elapsed / totalDuration);

      if (rawRate >= expectedRatio) {
        expectedProgressScore = 100;
        notes.push('Task completion pace matches or exceeds elapsed project schedule.');
      } else {
        const gap = expectedRatio - rawRate;
        expectedProgressScore = Math.max(0, 100 - gap * 100);
        notes.push(`Progress is trailing expected schedule by ${Math.round(gap * 100)}%.`);
      }
    } else {
      expectedProgressScore = Math.round(rawRate * 100);
      notes.push(`${completedCount} of ${total} tasks completed (${Math.round(rawRate * 100)}%).`);
    }

    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(rawRate * 50 + weightedRate * 30 + (expectedProgressScore / 100) * 20),
      ),
    );

    return {
      score,
      weight: this.config.weights.taskCompletion,
      weightedScore: Number((score * this.config.weights.taskCompletion).toFixed(2)),
      metrics: {
        total,
        completed: completedCount,
        inProgress: inProgressCount,
        completionRate: Number(rawRate.toFixed(2)),
        priorityWeightedRate: Number(weightedRate.toFixed(2)),
      },
      notes,
    };
  }

  private calculateDeadlinePerformanceScore(
    project: ProjectDataForRisk,
    activeTasks: ProjectDataForRisk['tasks'],
    criticalPathTaskIds: Set<string>,
    now: Date,
  ): DimensionScores['deadlinePerformance'] {
    const tasksWithDue = activeTasks.filter(t => t.dueDate !== null);
    const notes: string[] = [];

    if (tasksWithDue.length === 0 && !project.dueDate) {
      return {
        score: 100,
        weight: this.config.weights.deadlinePerformance,
        weightedScore: 100 * this.config.weights.deadlinePerformance,
        metrics: { overdueCount: 0, tasksWithDueCount: 0 },
        notes: ['No task or project deadlines configured; defaulting to neutral baseline.'],
      };
    }

    let penalty = 0;
    const overdueTasks = tasksWithDue.filter(t => t.dueDate! < now);

    for (const t of overdueTasks) {
      const daysOverdue = Math.max(1, Math.floor((now.getTime() - t.dueDate!.getTime()) / 86400000));
      const ageMultiplier = Math.min(2.0, 1.0 + daysOverdue / 14);

      let taskPenalty = 5;
      if (t.priority === Priority.URGENT) taskPenalty = 25;
      else if (t.priority === Priority.HIGH) taskPenalty = 15;
      else if (t.priority === Priority.MEDIUM) taskPenalty = 8;
      else taskPenalty = 3; // 1 low priority task is only ~3 pts penalty, preserving prompt rule

      if (criticalPathTaskIds.has(t.id)) {
        taskPenalty += 10;
      }

      penalty += taskPenalty * ageMultiplier;
    }

    // Check project due date
    if (project.dueDate && project.dueDate < now && activeTasks.length > 0) {
      const daysPastProjectDue = Math.max(1, Math.floor((now.getTime() - project.dueDate.getTime()) / 86400000));
      penalty += Math.min(45, 25 + daysPastProjectDue * 2);
      notes.push(`Project target deadline passed ${daysPastProjectDue} day(s) ago with ${activeTasks.length} incomplete tasks.`);
    }

    if (overdueTasks.length > 0) {
      notes.push(`${overdueTasks.length} task(s) are overdue.`);
    } else {
      notes.push('All scheduled tasks are on or ahead of deadline.');
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    return {
      score,
      weight: this.config.weights.deadlinePerformance,
      weightedScore: Number((score * this.config.weights.deadlinePerformance).toFixed(2)),
      metrics: {
        overdueCount: overdueTasks.length,
        tasksWithDueCount: tasksWithDue.length,
        penalty: Math.round(penalty),
      },
      notes,
    };
  }

  private calculateBlockersAndDependenciesScore(
    activeTasks: ProjectDataForRisk['tasks'],
    dependencies: Array<{ blockingTaskId: string; blockedTaskId: string }>,
    criticalPathTaskIds: Set<string>,
    now: Date,
  ): DimensionScores['blockersAndDependencies'] {
    if (activeTasks.length === 0) {
      return {
        score: 100,
        weight: this.config.weights.blockersAndDependencies,
        weightedScore: 100 * this.config.weights.blockersAndDependencies,
        metrics: { blockedCount: 0 },
        notes: ['No active tasks in project.'],
      };
    }

    let penalty = 0;
    const notes: string[] = [];

    // Map downstream blocks
    const taskDownstreamMap = new Map<string, number>();
    for (const dep of dependencies) {
      taskDownstreamMap.set(dep.blockingTaskId, (taskDownstreamMap.get(dep.blockingTaskId) || 0) + 1);
    }

    // Identify blocked tasks
    const blockedTasks = activeTasks.filter(
      t => t.status === TaskStatus.BLOCKED || t.blockedBy.length > 0,
    );

    for (const t of blockedTasks) {
      let taskPenalty = 10;
      if (t.priority === Priority.URGENT) taskPenalty = 25;
      else if (t.priority === Priority.HIGH) taskPenalty = 18;
      else if (t.priority === Priority.LOW) taskPenalty = 5;

      if (criticalPathTaskIds.has(t.id)) {
        taskPenalty += 12;
      }

      // Check duration of blocker (stale blocker)
      const daysSinceUpdate = Math.floor((now.getTime() - t.updatedAt.getTime()) / 86400000);
      if (daysSinceUpdate >= 7) {
        taskPenalty += 6;
      }

      penalty += taskPenalty;
    }

    // Check for bottleneck tasks (single task blocking 3+ items)
    for (const t of activeTasks) {
      const downstreamCount = taskDownstreamMap.get(t.id) || 0;
      if (downstreamCount >= 3) {
        penalty += 15;
        notes.push(`Bottleneck: Task "${t.title.slice(0, 40)}" blocks ${downstreamCount} downstream tasks.`);
      }
    }

    if (blockedTasks.length > 0) {
      notes.push(`${blockedTasks.length} task(s) are blocked by dependencies.`);
    } else {
      notes.push('No blocked tasks or dependency bottlenecks detected.');
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    return {
      score,
      weight: this.config.weights.blockersAndDependencies,
      weightedScore: Number((score * this.config.weights.blockersAndDependencies).toFixed(2)),
      metrics: {
        blockedCount: blockedTasks.length,
        bottlenecksCount: [...taskDownstreamMap.values()].filter(c => c >= 3).length,
        penalty: Math.round(penalty),
      },
      notes,
    };
  }

  private calculateMilestonePerformanceScore(
    project: ProjectDataForRisk,
    activeTasks: ProjectDataForRisk['tasks'],
    now: Date,
  ): DimensionScores['milestonePerformance'] {
    const total = project.milestones.length;
    const notes: string[] = [];

    if (total === 0) {
      // Neutral baseline matching project progress
      const defaultScore = 85;
      return {
        score: defaultScore,
        weight: this.config.weights.milestonePerformance,
        weightedScore: Number((defaultScore * this.config.weights.milestonePerformance).toFixed(2)),
        metrics: { total: 0, completed: 0, overdue: 0 },
        notes: ['No milestones configured for this project; neutral baseline applied.'],
      };
    }

    const completed = project.milestones.filter(m => m.completedAt !== null).length;
    const completionRatio = completed / total;

    let penalty = 0;
    const overdueMilestones = project.milestones.filter(
      m => !m.completedAt && m.targetDate && m.targetDate < now,
    );

    if (overdueMilestones.length > 0) {
      penalty += overdueMilestones.length * 35;
      notes.push(`${overdueMilestones.length} milestone(s) are overdue.`);
    }

    const next14Days = new Date(now.getTime() + 14 * 86400000);
    const nearMilestones = project.milestones.filter(
      m => !m.completedAt && m.targetDate && m.targetDate >= now && m.targetDate <= next14Days,
    );

    const hasActiveRisks = activeTasks.some(
      t => t.status === TaskStatus.BLOCKED || (t.dueDate && t.dueDate < now),
    );

    if (nearMilestones.length > 0 && hasActiveRisks) {
      penalty += 15;
      notes.push('Upcoming milestone due within 14 days is threatened by overdue or blocked tasks.');
    }

    const baseScore = completionRatio * 60 + 40;
    const score = Math.max(0, Math.min(100, Math.round(baseScore - penalty)));

    if (overdueMilestones.length === 0 && !hasActiveRisks) {
      notes.push(`${completed} of ${total} milestones completed on schedule.`);
    }

    return {
      score,
      weight: this.config.weights.milestonePerformance,
      weightedScore: Number((score * this.config.weights.milestonePerformance).toFixed(2)),
      metrics: {
        total,
        completed,
        overdue: overdueMilestones.length,
        completionRatio: Number(completionRatio.toFixed(2)),
      },
      notes,
    };
  }

  private calculateRecentActivityScore(
    project: ProjectDataForRisk,
    completedTasks: ProjectDataForRisk['tasks'],
    now: Date,
  ): DimensionScores['recentActivity'] {
    const allActivityDates: Date[] = [
      project.updatedAt,
      ...project.tasks.map(t => t.updatedAt),
      ...(project.comments?.map(c => c.createdAt) || []),
      ...(project.githubEvents?.map(e => e.createdAt) || []),
      ...(project.meetingActionItems?.map(a => a.createdAt) || []),
    ];

    const latest = allActivityDates.length
      ? new Date(Math.max(...allActivityDates.map(d => d.getTime())))
      : project.createdAt;

    const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - latest.getTime()) / 86400000));
    const notes: string[] = [];

    let score = 100;
    if (daysSinceActivity <= 3) {
      score = 100;
      notes.push('Active work recorded within the last 3 days.');
    } else if (daysSinceActivity <= 7) {
      // 4-7 days: normal weekend/break buffer
      score = 92;
      notes.push(`Last activity recorded ${daysSinceActivity} days ago.`);
    } else if (daysSinceActivity <= 14) {
      score = 75;
      notes.push(`Project has been quiet for ${daysSinceActivity} days.`);
    } else if (daysSinceActivity <= 28) {
      score = 45;
      notes.push(`Project momentum is low; no activity in ${daysSinceActivity} days.`);
    } else {
      score = 20;
      notes.push(`Project is stale; no updates for ${daysSinceActivity} days.`);
    }

    // Velocity bonus if tasks were completed in last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const recentCompletions = completedTasks.filter(
      t => t.completedAt && t.completedAt >= sevenDaysAgo,
    ).length;

    if (recentCompletions >= 2) {
      score = Math.min(100, score + 8);
      notes.push(`Positive momentum: ${recentCompletions} tasks completed in the last 7 days.`);
    }

    return {
      score,
      weight: this.config.weights.recentActivity,
      weightedScore: Number((score * this.config.weights.recentActivity).toFixed(2)),
      metrics: {
        daysSinceActivity,
        recentCompletionsCount: recentCompletions,
      },
      notes,
    };
  }
}
