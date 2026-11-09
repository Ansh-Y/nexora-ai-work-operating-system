import { OrganizationRole, Priority, TaskStatus } from '@prisma/client';

export type CandidateRole = OrganizationRole;

export interface AssigneeCandidate {
  id: string;
  name: string;
  email: string;
  role: CandidateRole;
}

export interface CandidateWorkloadStats {
  activeTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  projectTasks: number;
  completedTasks: number;
}

export interface CandidateScoreBreakdown {
  workloadCapacityScore: number;       // 0 - 35
  scheduleCompatibilityScore: number;  // 0 - 25
  domainSkillScore: number;            // 0 - 25
  projectRoleFitScore: number;         // 0 - 15
  totalScore: number;                  // 0 - 100
}

export type RecommendationTier = 'STRONG_MATCH' | 'GOOD_MATCH' | 'ALTERNATIVE';

export interface AssignmentRecommendation {
  candidate: AssigneeCandidate;
  score: number;
  tier: RecommendationTier;
  breakdown: CandidateScoreBreakdown;
  reasons: string[];
  concerns: string[];
  workload: CandidateWorkloadStats;
}

export interface TargetTaskInfo {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  description?: string | null;
  priority: Priority;
  dueDate?: Date | string | null;
  labels?: string[];
  currentAssigneeId?: string | null;
}

export interface TaskAssignmentContext {
  task: TargetTaskInfo;
  candidates: AssigneeCandidate[];
  workspaceTasks: {
    id: string;
    projectId: string;
    assigneeId: string | null;
    title: string;
    description?: string | null;
    status: TaskStatus;
    priority: Priority;
    dueDate?: Date | string | null;
    labels?: string[];
  }[];
}

export interface TaskAssignmentAnalysisResult {
  taskId: string;
  taskTitle: string;
  dueDate: string | null;
  priority: Priority;
  labels: string[];
  currentAssigneeId: string | null;
  recommendations: AssignmentRecommendation[];
  missingInfo: string[];
  totalEligibleMembers: number;
}

// Common stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'this', 'our', 'all', 'any', 'each', 'from', 'into', 'than',
  'task', 'project', 'implement', 'create', 'update', 'build', 'review',
]);

export function extractDomainKeywords(text: string, labels: string[] = []): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const normalizedLabels = labels.map(l => l.toLowerCase().trim()).filter(Boolean);
  const combined = Array.from(new Set([...words, ...normalizedLabels]));
  return combined;
}

export class TaskAssignmentEngine {
  /**
   * Evaluates candidates deterministically using grounded workspace facts.
   * Pure function: no database calls, no network I/O, completely testable.
   */
  static analyzeAndRecommend(context: TaskAssignmentContext): TaskAssignmentAnalysisResult {
    const { task, candidates, workspaceTasks } = context;
    const now = new Date();
    const taskDueDate = task.dueDate ? new Date(task.dueDate) : null;
    const targetKeywords = extractDomainKeywords(
      `${task.title} ${task.description || ''}`,
      task.labels || []
    );

    const missingInfo: string[] = [];
    if (!taskDueDate) {
      missingInfo.push('Target task has no due date set; schedule conflict analysis cannot be fully evaluated.');
    }
    if ((!task.labels || task.labels.length === 0) && (!task.description || task.description.trim().length < 15)) {
      missingInfo.push('Task has no skill labels and minimal description; domain matching is based on title keywords only.');
    }

    // Filter out candidates who cannot receive task assignments (e.g. VIEWER role)
    const eligibleCandidates = candidates.filter(c => c.role !== OrganizationRole.VIEWER);

    const recommendations: AssignmentRecommendation[] = eligibleCandidates.map(candidate => {
      const reasons: string[] = [];
      const concerns: string[] = [];

      // Gather candidate tasks
      const candidateTasks = workspaceTasks.filter(t => t.assigneeId === candidate.id);
      const activeTasks = candidateTasks.filter(
        t => t.status === TaskStatus.TODO || t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.BLOCKED
      );
      const inProgressTasks = candidateTasks.filter(t => t.status === TaskStatus.IN_PROGRESS);
      const blockedTasks = candidateTasks.filter(t => t.status === TaskStatus.BLOCKED);
      const completedTasks = candidateTasks.filter(t => t.status === TaskStatus.DONE);
      const projectTasks = candidateTasks.filter(t => t.projectId === task.projectId);

      const overdueTasks = activeTasks.filter(t => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d < now;
      });

      const stats: CandidateWorkloadStats = {
        activeTasks: activeTasks.length,
        inProgressTasks: inProgressTasks.length,
        blockedTasks: blockedTasks.length,
        overdueTasks: overdueTasks.length,
        projectTasks: projectTasks.length,
        completedTasks: completedTasks.length,
      };

      // 1. Workload & Capacity Score (Weight: 35 max)
      // Low active load = high capacity. Heavy active load = capacity penalty.
      let workloadFactor: number;
      if (stats.activeTasks <= 1) {
        workloadFactor = 1.0;
        reasons.push(
          stats.activeTasks === 0
            ? 'Optimal availability: no active tasks currently in flight.'
            : 'Low active workload: currently assigned only 1 active task.'
        );
      } else if (stats.activeTasks === 2) {
        workloadFactor = 0.85;
        reasons.push('Moderate workload: currently managing 2 active deliverables.');
      } else if (stats.activeTasks === 3) {
        workloadFactor = 0.70;
        reasons.push('Manageable workload: currently assigned 3 active tasks.');
      } else if (stats.activeTasks === 4) {
        workloadFactor = 0.50;
        concerns.push('High active task count: currently balancing 4 deliverables.');
      } else {
        workloadFactor = Math.max(0.20, 0.50 - (stats.activeTasks - 4) * 0.10);
        concerns.push(`Heavy active workload: candidate has ${stats.activeTasks} ongoing tasks across the workspace.`);
      }

      // Overdue penalty on workload factor
      if (stats.overdueTasks > 0) {
        const penalty = Math.min(0.40, stats.overdueTasks * 0.20);
        workloadFactor = Math.max(0.05, workloadFactor - penalty);
        concerns.push(
          `Capacity risk: candidate has ${stats.overdueTasks} overdue ${
            stats.overdueTasks === 1 ? 'task' : 'tasks'
          } requiring resolution.`
        );
      }

      const workloadCapacityScore = Math.round(workloadFactor * 35);

      // 2. Schedule & Deadline Compatibility Score (Weight: 25 max)
      let scheduleFactor: number;
      if (!taskDueDate) {
        // Neutral baseline if target task has no due date
        scheduleFactor = 0.80;
      } else {
        const targetTime = taskDueDate.getTime();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        // Check for conflicting due dates in candidate's active tasks
        let directClash = false;
        let nearClashCount = 0;

        for (const t of activeTasks) {
          if (!t.dueDate) continue;
          const dueTime = new Date(t.dueDate).getTime();
          const diffDays = Math.abs(dueTime - targetTime) / ONE_DAY_MS;

          if (diffDays < 0.5) {
            directClash = true;
          } else if (diffDays <= 2.0) {
            nearClashCount++;
          }
        }

        if (directClash) {
          scheduleFactor = 0.40;
          concerns.push(`Deadline clash: candidate already has a deliverable due on or within hours of this target date.`);
        } else if (nearClashCount > 0) {
          scheduleFactor = 0.65;
          concerns.push(`Schedule density: candidate has ${nearClashCount} other ${nearClashCount === 1 ? 'task' : 'tasks'} due within 48 hours of this deadline.`);
        } else {
          scheduleFactor = 1.0;
          reasons.push('Schedule clear: no competing task deadlines near this target completion date.');
        }
      }

      const scheduleCompatibilityScore = Math.round(scheduleFactor * 25);

      // 3. Domain & Skill Relevance (Weight: 25 max)
      // Extract matches between target keywords and candidate's past/current tasks
      const matchedKeywords = new Set<string>();
      let candidateDomainTaskCount = 0;

      for (const t of candidateTasks) {
        const taskLabels = (t.labels || []).map(l => l.toLowerCase());
        const taskText = `${t.title} ${t.description || ''}`.toLowerCase();

        let hasMatch = false;
        for (const kw of targetKeywords) {
          if (taskLabels.includes(kw) || taskText.includes(kw)) {
            matchedKeywords.add(kw);
            hasMatch = true;
          }
        }
        if (hasMatch) {
          candidateDomainTaskCount++;
        }
      }

      let domainFactor: number;
      if (targetKeywords.length === 0) {
        // Generic task without specific keywords
        domainFactor = 0.70;
      } else if (matchedKeywords.size >= 2 || candidateDomainTaskCount >= 3) {
        domainFactor = 1.0;
        const kwList = Array.from(matchedKeywords).slice(0, 3).map(k => `"${k}"`).join(', ');
        reasons.push(
          `Relevant domain experience: handled ${candidateDomainTaskCount} tasks in this workspace matching domain keywords (${kwList}).`
        );
      } else if (matchedKeywords.size === 1 || candidateDomainTaskCount >= 1) {
        domainFactor = 0.85;
        const kwList = Array.from(matchedKeywords).slice(0, 2).map(k => `"${k}"`).join(', ');
        reasons.push(`Prior experience with related deliverables matching keyword ${kwList}.`);
      } else {
        // No domain history
        domainFactor = 0.50;
        reasons.push('Available for assignment (no prior task history directly matching these keywords).');
      }

      const domainSkillScore = Math.round(domainFactor * 25);

      // 4. Project Familiarity & Role Fit (Weight: 15 max)
      let roleFitFactor: number;
      if (stats.projectTasks > 0) {
        roleFitFactor = 1.0;
        reasons.push(`Project continuity: actively involved in "${task.projectName || 'this project'}" with ${stats.projectTasks} associated tasks.`);
      } else {
        roleFitFactor = 0.75;
      }

      // Priority alignment: for URGENT/HIGH tasks, prefer candidate with low active load
      if (task.priority === Priority.URGENT || task.priority === Priority.HIGH) {
        if (stats.activeTasks <= 2 && stats.overdueTasks === 0) {
          reasons.push(`High-priority alignment: low active commitments allow dedicated focus on ${task.priority.toLowerCase()} work.`);
        } else if (stats.activeTasks >= 4) {
          concerns.push(`High priority task assigned to candidate with heavy ongoing queue.`);
        }
      }

      const projectRoleFitScore = Math.round(roleFitFactor * 15);
      const totalScore = Math.min(100, workloadCapacityScore + scheduleCompatibilityScore + domainSkillScore + projectRoleFitScore);

      let tier: RecommendationTier;
      if (totalScore >= 80) {
        tier = 'STRONG_MATCH';
      } else if (totalScore >= 60) {
        tier = 'GOOD_MATCH';
      } else {
        tier = 'ALTERNATIVE';
      }

      return {
        candidate,
        score: totalScore,
        tier,
        breakdown: {
          workloadCapacityScore,
          scheduleCompatibilityScore,
          domainSkillScore,
          projectRoleFitScore,
          totalScore,
        },
        reasons,
        concerns,
        workload: stats,
      };
    });

    // Sort descending by total score, then by lowest active tasks as tie-breaker
    recommendations.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.workload.activeTasks - b.workload.activeTasks;
    });

    // Select top 3 candidates
    const top3 = recommendations.slice(0, 3);

    return {
      taskId: task.id,
      taskTitle: task.title,
      dueDate: taskDueDate ? taskDueDate.toISOString() : null,
      priority: task.priority,
      labels: task.labels || [],
      currentAssigneeId: task.currentAssigneeId || null,
      recommendations: top3,
      missingInfo,
      totalEligibleMembers: eligibleCandidates.length,
    };
  }
}
