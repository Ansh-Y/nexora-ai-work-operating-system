"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Archive,
  ArrowRight,
  Check,
  Clock3,
  Download,
  FileText,
  HardDrive,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";

type StorageSummary = {
  provider: { name: string; isCloud: boolean; description: string };
  usage: {
    totalBytes: number;
    totalFiles: number;
    recordingBytes: number;
    recordingFiles: number;
    documentBytes: number;
    documentFiles: number;
    activeHoldsCount: number;
    expiringSoonCount: number;
  };
  retentionPolicy: {
    recordingRetentionDays: number | null;
    documentRetentionDays: number | null;
    autoDeleteExpired: boolean;
    manualDeletionAllowed: boolean;
  };
};

type StoredFile = {
  id: string;
  fileName: string;
  entityType: string;
  mimeType: string;
  sizeBytes: number;
  provider: string;
  uploadStatus: string;
  createdAt: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  hasActiveHold: boolean;
  holds: Array<{ id: string; reason: string; holdType: string; appliedAt: string; appliedBy: { id: string; name: string } }>;
  linkedDocument?: { id: string; title: string; projectId?: string } | null;
  linkedRecording?: { id: string; meetingId: string; version: number } | null;
};

type DryRunResult = {
  summary: {
    expiredCount: number;
    eligibleForDeletionCount: number;
    eligibleBytes: number;
    heldCount: number;
    heldBytes: number;
    expiringSoonCount: number;
  };
  eligibleFiles: Array<{ id: string; fileName: string; entityType: string; sizeBytes: number; expiresAt: string }>;
  heldFiles: Array<{ id: string; fileName: string; entityType: string; sizeBytes: number; holds: Array<{ reason: string; holdType: string }> }>;
};

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export default function StorageManagement({
  canManage,
  notify,
  projects,
}: {
  canManage: boolean;
  notify: (msg: string) => void;
  projects: Array<{ id: string; name: string }>;
}) {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [activeTab, setActiveTab] = useState<"files" | "policy" | "dryrun">("files");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [holdFilter, setHoldFilter] = useState<string>("");

  // Modals
  const [uploadModal, setUploadModal] = useState(false);
  const [holdModalFile, setHoldModalFile] = useState<StoredFile | null>(null);
  const [releaseModalHold, setReleaseModalHold] = useState<{ id: string; fileName: string } | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<StoredFile | null>(null);

  // Forms
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProjectId, setUploadProjectId] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [holdType, setHoldType] = useState<"LEGAL" | "OPERATIONAL" | "COMPLIANCE">("LEGAL");
  const [releaseReason, setReleaseReason] = useState("");

  // Policy Form
  const [policyForm, setPolicyForm] = useState({
    recordingRetentionDays: "",
    documentRetentionDays: "",
    autoDeleteExpired: false,
    manualDeletionAllowed: true,
  });

  // Dry Run State
  const [dryRunData, setDryRunData] = useState<DryRunResult | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = (await api.get("/storage/summary")) as StorageSummary;
      setSummary(data);
      if (data.retentionPolicy) {
        setPolicyForm({
          recordingRetentionDays: data.retentionPolicy.recordingRetentionDays ? String(data.retentionPolicy.recordingRetentionDays) : "",
          documentRetentionDays: data.retentionPolicy.documentRetentionDays ? String(data.retentionPolicy.documentRetentionDays) : "",
          autoDeleteExpired: data.retentionPolicy.autoDeleteExpired ?? false,
          manualDeletionAllowed: data.retentionPolicy.manualDeletionAllowed ?? true,
        });
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load storage summary");
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (entityFilter) params.set("entityType", entityFilter);
      if (holdFilter === "held") params.set("hasHold", "true");
      if (holdFilter === "unheld") params.set("hasHold", "false");
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const res = (await api.get(`/storage/files?${params.toString()}`)) as { items: StoredFile[] };
      setFiles(res.items || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load stored files");
    } finally {
      setLoading(false);
    }
  }, [entityFilter, holdFilter, searchQuery]);

  const loadDryRun = useCallback(async () => {
    try {
      setBusy(true);
      const res = (await api.get("/storage/retention/dry-run")) as DryRunResult;
      setDryRunData(res);
    } catch (e: any) {
      setError(e?.message || "Failed to run retention dry-run");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadFiles();
  }, [loadSummary, loadFiles]);

  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (uploadProjectId) formData.append("projectId", uploadProjectId);

      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"}/storage/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("nexora_token") || ""}`,
        },
        body: formData,
      }).then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || `Upload failed with status ${r.status}`);
        }
        return r.json();
      });

      notify("Document uploaded securely to workspace storage.");
      setUploadModal(false);
      setUploadFile(null);
      setUploadProjectId("");
      loadSummary();
      loadFiles();
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(file: StoredFile) {
    try {
      const res = (await api.get(`/storage/files/${file.id}/download-url`)) as { url: string; fileName: string };
      if (res.url) {
        window.open(res.url, "_blank");
      }
    } catch (err: any) {
      notify(`Download error: ${err?.message || "Could not generate download link"}`);
    }
  }

  async function handleDeleteFile() {
    if (!deleteConfirmFile) return;
    setBusy(true);
    try {
      await api.delete(`/storage/files/${deleteConfirmFile.id}`);
      notify(`File "${deleteConfirmFile.fileName}" permanently deleted.`);
      setDeleteConfirmFile(null);
      loadSummary();
      loadFiles();
    } catch (err: any) {
      notify(`Delete failed: ${err?.message || "Could not delete file"}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyHold(e: React.FormEvent) {
    e.preventDefault();
    if (!holdModalFile || !holdReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/storage/files/${holdModalFile.id}/holds`, {
        reason: holdReason.trim(),
        holdType,
      });
      notify(`Legal/operational hold placed on "${holdModalFile.fileName}".`);
      setHoldModalFile(null);
      setHoldReason("");
      loadSummary();
      loadFiles();
    } catch (err: any) {
      notify(`Failed to apply hold: ${err?.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReleaseHold(e: React.FormEvent) {
    e.preventDefault();
    if (!releaseModalHold) return;
    setBusy(true);
    try {
      await api.post(`/storage/holds/${releaseModalHold.id}/release`, {
        releaseReason: releaseReason.trim() || undefined,
      });
      notify(`Hold released on "${releaseModalHold.fileName}".`);
      setReleaseModalHold(null);
      setReleaseReason("");
      loadSummary();
      loadFiles();
    } catch (err: any) {
      notify(`Failed to release hold: ${err?.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/storage/retention/policy", {
        recordingRetentionDays: policyForm.recordingRetentionDays ? parseInt(policyForm.recordingRetentionDays, 10) : null,
        documentRetentionDays: policyForm.documentRetentionDays ? parseInt(policyForm.documentRetentionDays, 10) : null,
        autoDeleteExpired: policyForm.autoDeleteExpired,
        manualDeletionAllowed: policyForm.manualDeletionAllowed,
      });
      notify("Workspace retention policy updated successfully.");
      loadSummary();
      loadFiles();
    } catch (err: any) {
      notify(`Failed to update policy: ${err?.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleTriggerSweep() {
    if (!window.confirm("Run retention cleanup sweep now? Eligible expired files without active holds will be deleted.")) return;
    setBusy(true);
    try {
      const res = (await api.post("/storage/retention/sweep", {})) as { message: string };
      notify(res.message || "Retention cleanup sweep executed.");
      loadSummary();
      loadFiles();
      loadDryRun();
    } catch (err: any) {
      notify(`Retention sweep error: ${err?.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel storage-panel" style={{ marginTop: "16px" }}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">DATA STORAGE &amp; COMPLIANCE</div>
          <h2>Private Cloud Storage &amp; Retention</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="status-tag active" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <HardDrive size={11} />
            {summary?.provider.name === "s3" ? "S3 CLOUD STORAGE" : "LOCAL ENCRYPTED STORAGE"}
          </span>
          <button
            type="button"
            className="button button-primary small-button"
            onClick={() => setUploadModal(true)}
          >
            <UploadCloud size={13} /> Upload Document
          </button>
        </div>
      </div>

      {error && (
        <div className="form-error" style={{ margin: "10px 0" }}>
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
          margin: "14px 0",
        }}
      >
        <div style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" }}>
          <div style={{ color: "#7d8690", fontSize: "8px", fontWeight: 600 }}>TOTAL USAGE</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", margin: "4px 0 2px" }}>
            {formatBytes(summary?.usage.totalBytes ?? 0)}
          </div>
          <div style={{ fontSize: "8.5px", color: "#9aa1a9" }}>{summary?.usage.totalFiles ?? 0} total files</div>
        </div>

        <div style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" }}>
          <div style={{ color: "#7d8690", fontSize: "8px", fontWeight: 600 }}>AUDIO RECORDINGS</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", margin: "4px 0 2px" }}>
            {formatBytes(summary?.usage.recordingBytes ?? 0)}
          </div>
          <div style={{ fontSize: "8.5px", color: "#9aa1a9" }}>{summary?.usage.recordingFiles ?? 0} recordings</div>
        </div>

        <div style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" }}>
          <div style={{ color: "#7d8690", fontSize: "8px", fontWeight: 600 }}>DOCUMENTS</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", margin: "4px 0 2px" }}>
            {formatBytes(summary?.usage.documentBytes ?? 0)}
          </div>
          <div style={{ fontSize: "8.5px", color: "#9aa1a9" }}>{summary?.usage.documentFiles ?? 0} files</div>
        </div>

        <div style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" }}>
          <div style={{ color: "#7d8690", fontSize: "8px", fontWeight: 600 }}>ACTIVE HOLDS</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: summary?.usage.activeHoldsCount ? "#c27803" : "var(--ink)", margin: "4px 0 2px" }}>
            {summary?.usage.activeHoldsCount ?? 0}
          </div>
          <div style={{ fontSize: "8.5px", color: "#9aa1a9" }}>Protected files</div>
        </div>

        <div style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" }}>
          <div style={{ color: "#7d8690", fontSize: "8px", fontWeight: 600 }}>EXPIRING SOON</div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: summary?.usage.expiringSoonCount ? "#d97706" : "var(--ink)", margin: "4px 0 2px" }}>
            {summary?.usage.expiringSoonCount ?? 0}
          </div>
          <div style={{ fontSize: "8.5px", color: "#9aa1a9" }}>Within 14 days</div>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="project-tabs" style={{ marginBottom: "12px" }}>
        <button className={activeTab === "files" ? "selected" : ""} onClick={() => setActiveTab("files")}>
          <FileText size={12} /> Stored Files <span>{files.length}</span>
        </button>
        <button className={activeTab === "policy" ? "selected" : ""} onClick={() => setActiveTab("policy")}>
          <Clock3 size={12} /> Retention Policy
        </button>
        <button
          className={activeTab === "dryrun" ? "selected" : ""}
          onClick={() => {
            setActiveTab("dryrun");
            loadDryRun();
          }}
        >
          <ShieldAlert size={12} /> Cleanup &amp; Dry-Run {summary?.usage.expiringSoonCount ? <span>{summary.usage.expiringSoonCount}</span> : null}
        </button>
      </div>

      {/* TAB 1: Stored Files */}
      {activeTab === "files" && (
        <div>
          {/* Filter Bar */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "6px", padding: "2px 8px" }}>
              <Search size={12} style={{ color: "#7d8690" }} />
              <input
                type="text"
                placeholder="Search files…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ border: 0, outline: 0, fontSize: "9px", background: "transparent", color: "var(--ink)", width: "130px" }}
              />
            </div>

            <select
              value={entityFilter}
              onChange={e => setEntityFilter(e.target.value)}
              style={{ fontSize: "9px", padding: "3px 6px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
            >
              <option value="">All File Types</option>
              <option value="DOCUMENT">Documents</option>
              <option value="MEETING_RECORDING">Meeting Recordings</option>
            </select>

            <select
              value={holdFilter}
              onChange={e => setHoldFilter(e.target.value)}
              style={{ fontSize: "9px", padding: "3px 6px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
            >
              <option value="">All Hold States</option>
              <option value="held">Under Legal Hold</option>
              <option value="unheld">No Holds</option>
            </select>

            <button type="button" className="icon-button" onClick={() => loadFiles()} title="Refresh list">
              <RefreshCw size={12} className={loading ? "spin" : ""} />
            </button>
          </div>

          {/* Files Table */}
          <div className="task-table-wrap">
            <table className="task-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Hold Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => {
                  const isAudio = file.entityType === "MEETING_RECORDING";
                  return (
                    <tr key={file.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ color: isAudio ? "#8b5cf6" : "#0284c7" }}>
                            {isAudio ? <Archive size={13} /> : <FileText size={13} />}
                          </span>
                          <span>
                            <b>{file.fileName}</b>
                            {file.linkedDocument?.projectId && (
                              <small style={{ color: "#7d8690", display: "block", fontSize: "7.5px" }}>
                                Project doc
                              </small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: "8.5px", color: "#64748b" }}>{file.mimeType.split("/")[1]?.toUpperCase() || file.entityType}</span>
                      </td>
                      <td>{formatBytes(file.sizeBytes)}</td>
                      <td>{new Date(file.createdAt).toLocaleDateString()}</td>
                      <td>
                        {file.expiresAt ? (
                          <span style={{ color: new Date(file.expiresAt) < new Date() ? "#ef4444" : "#f59e0b", fontSize: "8.5px" }}>
                            {new Date(file.expiresAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8", fontSize: "8px" }}>Indefinite</span>
                        )}
                      </td>
                      <td>
                        {file.hasActiveHold ? (
                          <span className="status-tag" style={{ background: "#fef3c7", color: "#92400e", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                            <Lock size={10} /> HELD ({file.holds[0]?.holdType})
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8", fontSize: "8px" }}>None</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleDownload(file)}
                            title="Download file"
                          >
                            <Download size={13} />
                          </button>
                          {canManage && (
                            <>
                              {file.hasActiveHold ? (
                                <button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => setReleaseModalHold({ id: file.holds[0].id, fileName: file.fileName })}
                                  title="Release hold"
                                  style={{ color: "#059669" }}
                                >
                                  <Unlock size={13} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => setHoldModalFile(file)}
                                  title="Place legal hold"
                                  style={{ color: "#d97706" }}
                                >
                                  <Lock size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() => setDeleteConfirmFile(file)}
                                disabled={file.hasActiveHold}
                                title={file.hasActiveHold ? "Cannot delete file under hold" : "Delete file"}
                                style={{ color: file.hasActiveHold ? "#cbd5e1" : "#ef4444" }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!files.length && !loading && (
              <div className="empty-inline">No stored files match the selected filters.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Retention Policy */}
      {activeTab === "policy" && (
        <form onSubmit={handleSavePolicy} style={{ maxWidth: "520px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <p className="muted-copy" style={{ fontSize: "9px", margin: 0 }}>
            Configure automatic data retention rules for workspace assets. Files exceeding retention periods will be flagged for automatic or manual deletion, unless protected by an active legal hold.
          </p>

          <label>
            Meeting recording retention (days)
            <input
              type="number"
              min="1"
              max="3650"
              placeholder="Leave blank for indefinite retention"
              value={policyForm.recordingRetentionDays}
              onChange={e => setPolicyForm({ ...policyForm, recordingRetentionDays: e.target.value })}
            />
            <span className="field-hint">Audio files and associated processing artifacts.</span>
          </label>

          <label>
            Workspace document retention (days)
            <input
              type="number"
              min="1"
              max="3650"
              placeholder="Leave blank for indefinite retention"
              value={policyForm.documentRetentionDays}
              onChange={e => setPolicyForm({ ...policyForm, documentRetentionDays: e.target.value })}
            />
            <span className="field-hint">Uploaded PDF, text, and project attachments.</span>
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "6px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "9.5px", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={policyForm.autoDeleteExpired}
                onChange={e => setPolicyForm({ ...policyForm, autoDeleteExpired: e.target.checked })}
              />
              Automatically delete expired files during background sweeps
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "9.5px", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={policyForm.manualDeletionAllowed}
                onChange={e => setPolicyForm({ ...policyForm, manualDeletionAllowed: e.target.checked })}
              />
              Allow authorized managers to manually delete non-held files
            </label>
          </div>

          {canManage && (
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button type="submit" className="button button-primary small-button" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Save Policy
              </button>
            </div>
          )}
        </form>
      )}

      {/* TAB 3: Dry-Run & Cleanup */}
      {activeTab === "dryrun" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="muted-copy" style={{ fontSize: "9px", margin: 0, maxWidth: "550px" }}>
              Preview which files are eligible for retention cleanup before any deletion occurs. Files protected under active holds are permanently shielded from cleanup.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="button button-secondary small-button" onClick={loadDryRun} disabled={busy}>
                <RefreshCw size={12} className={busy ? "spin" : ""} /> Refresh Scan
              </button>
              {canManage && (
                <button type="button" className="button button-primary small-button" onClick={handleTriggerSweep} disabled={busy || !dryRunData?.summary.eligibleForDeletionCount}>
                  <Trash2 size={12} /> Execute Sweep ({dryRunData?.summary.eligibleForDeletionCount ?? 0})
                </button>
              )}
            </div>
          </div>

          {dryRunData && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
              <div style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)" }}>
                <small style={{ color: "#7d8690", fontSize: "7.5px" }}>ELIGIBLE FOR CLEANUP</small>
                <div style={{ fontSize: "14px", fontWeight: 700, color: dryRunData.summary.eligibleForDeletionCount ? "#ef4444" : "var(--ink)" }}>
                  {dryRunData.summary.eligibleForDeletionCount} files
                </div>
                <small style={{ color: "#94a3b8", fontSize: "7.5px" }}>{formatBytes(dryRunData.summary.eligibleBytes)}</small>
              </div>

              <div style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)" }}>
                <small style={{ color: "#7d8690", fontSize: "7.5px" }}>SHIELDED BY HOLDS</small>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#d97706" }}>
                  {dryRunData.summary.heldCount} files
                </div>
                <small style={{ color: "#94a3b8", fontSize: "7.5px" }}>{formatBytes(dryRunData.summary.heldBytes)}</small>
              </div>

              <div style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)" }}>
                <small style={{ color: "#7d8690", fontSize: "7.5px" }}>EXPIRING WITHIN 14D</small>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                  {dryRunData.summary.expiringSoonCount} files
                </div>
              </div>
            </div>
          )}

          {dryRunData?.eligibleFiles.length ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: "6px" }}>FILES READY FOR CLEANUP</div>
              <div style={{ display: "grid", gap: "6px" }}>
                {dryRunData.eligibleFiles.map(f => (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "8.5px" }}>
                    <span><b>{f.fileName}</b> ({formatBytes(f.sizeBytes)})</span>
                    <span style={{ color: "#ef4444" }}>Expired on {new Date(f.expiresAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-inline" style={{ minHeight: "80px" }}>
              No expired files are currently eligible for deletion.
            </div>
          )}
        </div>
      )}

      {/* MODAL: Upload Document */}
      {uploadModal && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setUploadModal(false); }}>
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="eyebrow">UPLOAD ASSET</div>
                <h2>Workspace Document</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setUploadModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleUploadDocument}>
              <label>
                Select document file (PDF, TXT, Markdown, JSON, CSV - max 25MB)
                <input
                  type="file"
                  required
                  accept=".pdf,.txt,.text,.md,.markdown,.json,.csv"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                />
              </label>

              <label>
                Associate with Project (optional)
                <select value={uploadProjectId} onChange={e => setUploadProjectId(e.target.value)}>
                  <option value="">No project association</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setUploadModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={busy || !uploadFile}>
                  {busy ? <LoaderCircle className="spin" size={13} /> : <UploadCloud size={13} />} Upload Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Apply Legal Hold */}
      {holdModalFile && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setHoldModalFile(null); }}>
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="eyebrow">RETENTION PROTECTION</div>
                <h2>Apply Legal / Operational Hold</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setHoldModalFile(null)}>
                <X size={18} />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleApplyHold}>
              <p className="modal-copy">
                Files under an active hold will <b>never</b> be automatically or manually deleted while the hold remains in effect.
              </p>

              <div style={{ padding: "8px 10px", background: "var(--panel-wash, #f7f7fa)", borderRadius: "6px", fontSize: "9px", marginBottom: "8px" }}>
                Target: <b>{holdModalFile.fileName}</b> ({formatBytes(holdModalFile.sizeBytes)})
              </div>

              <label>
                Hold Type
                <select value={holdType} onChange={e => setHoldType(e.target.value as any)}>
                  <option value="LEGAL">Legal Hold</option>
                  <option value="OPERATIONAL">Operational Hold</option>
                  <option value="COMPLIANCE">Compliance / Audit</option>
                </select>
              </label>

              <label>
                Reason for Hold
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  placeholder="Explain why this file must be preserved indefinitely…"
                  value={holdReason}
                  onChange={e => setHoldReason(e.target.value)}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setHoldModalFile(null)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={busy || !holdReason.trim()}>
                  {busy ? <LoaderCircle className="spin" size={13} /> : <Lock size={13} />} Apply Hold
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Release Legal Hold */}
      {releaseModalHold && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setReleaseModalHold(null); }}>
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="eyebrow">RETENTION CONTROL</div>
                <h2>Release Hold</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setReleaseModalHold(null)}>
                <X size={18} />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleReleaseHold}>
              <p className="modal-copy">
                Releasing this hold will allow normal retention and deletion rules to resume for <b>{releaseModalHold.fileName}</b>.
              </p>

              <label>
                Release Note / Rationale (optional)
                <textarea
                  maxLength={500}
                  rows={3}
                  placeholder="e.g. Litigation concluded / Audit completed…"
                  value={releaseReason}
                  onChange={e => setReleaseReason(e.target.value)}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setReleaseModalHold(null)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={13} /> : <Unlock size={13} />} Release Hold
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Delete */}
      {deleteConfirmFile && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setDeleteConfirmFile(null); }}>
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="eyebrow" style={{ color: "#ef4444" }}>PERMANENT DELETION</div>
                <h2>Delete File</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setDeleteConfirmFile(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-form">
              <p className="modal-copy" style={{ color: "#ef4444" }}>
                Are you sure you want to permanently delete <b>{deleteConfirmFile.fileName}</b>? This action cannot be undone and will be logged in the workspace audit record.
              </p>

              <div className="modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setDeleteConfirmFile(null)}>
                  Cancel
                </button>
                <button type="button" className="button button-primary" style={{ background: "#dc2626" }} onClick={handleDeleteFile} disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />} Permanently Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
