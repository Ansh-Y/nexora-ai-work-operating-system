"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Info,
  LoaderCircle,
  Sparkles,
  User,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface CandidateWorkloadStats {
  activeTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  projectTasks: number;
  completedTasks: number;
}

export interface CandidateScoreBreakdown {
  workloadCapacityScore: number;
  scheduleCompatibilityScore: number;
  domainSkillScore: number;
  projectRoleFitScore: number;
  totalScore: number;
}

export interface AssignmentRecommendation {
  candidate: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  score: number;
  tier: "STRONG_MATCH" | "GOOD_MATCH" | "ALTERNATIVE";
  breakdown: CandidateScoreBreakdown;
  reasons: string[];
  concerns: string[];
  workload: CandidateWorkloadStats;
}

export interface SmartAssignmentResponse {
  taskId: string;
  taskTitle: string;
  dueDate: string | null;
  priority: string;
  labels: string[];
  currentAssigneeId: string | null;
  recommendations: AssignmentRecommendation[];
  missingInfo: string[];
  totalEligibleMembers: number;
}

function initials(name = "Member") {
  return name
    .split(" ")
    .map(x => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function dueLabel(date?: string | null) {
  if (!date) return "No due date";
  const d = new Date(date);
  const today = new Date();
  const days = Math.ceil(
    (new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400000
  );
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${d.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}

export function SmartAssignmentModal({
  task,
  onClose,
  onAssigned,
}: {
  task: {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    dueDate?: string | null;
    assignee?: { id: string; name: string } | null;
    labels?: string[];
  };
  onClose: () => void;
  onAssigned: (taskId: string, assignee: { id: string; name: string }) => void;
}) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SmartAssignmentResponse | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get(`/ai/tasks/${task.id}/recommend-assignee`)
      .then((res: any) => {
        if (!cancelled) {
          setData(res as SmartAssignmentResponse);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : err?.message || "Failed to analyze team recommendations."
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [task.id]);

  async function handleApproveAssignment(candidate: { id: string; name: string }) {
    try {
      setAssigningId(candidate.id);
      setError(null);
      await api.post(`/ai/tasks/${task.id}/apply-assignment`, {
        assigneeId: candidate.id,
      });
      onAssigned(task.id, candidate);
      onClose();
    } catch (err: any) {
      setError(
        err instanceof ApiError
          ? err.message
          : err?.message || "Failed to apply task assignment."
      );
      setAssigningId(null);
    }
  }

  return (
    <div
      className="modal-backdrop smart-assign-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !assigningId) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-assignment-title"
    >
      <div className="smart-assign-modal">
        {/* Header */}
        <div className="smart-assign-head">
          <div className="smart-assign-head-info">
            <div className="smart-assign-eyebrow">
              <Sparkles size={13} className="sparkle-icon" />
              <span>AI SMART TASK ASSIGNMENT</span>
            </div>
            <h2 id="smart-assignment-title" className="smart-assign-task-title">
              {task.title}
            </h2>
            <div className="smart-assign-meta-pills">
              <span className={`priority-pill ${task.priority.toLowerCase()}`}>
                <i /> {task.priority.toLowerCase()} priority
              </span>
              <span className="smart-assign-meta-pill">
                <CalendarDays size={11} /> {dueLabel(task.dueDate)}
              </span>
              {task.assignee ? (
                <span className="smart-assign-meta-pill current-assignee-pill">
                  <User size={11} /> Currently: <b>{task.assignee.name}</b>
                </span>
              ) : (
                <span className="smart-assign-meta-pill unassigned-pill">
                  <User size={11} /> Unassigned
                </span>
              )}
            </div>
          </div>
          <button
            className="icon-button smart-assign-close-btn"
            onClick={onClose}
            aria-label="Close smart assignment modal"
            disabled={!!assigningId}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="smart-assign-body">
          {loading && (
            <div className="smart-assign-loading-state">
              <LoaderCircle size={28} className="spin-animate jade-spinner" />
              <div className="smart-assign-loading-text">
                <b>Analyzing Workspace Intelligence…</b>
                <span>Evaluating team workloads, active deadlines, past domain skills, and availability</span>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="smart-assign-error-banner">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {!loading && data && (
            <>
              {/* Missing Information / Limitations Banner */}
              {data.missingInfo && data.missingInfo.length > 0 && (
                <div className="smart-assign-notice-banner">
                  <div className="notice-banner-header">
                    <Info size={13} />
                    <b>Transparent Analysis Signals</b>
                  </div>
                  <ul>
                    {data.missingInfo.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendation List */}
              <div className="smart-assign-recommendations-section">
                <div className="section-subhead">
                  <span>
                    Top Recommended Assignees ({data.recommendations.length} of {data.totalEligibleMembers} eligible members)
                  </span>
                  <small>Grounded strictly in workspace capacity and historical project records</small>
                </div>

                {data.recommendations.length === 0 ? (
                  <div className="smart-assign-empty-state">
                    <User size={24} />
                    <p>No eligible team members found in this workspace for task assignment.</p>
                  </div>
                ) : (
                  <div className="smart-assign-candidate-cards">
                    {data.recommendations.map(rec => {
                      const isCurrent = task.assignee?.id === rec.candidate.id;
                      const isAssigning = assigningId === rec.candidate.id;

                      return (
                        <div
                          key={rec.candidate.id}
                          className={`smart-assign-card tier-${rec.tier.toLowerCase()}${
                            isCurrent ? " current-assignee-card" : ""
                          }`}
                        >
                          {/* Card Header */}
                          <div className="card-top-row">
                            <div className="candidate-identity">
                              <div className="candidate-avatar">
                                {initials(rec.candidate.name)}
                              </div>
                              <div className="candidate-titles">
                                <div className="candidate-name-row">
                                  <h4 className="candidate-name">{rec.candidate.name}</h4>
                                  <span className="candidate-role-pill">
                                    {rec.candidate.role.replace("_", " ")}
                                  </span>
                                  {isCurrent && (
                                    <span className="current-badge">Current Assignee</span>
                                  )}
                                </div>
                                <span className="candidate-email">{rec.candidate.email}</span>
                              </div>
                            </div>

                            {/* Match Score Badge */}
                            <div className={`score-badge score-${rec.tier.toLowerCase()}`}>
                              <span className="score-percentage">{rec.score}%</span>
                              <span className="score-tier-label">
                                {rec.tier === "STRONG_MATCH"
                                  ? "Strong Match"
                                  : rec.tier === "GOOD_MATCH"
                                  ? "Good Match"
                                  : "Alternative"}
                              </span>
                            </div>
                          </div>

                          {/* Workload Stats Chips */}
                          <div className="candidate-stats-chips">
                            <span className="stat-chip">
                              <Zap size={11} />
                              <b>{rec.workload.activeTasks}</b> active {rec.workload.activeTasks === 1 ? "task" : "tasks"}
                            </span>
                            {rec.workload.overdueTasks > 0 ? (
                              <span className="stat-chip stat-chip-alert">
                                <Clock size={11} />
                                <b>{rec.workload.overdueTasks}</b> overdue
                              </span>
                            ) : (
                              <span className="stat-chip stat-chip-good">
                                <Check size={11} />
                                0 overdue
                              </span>
                            )}
                            <span className="stat-chip">
                              <b>{rec.workload.projectTasks}</b> in this project
                            </span>
                            <span className="stat-chip">
                              <b>{rec.workload.completedTasks}</b> completed
                            </span>
                          </div>

                          {/* Score Breakdown Bar */}
                          <div className="breakdown-bars-container">
                            <div className="breakdown-bar-row">
                              <span className="bar-label">Capacity ({rec.breakdown.workloadCapacityScore}/35)</span>
                              <div className="bar-track">
                                <div
                                  className="bar-fill capacity-fill"
                                  style={{
                                    width: `${Math.round((rec.breakdown.workloadCapacityScore / 35) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="breakdown-bar-row">
                              <span className="bar-label">Schedule ({rec.breakdown.scheduleCompatibilityScore}/25)</span>
                              <div className="bar-track">
                                <div
                                  className="bar-fill schedule-fill"
                                  style={{
                                    width: `${Math.round((rec.breakdown.scheduleCompatibilityScore / 25) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="breakdown-bar-row">
                              <span className="bar-label">Domain Match ({rec.breakdown.domainSkillScore}/25)</span>
                              <div className="bar-track">
                                <div
                                  className="bar-fill domain-fill"
                                  style={{
                                    width: `${Math.round((rec.breakdown.domainSkillScore / 25) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="breakdown-bar-row">
                              <span className="bar-label">Role &amp; Project ({rec.breakdown.projectRoleFitScore}/15)</span>
                              <div className="bar-track">
                                <div
                                  className="bar-fill role-fill"
                                  style={{
                                    width: `${Math.round((rec.breakdown.projectRoleFitScore / 15) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Why Recommended */}
                          <div className="candidate-reasons-block">
                            <div className="reasons-heading">
                              <CheckCircle2 size={12} className="reasons-icon" />
                              <span>Why Recommended</span>
                            </div>
                            <ul className="reasons-list">
                              {rec.reasons.map((reason, rIdx) => (
                                <li key={rIdx}>{reason}</li>
                              ))}
                            </ul>
                          </div>

                          {/* Workload Concerns (if any) */}
                          {rec.concerns && rec.concerns.length > 0 && (
                            <div className="candidate-concerns-block">
                              <div className="concerns-heading">
                                <AlertTriangle size={12} className="concerns-icon" />
                                <span>Workload Concerns</span>
                              </div>
                              <ul className="concerns-list">
                                {rec.concerns.map((concern, cIdx) => (
                                  <li key={cIdx}>{concern}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Card Action */}
                          <div className="card-action-row">
                            {isCurrent ? (
                              <button
                                type="button"
                                className="button button-secondary small-button"
                                disabled
                              >
                                <Check size={13} /> Currently Assigned
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="button button-primary small-button smart-assign-approve-btn"
                                onClick={() => handleApproveAssignment(rec.candidate)}
                                disabled={!!assigningId}
                              >
                                {isAssigning ? (
                                  <>
                                    <LoaderCircle size={13} className="spin-animate" />
                                    Assigning…
                                  </>
                                ) : (
                                  <>
                                    <Check size={13} />
                                    Approve &amp; Assign
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="smart-assign-foot">
          <div className="human-loop-note">
            <Sparkles size={12} className="jade-sparkle" />
            <span>
              Human-in-the-loop guarantee: Tasks are assigned only when you explicitly approve.
            </span>
          </div>
          <button
            type="button"
            className="button button-secondary small-button"
            onClick={onClose}
            disabled={!!assigningId}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
export default SmartAssignmentModal;
