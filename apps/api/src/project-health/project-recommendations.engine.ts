import { DetectedRisk, RecommendedAction } from './project-health.types';
import { ProjectDataForRisk } from './predictive-risk.engine';

export class ProjectRecommendationsEngine {
  generateRecommendations(
    project: ProjectDataForRisk,
    risks: DetectedRisk[],
  ): RecommendedAction[] {
    const recommendations: RecommendedAction[] = [];

    for (const risk of risks) {
      switch (risk.riskType) {
        case 'OVERDUE_TASKS': {
          const overdueTasks = project.tasks.filter(t => risk.affectedTaskIds.includes(t.id));
          const urgentOrHigh = overdueTasks.filter(t => t.priority === 'URGENT' || t.priority === 'HIGH');
          const targetTaskIds = urgentOrHigh.length ? urgentOrHigh.map(t => t.id) : risk.affectedTaskIds.slice(0, 3);

          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: `${overdueTasks.length} task(s) are overdue past their deadline.`,
            suggestedAction: 'Reschedule overdue task dates or reallocate tasks among active team members.',
            reason: 'Past-due deliverables lower project health score and create cascading delays for downstream milestones.',
            expectedImpact: 'Restores deadline performance dimension and prevents scheduling conflict warnings.',
            relatedEntities: {
              projectId: project.id,
              taskIds: targetTaskIds,
            },
            canProposeAiPlan: true,
          });
          break;
        }

        case 'BLOCKED_HIGH_PRIORITY': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'Critical or High-priority deliverables are blocked by dependencies.',
            suggestedAction: 'Hold a standup with blocking task assignees to expedite unblocking actions.',
            reason: 'High-priority blocked tasks directly restrict project velocity and risk milestone delivery.',
            expectedImpact: 'Unblocks critical path work and increases task completion momentum.',
            relatedEntities: {
              projectId: project.id,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: true,
          });
          break;
        }

        case 'MULTI_DOWNSTREAM_BLOCK':
        case 'DEPENDENCY_BOTTLENECK': {
          const bottleneckTaskId = risk.affectedTaskIds[0];
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'A single dependency is gating multiple downstream tasks.',
            suggestedAction: 'Decompose the bottleneck task into smaller sub-tasks or parallelize independent parts.',
            reason: 'Serialized dependencies create systemic bottlenecks where team members wait on a single owner.',
            expectedImpact: 'Enables parallel task execution across team members and relieves queue congestion.',
            relatedEntities: {
              projectId: project.id,
              taskIds: [bottleneckTaskId],
            },
            canProposeAiPlan: true,
          });
          break;
        }

        case 'MILESTONE_AT_RISK': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'Upcoming or past milestones are threatened by overdue tasks and blockers.',
            suggestedAction: 'Review milestone scope, adjust milestone target date, or postpone non-essential tasks.',
            reason: 'Milestone completion is a core stakeholder health signal representing key delivery commitments.',
            expectedImpact: 'Aligns stakeholder expectations and protects team delivery focus.',
            relatedEntities: {
              projectId: project.id,
              milestoneIds: risk.affectedMilestoneIds,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: false,
          });
          break;
        }

        case 'UNASSIGNED_HIGH_PRIORITY': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'High-priority or critical-path work items lack designated owners.',
            suggestedAction: 'Assign an owner to each unassigned high-priority task immediately.',
            reason: 'Unowned work items have a significantly higher rate of deadline slippage and abandonment.',
            expectedImpact: 'Establishes clear accountability and ensures task progress is tracked.',
            relatedEntities: {
              projectId: project.id,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: true,
          });
          break;
        }

        case 'DECLINING_MOMENTUM': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'Zero tasks have been completed over the past 14 days.',
            suggestedAction: 'Review task sizes with assignees and encourage breaking active work into smaller reviewable increments.',
            reason: 'Extended periods without completed tasks typically indicate hidden blockers, overscoped tasks, or stalled work.',
            expectedImpact: 'Restores visible team velocity and improves momentum scoring.',
            relatedEntities: {
              projectId: project.id,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: false,
          });
          break;
        }

        case 'INSUFFICIENT_PROGRESS': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'Tasks due within 7 days remain in To Do status.',
            suggestedAction: 'Check in with assignees to confirm task readiness and commence active work.',
            reason: 'Work that is not started until the last minute frequently overruns deadlines.',
            expectedImpact: 'Surfaces early impediments before deadline day.',
            relatedEntities: {
              projectId: project.id,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: false,
          });
          break;
        }

        case 'HIGH_WORKLOAD_UPCOMING': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'High percentage of remaining tasks with deadline approaching in under 7 days.',
            suggestedAction: 'Scope down the release candidate to core must-haves and move secondary tasks to a future phase.',
            reason: 'Excessive remaining workload in final days leads to rushed delivery and compromised quality.',
            expectedImpact: 'Secures on-time delivery for vital requirements.',
            relatedEntities: {
              projectId: project.id,
              taskIds: risk.affectedTaskIds,
            },
            canProposeAiPlan: true,
          });
          break;
        }

        case 'STALE_PROJECT': {
          recommendations.push({
            id: `rec-${risk.fingerprint}`,
            riskType: risk.riskType,
            severity: risk.severity,
            problemDetected: 'No project activity, comments, or task updates recorded for more than 14 days.',
            suggestedAction: 'Post a project status check-in comment or archive the project if completed.',
            reason: 'Dormant projects clutter workspace priorities and skew health metrics.',
            expectedImpact: 'Keeps the workspace clean and focused on active priorities.',
            relatedEntities: {
              projectId: project.id,
            },
            canProposeAiPlan: false,
          });
          break;
        }
      }
    }

    return recommendations;
  }
}
