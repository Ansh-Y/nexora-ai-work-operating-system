import { ScoringWeights } from './project-health.types';

export interface ProjectHealthConfig {
  algorithmVersion: string;
  weights: ScoringWeights;
  thresholds: {
    healthyMinScore: number;
    atRiskMinScore: number;
    criticalMaxScore: number;
  };
  stalenessDays: number;
  milestoneHorizonDays: number;
  upcomingDeadlineHorizonDays: number;
  maxHistoricalSnapshotAgeDays: number;
}

export const DEFAULT_HEALTH_CONFIG: ProjectHealthConfig = {
  algorithmVersion: '1.0.0',
  weights: {
    taskCompletion: 0.25,
    deadlinePerformance: 0.25,
    blockersAndDependencies: 0.25,
    milestonePerformance: 0.15,
    recentActivity: 0.10,
  },
  thresholds: {
    healthyMinScore: 80,
    atRiskMinScore: 50,
    criticalMaxScore: 49,
  },
  stalenessDays: 14,
  milestoneHorizonDays: 14,
  upcomingDeadlineHorizonDays: 7,
  maxHistoricalSnapshotAgeDays: 90,
};

export function getHealthConfig(overrides?: Partial<ProjectHealthConfig>): ProjectHealthConfig {
  if (!overrides) return DEFAULT_HEALTH_CONFIG;
  return {
    ...DEFAULT_HEALTH_CONFIG,
    ...overrides,
    weights: {
      ...DEFAULT_HEALTH_CONFIG.weights,
      ...(overrides.weights || {}),
    },
    thresholds: {
      ...DEFAULT_HEALTH_CONFIG.thresholds,
      ...(overrides.thresholds || {}),
    },
  };
}
