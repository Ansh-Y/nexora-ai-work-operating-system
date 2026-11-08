"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowLeft, CalendarDays, Check, CircleAlert, Clock3, FileAudio2, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Meeting = {
  id: string; title: string; description: string; startsAt?: string | null; durationMinutes?: number | null; status: string; _count?: { actionItemsReview: number };
  processingState: string; processingError?: string | null; projectId?: string | null; project?: { id: string; name: string } | null;
  summary?: string | null; participants?: { user: { id: string; name: string; email: string } }[];
  recordings?: { id: string; fileName: string; mimeType: string; sizeBytes: number; version: number; processingState: string; processingError?: string | null }[];
  segments?: { id: string; sequence: number; startMs?: number | null; endMs?: number | null; speakerLabel?: string | null; text: string }[];
  decisionsEvidence?: { id: string; sequence: number; title: string; description: string; evidence: string }[];
  actionItemsReview?: { id: string; sequence: number; title: string; description: string; evidence: string; status: string; dueDate?: string | null; assigneeId?: string | null; projectId?: string | null; assignee?: { id: string; name: string } | null; createdTask?: { id: string; title: string; status: string } | null }[];
};
type Props = { projects: { id: string; name: string }[]; members: { id: string; role: string; user: { id: string; name: string } }[]; onOpenProject: (projectId: string) => void; notify: (message: string) => void };
const states: Record<string, string> = { NOT_STARTED: "Not started", AWAITING_CONFIGURATION: "Waiting for provider setup", QUEUED: "Queued", TRANSCRIBING: "Transcribing", ANALYZING: "Analyzing", COMPLETE: "Analysis complete", FAILED: "Processing failed" };
function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Time not set"; }
function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export default function MeetingsWorkspace({ projects, members, onOpenProject, notify }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", description: "", startsAt: "", durationMinutes: "30", projectId: "", participantIds: [] as string[] });
  const [actionEdits, setActionEdits] = useState<Record<string, { title: string; description: string; assigneeId: string; projectId: string; dueDate: string }>>({});
  const [conversion, setConversion] = useState<Record<string, { projectId: string; assigneeId: string; dueDate: string }>>({});

  const loadList = useCallback(async (search = "") => {
    setLoading(true); setError("");
    try { const rows = await api.get(`/meetings${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`); setMeetings(rows); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load meetings."); }
    finally { setLoading(false); }
  }, []);
  const loadMeeting = useCallback(async (id: string) => {
    try { const detail = await api.get(`/meetings/${id}`); setSelected(detail); setMeetings(rows => rows.map(m => m.id === id ? { ...m, ...detail } : m)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load this meeting."); }
  }, []);

  useEffect(() => { void loadList(""); }, [loadList]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadList(query); }, 250); return () => window.clearTimeout(timer); }, [query, loadList]);
  useEffect(() => {
    if (!selected || !["QUEUED", "TRANSCRIBING", "ANALYZING"].includes(selected.processingState)) return;
    const timer = window.setTimeout(() => { void loadMeeting(selected.id); }, 2500);
    return () => window.clearTimeout(timer);
  }, [selected, loadMeeting]);

  const canCreate = useMemo(() => Boolean(form.title.trim()), [form.title]);
  async function createMeeting(event: React.FormEvent) {
    event.preventDefault(); if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const payload = { title: form.title.trim(), description: form.description.trim(), startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null, durationMinutes: Number(form.durationMinutes) || null, projectId: form.projectId || null, participantIds: form.participantIds };
      const saved = editing && selected ? await api.patch(`/meetings/${selected.id}`, payload) : await api.post("/meetings", payload);
      setCreating(false); setEditing(false); setForm({ title: "", description: "", startsAt: "", durationMinutes: "30", projectId: "", participantIds: [] }); await loadList(query); await loadMeeting(saved.id); notify(editing ? "Meeting updated" : "Meeting created");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not create meeting."); }
    finally { setBusy(false); }
  }
  async function uploadRecording(meeting: Meeting, file?: File) {
    if (!file) return;
    setBusy(true); setUploadProgress(0); setError("");
    try { const data = new FormData(); data.append("file", file); const result = await api.upload(`/meetings/${meeting.id}/recordings`, data, setUploadProgress); setSelected(result.meeting); await loadList(query); notify(result.configurationRequired ? "Recording saved. Configure transcription credentials to process it." : "Recording uploaded for processing"); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not upload recording."); }
    finally { setBusy(false); setUploadProgress(null); }
  }
  async function runAction(actionId: string, action: "approve" | "reject") {
    if (!selected) return; setBusy(true); setError("");
    try { await api.post(`/meetings/${selected.id}/actions/${actionId}/${action}`, {}); await loadMeeting(selected.id); notify(action === "approve" ? "Meeting action approved" : "Meeting action rejected"); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not review this action."); }
    finally { setBusy(false); }
  }
  async function saveAction(action: NonNullable<Meeting["actionItemsReview"]>[number]): Promise<boolean> {
    if (!selected) return false;
    const values = actionEdits[action.id] ?? { title: action.title, description: action.description, assigneeId: action.assigneeId ?? "", projectId: action.projectId ?? selected.projectId ?? "", dueDate: action.dueDate?.slice(0, 10) ?? "" };
    setBusy(true); setError("");
    try { await api.patch(`/meetings/${selected.id}/actions/${action.id}`, { title: values.title, description: values.description, assigneeId: values.assigneeId || null, projectId: values.projectId || null, dueDate: values.dueDate || null }); await loadMeeting(selected.id); notify("Meeting action details saved"); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not update this action."); return false; }
    finally { setBusy(false); }
  }
  async function approveAction(action: NonNullable<Meeting["actionItemsReview"]>[number]) { if (await saveAction(action)) await runAction(action.id, "approve"); }
  async function convertAction(action: NonNullable<Meeting["actionItemsReview"]>[number]) {
    if (!selected) return;
    const values = conversion[action.id] ?? { projectId: action.projectId ?? selected.projectId ?? "", assigneeId: action.assigneeId ?? "", dueDate: action.dueDate?.slice(0, 10) ?? "" };
    if (!values.projectId) { setError("Choose a project before converting this action."); return; }
    setBusy(true); setError("");
    try { const result = await api.post(`/meetings/${selected.id}/actions/${action.id}/convert`, { projectId: values.projectId, assigneeId: values.assigneeId || undefined, dueDate: values.dueDate || undefined }); await loadMeeting(selected.id); notify(result.duplicate ? "This action was already added to the project" : "Approved action added as a task"); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not create the task."); }
    finally { setBusy(false); }
  }
  async function retry(meeting: Meeting, recordingId: string) {
    setBusy(true); setError("");
    try { const result = await api.post(`/meetings/${meeting.id}/recordings/${recordingId}/retry`, {}); await loadMeeting(meeting.id); notify(result.queued ? "Meeting processing restarted" : "Configure the required provider keys to process this recording"); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not retry processing."); }
    finally { setBusy(false); }
  }
  async function downloadRecording(meeting: Meeting, recordingId: string) {
    try { const blob = await api.download(`/meetings/${meeting.id}/recordings/${recordingId}/audio`); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "meeting-recording"; link.click(); URL.revokeObjectURL(url); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not download recording."); }
  }
  async function archive(meeting: Meeting) {
    setBusy(true); setError(""); try { await api.delete(`/meetings/${meeting.id}`); setSelected(null); await loadList(query); notify("Meeting archived"); } catch (e) { setError(e instanceof ApiError ? e.message : "Could not archive meeting."); } finally { setBusy(false); }
  }

  return <div className="meetings-workspace">
    <div className="welcome-row compact-welcome"><div><div className="eyebrow"><CalendarDays size={12}/> MEETING INTELLIGENCE</div><h1>Meetings <span className="count-pill">{meetings.length}</span></h1><p className="page-subtitle">Record, transcribe, and turn reviewed decisions into trackable work.</p></div><button className="button button-primary" onClick={() => { setCreating(v => !v); setError(""); }}><Plus size={16}/> New meeting</button></div>
    {error && <div className="meeting-error"><CircleAlert size={15}/><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14}/></button></div>}
    {(creating || editing) && (
      <form className="panel meeting-create" onSubmit={createMeeting}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">MEETING DETAILS</div>
            <h2>{editing ? "Edit meeting" : "Schedule or log a meeting"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={() => {
              setCreating(false);
              setEditing(false);
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="meeting-form-layout">
          <div className="meeting-form-field col-span-2">
            <label htmlFor="meeting-title">Title</label>
            <input
              id="meeting-title"
              autoFocus
              required
              minLength={2}
              maxLength={180}
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Product planning review"
            />
          </div>

          <div className="meeting-form-field col-span-2">
            <label htmlFor="meeting-description">Description</label>
            <textarea
              id="meeting-description"
              rows={3}
              maxLength={5000}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Agenda, context, or outcomes to capture"
            />
          </div>

          <div className="meeting-form-field">
            <label htmlFor="meeting-starts-at">Date and time</label>
            <input
              id="meeting-starts-at"
              type="datetime-local"
              value={form.startsAt}
              onChange={e => setForm({ ...form, startsAt: e.target.value })}
            />
          </div>

          <div className="meeting-form-field">
            <label htmlFor="meeting-duration">Duration (minutes)</label>
            <input
              id="meeting-duration"
              type="number"
              min={5}
              max={1440}
              value={form.durationMinutes}
              onChange={e => setForm({ ...form, durationMinutes: e.target.value })}
            />
          </div>

          <div className="meeting-form-field">
            <label htmlFor="meeting-project">Project</label>
            <select
              id="meeting-project"
              value={form.projectId}
              onChange={e => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">Workspace meeting</option>
              {projects.map(p => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="meeting-form-field">
            <label htmlFor="meeting-participants">Participants</label>
            <select
              id="meeting-participants"
              multiple
              value={form.participantIds}
              onChange={e =>
                setForm({
                  ...form,
                  participantIds: Array.from(e.currentTarget.selectedOptions, option => option.value),
                })
              }
            >
              {members.map(m => (
                <option value={m.user.id} key={m.user.id}>
                  {m.user.name} · {m.role.toLowerCase().replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <small className="meeting-participant-hint">Hold Ctrl or Command to select more than one person.</small>
          </div>
        </div>

        <div className="meeting-form-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setCreating(false);
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy || !canCreate}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            {editing ? "Save changes" : "Create meeting"}
          </button>
        </div>
      </form>
    )}
    <div className="meeting-layout">
      <section className="panel meeting-list-panel">
        <div className="meeting-list-tools">
          <div className="meeting-search">
            <Search size={14} />
            <input aria-label="Search meetings" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search meetings" />
          </div>
          <button className="icon-button" aria-label="Refresh meetings" onClick={() => void loadList()}>
            <RefreshCw size={14} />
          </button>
        </div>
        {loading ? (
          <div className="meeting-empty">
            <LoaderCircle className="spin" size={18} /> Loading meetings…
          </div>
        ) : meetings.length ? (
          <div className="meeting-list">
            {meetings.map(meeting => (
              <button
                key={meeting.id}
                className={`meeting-list-row ${selected?.id === meeting.id ? "selected" : ""}`}
                onClick={() => void loadMeeting(meeting.id)}
              >
                <span className="meeting-list-icon">
                  <CalendarDays size={16} />
                </span>
                <span className="meeting-list-copy">
                  <b className="meeting-row-title">{meeting.title}</b>
                  <span className="meeting-row-time">
                    {formatTime(meeting.startsAt)}{meeting.durationMinutes ? ` · ${meeting.durationMinutes}m` : ""}
                  </span>
                  <div className="meeting-row-tags">
                    <em className={`meeting-state ${meeting.processingState.toLowerCase()}`}>
                      {states[meeting.processingState] ?? meeting.processingState}
                    </em>
                    <span className="meeting-row-count">
                      {meeting._count?.actionItemsReview ?? 0} actions
                    </span>
                  </div>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="meeting-empty">
            <CalendarDays size={20} />
            <b>No meetings yet</b>
            <span>Schedule one or create a meeting record, then add a recording.</span>
            <button className="button button-secondary small-button" onClick={() => setCreating(true)}>
              <Plus size={13} /> Create meeting
            </button>
          </div>
        )}
      </section>

      {selected ? (
        <section className="panel meeting-detail-panel">
          <button className="button button-quiet small-button mobile-back-to-list" onClick={() => setSelected(null)}>
            <ArrowLeft size={14} /> All meetings
          </button>
          <div className="meeting-detail-top">
            <div>
              <div className="eyebrow">{selected.project?.name || "WORKSPACE MEETING"}</div>
              <h2>{selected.title}</h2>
              <p>{selected.description || "No meeting description."}</p>
              <span className="meeting-date">
                <CalendarDays size={13} />
                {formatTime(selected.startsAt)}
                {selected.durationMinutes ? ` · ${selected.durationMinutes} minutes` : ""}
              </span>
              {!!selected.participants?.length && (
                <div className="meeting-participant-list">
                  {selected.participants.map(p => (
                    <span key={p.user.id}>{p.user.name}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="meeting-detail-actions">
              <button className="icon-button" aria-label="Refresh meeting" onClick={() => void loadMeeting(selected.id)}>
                <RefreshCw size={14} />
              </button>
              <button
                className="button button-secondary small-button"
                disabled={busy}
                onClick={() => {
                  const startsAt = selected.startsAt ? new Date(selected.startsAt) : null;
                  if (startsAt) startsAt.setMinutes(startsAt.getMinutes() - startsAt.getTimezoneOffset());
                  setForm({
                    title: selected.title,
                    description: selected.description,
                    startsAt: startsAt?.toISOString().slice(0, 16) ?? "",
                    durationMinutes: String(selected.durationMinutes ?? 30),
                    projectId: selected.projectId ?? "",
                    participantIds: selected.participants?.map(p => p.user.id) ?? [],
                  });
                  setEditing(true);
                  setCreating(false);
                  setError("");
                }}
              >
                Edit
              </button>
              <button className="button button-secondary small-button" disabled={busy} onClick={() => void archive(selected)}>
                Archive
              </button>
            </div>
          </div>
          <div className="meeting-recording-box">
            <div className="meeting-recording-icon"><FileAudio2 size={17} /></div>
            <div>
              <b>Recording and transcript</b>
              <small>
                {selected.recordings?.length
                  ? `${selected.recordings[0].fileName} · ${formatSize(selected.recordings[0].sizeBytes)}`
                  : "Add an MP3, WAV, or M4A recording (up to configured limit)."}
              </small>
            </div>
            {selected.recordings?.[0] ? (
              <>
                <button
                  className="icon-button"
                  title="Download recording"
                  onClick={() => void downloadRecording(selected, selected.recordings![0].id)}
                >
                  <ArrowDownToLine size={15} />
                </button>
                {["FAILED", "AWAITING_CONFIGURATION"].includes(selected.processingState) && (
                  <button className="button button-secondary small-button" disabled={busy} onClick={() => void retry(selected, selected.recordings![0].id)}>
                    <RefreshCw size={12} /> Retry
                  </button>
                )}
              </>
            ) : (
              <label className={`button button-secondary small-button meeting-upload ${busy ? "disabled" : ""}`}>
                <Upload size={13} /> Upload audio
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a"
                  disabled={busy}
                  onChange={e => {
                    void uploadRecording(selected, e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {uploadProgress !== null && (
            <div className="meeting-upload-progress" aria-label={`Upload progress ${uploadProgress}%`}>
              <i style={{ width: `${uploadProgress}%` }} />
              <span>{uploadProgress}%</span>
            </div>
          )}
          <div className={`meeting-process-state ${selected.processingState.toLowerCase()}`}>
            <span
              className={
                selected.processingState === "QUEUED" ||
                selected.processingState === "TRANSCRIBING" ||
                selected.processingState === "ANALYZING"
                  ? "pulse-dot"
                  : "state-dot"
              }
            />
            <b>{states[selected.processingState] ?? selected.processingState}</b>
            {selected.processingError && <small>{selected.processingError}</small>}
            {["QUEUED", "TRANSCRIBING", "ANALYZING"].includes(selected.processingState) && (
              <LoaderCircle className="spin" size={14} />
            )}
          </div>
          {selected.summary && (
            <div className="meeting-summary">
              <div className="eyebrow"><Sparkles size={11} /> GROUNDED SUMMARY</div>
              <p>{selected.summary}</p>
            </div>
          )}
          {!!selected.decisionsEvidence?.length && (
            <div className="meeting-section">
              <div className="meeting-section-title">
                <h3>Decisions</h3>
                <span>{selected.decisionsEvidence.length}</span>
              </div>
              {selected.decisionsEvidence.map(decision => (
                <div className="meeting-evidence-card" key={decision.id}>
                  <b>{decision.title}</b>
                  {decision.description && <p>{decision.description}</p>}
                  <small>“{decision.evidence}”</small>
                </div>
              ))}
            </div>
          )}
          {!!selected.actionItemsReview?.length && (
            <div className="meeting-section">
              <div className="meeting-section-title">
                <h3>Action items</h3>
                <span>{selected.actionItemsReview.length} · approval required</span>
              </div>
              {selected.actionItemsReview.map(action => {
                const values = conversion[action.id] ?? {
                  projectId: action.projectId ?? selected.projectId ?? "",
                  assigneeId: action.assigneeId ?? "",
                  dueDate: action.dueDate?.slice(0, 10) ?? "",
                };
                const draft = actionEdits[action.id] ?? {
                  title: action.title,
                  description: action.description,
                  assigneeId: action.assigneeId ?? "",
                  projectId: action.projectId ?? selected.projectId ?? "",
                  dueDate: action.dueDate?.slice(0, 10) ?? "",
                };
                return (
                  <div className="meeting-action-card" key={action.id}>
                    <div className="meeting-action-heading">
                      <span className={`action-status ${action.status.toLowerCase()}`}>
                        {action.status.toLowerCase()}
                      </span>
                      {action.createdTask && (
                        <button
                          className="text-button"
                          onClick={() => action.projectId && onOpenProject(action.projectId)}
                        >
                          Open task <ArrowDownToLine size={12} />
                        </button>
                      )}
                    </div>
                    {action.status === "EXTRACTED" ? (
                      <div className="meeting-action-edit">
                        <label>
                          Action title
                          <input
                            value={draft.title}
                            maxLength={180}
                            onChange={e =>
                              setActionEdits({
                                ...actionEdits,
                                [action.id]: { ...draft, title: e.target.value },
                              })
                            }
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={draft.description}
                            onChange={e =>
                              setActionEdits({
                                ...actionEdits,
                                [action.id]: { ...draft, description: e.target.value },
                              })
                            }
                          />
                        </label>
                        <div className="meeting-action-fields">
                          <label>
                            Owner
                            <select
                              value={draft.assigneeId}
                              onChange={e =>
                                setActionEdits({
                                  ...actionEdits,
                                  [action.id]: { ...draft, assigneeId: e.target.value },
                                })
                              }
                            >
                              <option value="">Unassigned</option>
                              {members.map(m => (
                                <option value={m.user.id} key={m.user.id}>
                                  {m.user.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Project
                            <select
                              value={draft.projectId}
                              onChange={e =>
                                setActionEdits({
                                  ...actionEdits,
                                  [action.id]: { ...draft, projectId: e.target.value },
                                })
                              }
                            >
                              <option value="">Choose a project</option>
                              {projects.map(p => (
                                <option value={p.id} key={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Due date
                            <input
                              type="date"
                              value={draft.dueDate}
                              onChange={e =>
                                setActionEdits({
                                  ...actionEdits,
                                  [action.id]: { ...draft, dueDate: e.target.value },
                                })
                              }
                            />
                          </label>
                        </div>
                        <small className="action-evidence">“{action.evidence}”</small>
                        <div className="meeting-action-review">
                          <button
                            className="button button-secondary small-button"
                            disabled={busy}
                            onClick={() => void runAction(action.id, "reject")}
                          >
                            <X size={12} /> Reject
                          </button>
                          <button
                            className="button button-secondary small-button"
                            disabled={busy}
                            onClick={() => void saveAction(action)}
                          >
                            Save details
                          </button>
                          <button
                            className="button button-primary small-button"
                            disabled={busy}
                            onClick={() => void approveAction(action)}
                          >
                            <ShieldCheck size={12} /> Approve
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <b>{action.title}</b>
                        {action.description && <p>{action.description}</p>}
                        <small className="action-evidence">“{action.evidence}”</small>
                      </>
                    )}
                    {action.status === "APPROVED" && (
                      <div className="meeting-convert">
                        <div className="meeting-convert-fields">
                          <label>
                            Project
                            <select
                              value={values.projectId}
                              onChange={e =>
                                setConversion({
                                  ...conversion,
                                  [action.id]: { ...values, projectId: e.target.value },
                                })
                              }
                            >
                              <option value="">Choose a project</option>
                              {projects.map(p => (
                                <option value={p.id} key={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Assignee
                            <select
                              value={values.assigneeId}
                              onChange={e =>
                                setConversion({
                                  ...conversion,
                                  [action.id]: { ...values, assigneeId: e.target.value },
                                })
                              }
                            >
                              <option value="">Unassigned</option>
                              {members.map(m => (
                                <option value={m.user.id} key={m.id}>
                                  {m.user.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Due date
                            <input
                              type="date"
                              value={values.dueDate}
                              onChange={e =>
                                setConversion({
                                  ...conversion,
                                  [action.id]: { ...values, dueDate: e.target.value },
                                })
                              }
                            />
                          </label>
                        </div>
                        <button
                          className="button button-primary small-button"
                          disabled={busy || !values.projectId}
                          onClick={() => void convertAction(action)}
                        >
                          <Plus size={12} /> Create task
                        </button>
                      </div>
                    )}
                    {action.status === "CONVERTED" && action.createdTask && (
                      <div className="converted-task">
                        <Check size={13} /> Added: <b>{action.createdTask.title}</b>
                      </div>
                    )}
                    {action.status === "EXPIRED" && (
                      <div className="meeting-process-state failed">
                        <span className="state-dot" /> Approval window expired
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!!selected.segments?.length && (
            <details className="meeting-section transcript-section">
              <summary>
                <span>
                  <h3>Transcript</h3>
                  <small>{selected.segments.length} timestamped segments</small>
                </span>
                <Clock3 size={14} />
              </summary>
              <div className="transcript-segments">
                {selected.segments.map(segment => (
                  <div className="transcript-segment" key={segment.id}>
                    <time>
                      {segment.startMs == null
                        ? ""
                        : `${Math.floor(segment.startMs / 60000)
                            .toString()
                            .padStart(2, "0")}:${Math.floor((segment.startMs % 60000) / 1000)
                            .toString()
                            .padStart(2, "0")}`}
                    </time>
                    <b>{segment.speakerLabel || "Speaker"}</b>
                    <p>{segment.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {selected.processingState === "COMPLETE" && !selected.segments?.length && (
            <div className="meeting-empty compact">
              <b>Transcript is ready</b>
              <span>Transcript text is available in workspace search.</span>
            </div>
          )}
        </section>
      ) : (
        <section className="panel meeting-detail-empty">
          <div className="meeting-empty-card">
            <div className="empty-icon-circle">
              <CalendarDays size={28} />
            </div>
            <h3 className="empty-heading">Select a meeting</h3>
            <p className="empty-description">
              Choose a meeting from the list on the left to review audio recordings, transcript evidence, grounded summaries, and extracted action items.
            </p>
          </div>
        </section>
      )}
    </div>
    <div className="meeting-security-note"><ShieldCheck size={14}/> Recordings are private to this workspace. AI extracted actions need explicit review before they become tasks.</div>
    {!members.length && <span className="sr-only">No workspace members loaded for action assignment.</span>}
  </div>;
}
