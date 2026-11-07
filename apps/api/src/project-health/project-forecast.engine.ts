import { TaskStatus } from '@prisma/client';
import { ForecastResult } from './project-health.types';
import { ProjectDataForRisk } from './predictive-risk.engine';

export class ProjectForecastEngine {
  forecastProject(project: ProjectDataForRisk, now = new Date()): ForecastResult {
    const activeTasks = project.tasks.filter(
      t => t.status !== TaskStatus.DONE && t.status !== TaskStatus.CANCELLED,
    );
    const completedTasks = project.tasks.filter(t => t.status === TaskStatus.DONE);
    const blockedCount = activeTasks.filter(t => t.status === TaskStatus.BLOCKED || t.blockedBy.length > 0).length;
    const overdueCount = activeTasks.filter(t => t.dueDate && t.dueDate < now).length;

    const reasons: string[] = [];

    // If project has no tasks at all
    if (project.tasks.length === 0) {
      return {
        trend: 'INSUFFICIENT_DATA',
        estimatedCompletionDate: null,
        daysProjectedVariance: null,
        remainingWorkload: 0,
        completionVelocityWeekly: 0,
        confidence: 'LOW',
        reasons: ['No tasks exist in this project to generate a completion forecast.'],
      };
    }

    // If all tasks are completed
    if (activeTasks.length === 0 && completedTasks.length > 0) {
      return {
        trend: 'ON_TRACK',
        estimatedCompletionDate: now.toISOString().slice(0, 10),
        daysProjectedVariance: project.dueDate
          ? Math.round((now.getTime() - project.dueDate.getTime()) / 86400000)
          : null,
        remainingWorkload: 0,
        completionVelocityWeekly: 0,
        confidence: 'HIGH',
        reasons: ['All project tasks have been completed.'],
      };
    }

    // Historical completion velocity (30-day window)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const recentCompleted = completedTasks.filter(
      t => t.completedAt && t.completedAt >= thirtyDaysAgo,
    );

    const hasSufficientData = recentCompleted.length >= 2;
    let weeklyVelocity = 0;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    let estimatedCompletionDate: Date;

    if (hasSufficientData) {
      weeklyVelocity = Number(((recentCompleted.length / 30) * 7).toFixed(2));
      confidence = recentCompleted.length >= 5 ? 'HIGH' : 'MEDIUM';
      const weeksToComplete = Math.max(0.2, activeTasks.length / Math.max(0.5, weeklyVelocity));
      estimatedCompletionDate = new Date(now.getTime() + weeksToComplete * 7 * 86400000);
    } else {
      // Explainable heuristic fallback: baseline estimation assuming 2.5 tasks/week
      weeklyVelocity = 2.5;
      confidence = 'LOW';
      reasons.push(
        'Forecast uses baseline workload heuristics due to limited historical velocity (<2 tasks completed in last 30 days).',
      );
      const weeksToComplete = Math.max(0.5, activeTasks.length / weeklyVelocity);
      estimatedCompletionDate = new Date(now.getTime() + weeksToComplete * 7 * 86400000);
    }

    let trend: ForecastResult['trend'] = 'ON_TRACK';
    let daysProjectedVariance: number | null = null;

    if (!project.dueDate) {
      reasons.push('No project target deadline configured to calculate deadline variance.');
    } else {
      daysProjectedVariance = Math.round(
        (estimatedCompletionDate.getTime() - project.dueDate.getTime()) / 86400000,
      );

      if (daysProjectedVariance > 5) {
        trend = 'LIKELY_DELAYED';
        reasons.push(
          `Projected completion (${estimatedCompletionDate.toISOString().slice(0, 10)}) is ${daysProjectedVariance} day(s) past the project deadline.`,
        );
      } else if (daysProjectedVariance > 0) {
        trend = 'AT_RISK_OF_DELAY';
        reasons.push(
          `Projected completion is within ${daysProjectedVariance} day(s) past deadline. Minor delays will cause deadline slippage.`,
        );
      } else {
        trend = 'ON_TRACK';
        reasons.push(
          `Project is on track to finish ${Math.abs(daysProjectedVariance)} day(s) before deadline at current velocity.`,
        );
      }
    }

    if (blockedCount > 0) {
      reasons.push(`${blockedCount} active blocked task(s) may further delay progress if not resolved promptly.`);
    }

    if (overdueCount > 0) {
      reasons.push(`${overdueCount} task(s) are already overdue and require rescheduling.`);
    }

    return {
      trend,
      estimatedCompletionDate: estimatedCompletionDate.toISOString().slice(0, 10),
      daysProjectedVariance,
      remainingWorkload: activeTasks.length,
      completionVelocityWeekly: weeklyVelocity,
      confidence,
      reasons,
    };
  }
}
