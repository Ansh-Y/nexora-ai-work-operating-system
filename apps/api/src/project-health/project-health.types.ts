export type HealthClassification =
  | 'HEALTHY'
  | 'AT_RISK'
  | 'CRITICAL'
  | 'INSUFFICIENT_DATA'
  | 'EXCLUDED';

export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type RiskType =
  | 'OVERDUE_TASKS'
  | 'INSUFFICIENT_PROGRESS'
  | 'BLOCKED_HIGH_PRIORITY'
  | 'DEPENDENCY_BOTTLENECK'
  | 'MULTI_DOWNSTREAM_BLOCK'
  | 'MILESTONE_AT_RISK'
  | 'DECLINING_MOMENTUM'
  | 'UNASSIGNED_HIGH_PRIORITY'
  | 'STALE_PROJECT'
  | 'HIGH_WORKLOAD_UPCOMING';

export interface ScoringWeights {
  taskCompletion: number;
  deadlinePerformance: number;
  blockersAndDependencies: number;
  milestonePerformance: number;
  recentActivity: number;
}

export interface DimensionScoreDetail {
  score: number; // 0 - 100
  weight: number; // 0.0 - 1.0
  weightedScore: number;
  metrics: Record<string, any>;
  notes: string[];
}

export interface DimensionScores {
  taskCompletion: DimensionScoreDetail;
  deadlinePerformance: DimensionScoreDetail;
  blockersAndDependencies: DimensionScoreDetail;
  milestonePerformance: DimensionScoreDetail;
  recentActivity: DimensionScoreDetail;
}

export interface ForecastResult {
  trend: 'ON_TRACK' | 'AT_RISK_OF_DELAY' | 'LIKELY_DELAYED' | 'INSUFFICIENT_DATA';
  estimatedCompletionDate: string | null;
  daysProjectedVariance: number | null; // positive = days overdue, negative = days early
  remainingWorkload: number;
  completionVelocityWeekly: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

export interface DetectedRisk {
  id?: string;
  fingerprint: string;
  riskType: RiskType;
  severity: RiskSeverity;
  status?: 'ACTIVE' | 'RESOLVED' | 'DISMISSED';
  dismissalReason?: string;
  dismissedAt?: Date;
  dismissedById?: string;
  title: string;
  explanation: string;
  evidence: {
    metrics: Record<string, any>;
    sourceReferences: Array<{ type: string; id: string; title: string }>;
  };
  recommendedAction: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  affectedTaskIds: string[];
  affectedMilestoneIds: string[];
  relevantDueDates: string[];
}

export interface RecommendedAction {
  id: string;
  riskType: RiskType;
  severity: RiskSeverity;
  problemDetected: string;
  suggestedAction: string;
  reason: string;
  expectedImpact: string;
  relatedEntities: {
    projectId: string;
    taskIds?: string[];
    milestoneIds?: string[];
    assigneeId?: string | null;
  };
  canProposeAiPlan: boolean;
}

export interface HealthCalculationResult {
  projectId: string;
  projectName: string;
  score: number | null;
  classification: HealthClassification;
  algorithmVersion: string;
  dataCompleteness: number; // 0.0 - 1.0
  dimensionScores: DimensionScores;
  activeRisksCount: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  risks: DetectedRisk[];
  forecast: ForecastResult;
  recommendations: RecommendedAction[];
  explanation: string;
  calculatedAt: Date;
}
