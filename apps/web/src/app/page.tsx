"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Blocks, Bot, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Command, Copy, FileText, Filter, GitBranch, LayoutDashboard, List, LoaderCircle, LogOut, Menu, MessageSquare, MoreHorizontal, Plus, Search, Send, Settings2, ShieldAlert, ShieldCheck, Sparkles, Target, Users, X, Zap } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { api, ApiError } from "@/lib/api";
import MeetingsWorkspace from "./MeetingsWorkspace";
import CalendarWorkspace from "./CalendarWorkspace";
import GitHubIntegration from "./GitHubIntegration";
import StorageManagement from "./StorageManagement";
import GoogleWorkspaceIntegration from "./GoogleWorkspaceIntegration";
import ProjectHealthDashboard from "./ProjectHealthDashboard";

type User = { id: string; name: string; email: string };
type Workspace = { id: string; name: string; role: string };
type Task = { id: string; title: string; description: string; status: string; priority: string; dueDate?: string | null; assignee?: { id: string; name: string } | null; blockedBy?: { blockingTask: { id: string; title: string; status: string } }[]; blocks?: { blockedTask: { id: string; title: string; status: string } }[]; labels?: string[]; impact?: { affectedTaskCount: number } };
type Project = { id: string; name: string; description: string; status: string; priority: string; dueDate?: string | null; owner?: { name: string }; _count?: { tasks: number }; tasks?: Task[]; milestones?: { id: string; title: string; targetDate?: string | null; completedAt?: string | null }[] };
type PlanTask = { title: string; description: string; priority: string; dueDate?: string | null; assigneeId?: string | null; blockedBy: number[] };
type Proposal = { id: string; title: string; explanation: string; provider?: string; proposed: { projectName: string; projectDescription: string; milestones: { title: string }[]; assumptions: string[]; tasks: PlanTask[] }; status: string };
type Page = "Overview" | "My work" | "Projects" | "Project Health" | "Meetings" | "Calendar" | "AI command" | "Inbox" | "Activity" | "Settings";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const avatarColors = ["#ddd8fb", "#d9eee8", "#f8e4d5", "#e3eaf6"];

function initials(name = "Nexora") { return name.split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase(); }
function dueLabel(date?: string | null) {
  if (!date) return "No date";
  const d = new Date(date); const today = new Date();
  const days = Math.ceil((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}
function dateInput(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<{ id: string; role: string; user: User }[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [recentProposals, setRecentProposals] = useState<any[]>([]);
  const [page, setPage] = useState<Page>("Overview");
  const [view, setView] = useState<"Board" | "List" | "Graph">("Board");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", organizationName: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"project" | "task" | "plan" | "invite" | "dependency" | "milestone" | null>(null);
  const [dark, setDark] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", priority: "MEDIUM", dueDate: "" });
  const [milestoneForm, setMilestoneForm] = useState({ title: "", targetDate: "" });
  const [projectForm, setProjectForm] = useState({ name: "", description: "", priority: "MEDIUM", dueDate: "" });
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [report, setReport] = useState<any>(null);
  const [blockerReport, setBlockerReport] = useState<any>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<any[]>([]);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState<any>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<any>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const [taskMenu, setTaskMenu] = useState(false);
  const [dependencySource, setDependencySource] = useState("");
  const [commentTask, setCommentTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [taskActivity, setTaskActivity] = useState<any>(null);
  const [taskModalTab, setTaskModalTab] = useState<"comments" | "github">("comments");
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("TEAM_MEMBER");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const inviteHandled = useRef(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchMode, setSearchMode] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [notificationItems, setNotificationItems] = useState<any[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); }, []);

  useEffect(() => {
    if (!token) return;
    const result = new URLSearchParams(window.location.search).get("github");
    if (!result) return;
    notify(result === "connected" ? "GitHub connected. Link a repository from Settings." : result === "cancelled" ? "GitHub authorization was cancelled." : "GitHub could not be connected. Check the integration configuration and try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }, [token, notify]);

  useEffect(() => {
    if (!token) return;
    const googleResult = new URLSearchParams(window.location.search).get("google");
    if (!googleResult) return;
    notify(
      googleResult === "connected"
        ? "Google Workspace connected. Calendar and Gmail sync enabled."
        : googleResult === "cancelled"
        ? "Google authorization was cancelled."
        : "Google Workspace could not be connected. Check configuration and try again."
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, [token, notify]);
  const handleError = (e: unknown) => { setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."); };

  useEffect(() => {
    const existing = window.sessionStorage.getItem("nexora-token");
    const invitation = new URLSearchParams(window.location.search).get("invite");
    if (invitation) { setInviteToken(invitation); setAuthMode("register"); }
    const theme = window.localStorage.getItem("nexora-theme");
    if (theme === "dark") setDark(true);
    if (existing) { setToken(existing); api.setToken(existing); api.get("/auth/me").then((data: any) => { setUser(data.user); setWorkspace(data.workspace); setWorkspaces(data.workspaces ?? []); }).catch(() => { window.sessionStorage.removeItem("nexora-token"); setToken(""); }); }
  }, []);

  useEffect(() => {
    if (!inviteToken || !token || !user || inviteHandled.current) return;
    inviteHandled.current = true;
    (async () => {
      try {
        const accepted: any = await api.post("/organizations/invitations/accept", { token: inviteToken });
        const switched: any = await api.post("/auth/switch-workspace", { organizationId: accepted.organizationId });
        setToken(switched.accessToken); api.setToken(switched.accessToken); window.sessionStorage.setItem("nexora-token", switched.accessToken);
        const me: any = await api.get("/auth/me"); setWorkspaces(me.workspaces); setWorkspace(me.workspace); setPage("Overview");
        window.history.replaceState({}, "", window.location.pathname); setInviteToken(""); notify(`You joined ${accepted.organizationName}`);
      } catch (e) { inviteHandled.current = false; handleError(e); }
    })();
  }, [inviteToken, token, user, notify]);

  const refreshProjects = useCallback(async (activeId?: string) => {
    if (!token) return;
    const rows = await api.get("/projects") as Project[];
    setProjects(rows);
    const chosen = activeId || activeProjectId || rows[0]?.id || "";
    if (chosen) { setActiveProjectId(chosen); const detail = await api.get(`/projects/${chosen}`) as Project; setProject(detail); }
    else { setProject(null); setActiveProjectId(""); }
  }, [token, activeProjectId]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      await refreshProjects();
      setMembers(await api.get("/organizations/members") as any[]);
      const inbox: any = await api.get("/notifications");
      setNotificationItems(inbox.items ?? []); setUnreadNotifications(inbox.unreadCount ?? 0);
      if (page === "Settings") { const response = await api.get("/organizations/members") as any[]; setMembers(response); }
      if (page === "Activity") setAudit(await api.get("/audit") as any[]);
      if (page === "AI command") { const [proposals, portfolio] = await Promise.all([api.get("/ai/proposals"), api.get("/ai/intelligence")]); setRecentProposals(proposals as any[]); setIntelligence(portfolio); }
    } catch (e) { handleError(e); }
    finally { setLoading(false); }
  }, [token, page, refreshProjects]);

  useEffect(() => { if (token && user) refresh(); }, [token, user, page, refresh]);

  useEffect(() => {
    if (!token || query.trim().length < 2) { setSearchResults([]); setSearchMode(""); setSearchLoading(false); return; }
    setSearchLoading(true);
    const timer = window.setTimeout(() => api.get(`/search?q=${encodeURIComponent(query.trim())}`).then((result: any) => {
      setSearchResults(result.results ?? []); setSearchMode(result.mode ?? "keyword");
    }).catch(() => { setSearchResults([]); setSearchMode(""); }).finally(() => setSearchLoading(false)), 280);
    return () => window.clearTimeout(timer);
  }, [token, query]);

  const activeUserId = user?.id;
  useEffect(() => {
    if (!token || !workspace || !activeUserId) return;
    const userId = activeUserId;
    const next = io(API_URL.replace(/\/api$/, ""), { auth: { token }, transports: ["websocket"] });
    next.on("project.updated", (event: any) => {
      if (event.projectId === activeProjectId) api.get(`/projects/${event.projectId}`).then(setProject).catch(() => {});
      api.get("/projects").then(setProjects).catch(() => {});
    });
    next.on("comment.created", (event: any) => { if (event.taskId === commentTask?.id) api.get(`/tasks/${event.taskId}/comments`).then(setComments).catch(() => {}); });
    next.on("notification.created", () => api.get("/notifications").then((inbox: any) => { setNotificationItems(inbox.items ?? []); setUnreadNotifications(inbox.unreadCount ?? 0); }).catch(() => {}));
    setSocket(next);
    return () => { next.disconnect(); setSocket(null); };
  }, [token, workspace, activeProjectId, commentTask?.id, activeUserId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("global-search")?.focus(); }
      if (event.key === "Escape") { setModal(null); setNotificationsOpen(false); setCommentTask(null); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const activeTasks = useMemo(() => project?.tasks ?? [], [project?.tasks]);
  const doneCount = activeTasks.filter(t => t.status === "DONE").length;
  const countableTasks = activeTasks.filter(t => t.status !== "CANCELLED");
  const overdueCount = activeTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE" && t.status !== "CANCELLED").length;
  const blockedCount = activeTasks.filter(t => t.status === "BLOCKED").length;
  const progress = countableTasks.length ? Math.round(doneCount / countableTasks.length * 100) : 0;
  const filteredTasks = useMemo(() => activeTasks.filter(t => `${t.title} ${t.description}`.toLowerCase().includes(query.toLowerCase())), [activeTasks, query]);
  const filteredProjects = useMemo(() => projects.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())), [projects, query]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result: any = await api.post(authMode === "login" ? "/auth/login" : "/auth/register", authMode === "login" ? { email: form.email, password: form.password } : { ...form, inviteToken: inviteToken || undefined });
      setToken(result.accessToken); api.setToken(result.accessToken); window.sessionStorage.setItem("nexora-token", result.accessToken);
      const knownWorkspaces = result.workspaces ?? [{ ...result.workspace, name: form.organizationName || "My workspace" }];
      setUser(result.user); setWorkspace(knownWorkspaces.find((w: Workspace) => w.id === result.workspace.id) ?? result.workspace); setWorkspaces(knownWorkspaces);
      setPage("Overview"); notify(`Welcome${result.user.name ? `, ${result.user.name.split(" ")[0]}` : " back"}`);
    } catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function chooseWorkspace(next: Workspace) {
    if (!token) return;
    try { const res: any = await api.post("/auth/switch-workspace", { organizationId: next.id }); setToken(res.accessToken); api.setToken(res.accessToken); window.sessionStorage.setItem("nexora-token", res.accessToken); setWorkspace(next); setProject(null); setProjects([]); setProjectMenu(false); }
    catch (e) { handleError(e); }
  }
  function signOut() { void api.post("/auth/logout", {}).catch(() => {}); socket?.disconnect(); api.setToken(""); window.sessionStorage.removeItem("nexora-token"); setToken(""); setUser(null); setWorkspace(null); setProjects([]); setProject(null); }
  function toggleTheme() { const next = !dark; setDark(next); window.localStorage.setItem("nexora-theme", next ? "dark" : "light"); }
  async function readNotification(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`, {});
      const unread = notificationItems.some(item => item.id === id && !item.readAt);
      setNotificationItems(items => items.map(item => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item));
      if (unread) setUnreadNotifications(count => Math.max(0, count - 1));
    } catch (e) { handleError(e); }
  }
  async function readAllNotifications() {
    try {
      await api.patch("/notifications/read-all", {});
      setNotificationItems(items => items.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      setUnreadNotifications(0);
    } catch (e) { handleError(e); }
  }
  function openSearchResult(item: any) {
    if (item.type === "github_event" && typeof item.url === "string" && item.url.startsWith("https://github.com/")) { window.open(item.url, "_blank", "noopener,noreferrer"); return; }
    const resultProjectId = item.type === "project" ? item.id : item.projectId;
    if (resultProjectId) setActiveProjectId(resultProjectId);
    setPage(item.type === "meeting" || item.type.startsWith("meeting_") ? "Meetings" : item.type === "project" ? "Projects" : "My work");
    setQuery(item.title);
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const created: any = await api.post("/projects", { ...projectForm, dueDate: projectForm.dueDate || undefined }); setProjects([created, ...projects]); setActiveProjectId(created.id); setProject({ ...created, tasks: [] }); setProjectForm({ name: "", description: "", priority: "MEDIUM", dueDate: "" }); setModal(null); notify("Project created"); }
    catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function createTask(e: React.FormEvent) {
    e.preventDefault(); if (!project) return; setBusy(true);
    try { await api.post(`/projects/${project.id}/tasks`, { ...taskForm, dueDate: taskForm.dueDate || undefined }); await refreshProjects(project.id); setTaskForm({ title: "", description: "", priority: "MEDIUM", dueDate: "" }); setModal(null); notify("Task added to your project"); }
    catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function createMilestone(e: React.FormEvent) { e.preventDefault(); if (!project) return; setBusy(true); try { await api.post(`/projects/${project.id}/milestones`, { title: milestoneForm.title, targetDate: milestoneForm.targetDate || undefined }); await refreshProjects(project.id); setMilestoneForm({ title: "", targetDate: "" }); setModal(null); notify("Milestone added"); } catch (e) { handleError(e); } finally { setBusy(false); } }
  async function toggleMilestone(milestone: NonNullable<Project["milestones"]>[number]) { if (!project) return; try { await api.patch(`/milestones/${milestone.id}`, { completed: !milestone.completedAt }); await refreshProjects(project.id); notify(milestone.completedAt ? "Milestone reopened" : "Milestone completed"); } catch (e) { handleError(e); } }
  async function changeTask(task: Task, status: string) {
    try { const result: any = await api.patch(`/tasks/${task.id}`, { status }); await refreshProjects(project?.id); if (result.impact?.affectedTaskCount) notify(`${result.impact.affectedTaskCount} downstream task${result.impact.affectedTaskCount === 1 ? "" : "s"} may be affected`); else notify("Task updated"); }
    catch (e) { handleError(e); }
  }
  async function addDependency(e: React.FormEvent) {
    e.preventDefault(); if (!dependencySource) return; setBusy(true);
    try { await api.post(`/tasks/${dependencySource}/dependencies`, { blockedTaskId: (document.getElementById("blocked-task") as HTMLSelectElement).value }); await refreshProjects(project?.id); setModal(null); notify("Dependency saved"); }
    catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function openComments(task: Task) {
    setCommentTask(task);
    setCommentBody("");
    setTaskModalTab("comments");
    setTaskActivity(null);
    try { setComments(await api.get(`/tasks/${task.id}/comments`) as any[]); } catch (e) { handleError(e); }
    try {
      const act = await api.get(`/integrations/github/tasks/${task.id}/activity`);
      setTaskActivity(act);
    } catch {
      // non-blocking if github is not linked
    }
  }
  async function sendComment(e: React.FormEvent) { e.preventDefault(); if (!commentTask || !commentBody.trim()) return; setBusy(true); try { await api.post(`/tasks/${commentTask.id}/comments`, { body: commentBody.trim() }); setComments(await api.get(`/tasks/${commentTask.id}/comments`) as any[]); setCommentBody(""); notify("Comment added"); } catch (e) { handleError(e); } finally { setBusy(false); } }
  async function generatePlan(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const result = await api.post("/ai/plan", { brief, projectId: project?.id || undefined, projectName: project?.name || undefined }) as Proposal; setProposal(result); notify(result.provider === "local_rules" ? "Draft prepared with the local rule-based planner" : "Plan generated for review"); }
    catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function decideProposal(approved: boolean) {
    if (!proposal) return; setBusy(true);
    try {
      const res: any = await api.post(`/ai/proposals/${proposal.id}/${approved ? "approve" : "reject"}`, {});
      if (approved) { setActiveProjectId(res.project.id); await refreshProjects(res.project.id); notify(`${res.tasksCreated} tasks added to ${res.project.name}`); }
      else notify("Proposal declined; no project changes made");
      setProposal(null); setBrief(""); setModal(null); setPage(approved ? "Projects" : page);
    } catch (e) { handleError(e); } finally { setBusy(false); }
  }
  async function getReport() { if (!project) return; try { const r = await api.get(`/ai/projects/${project.id}/weekly-report`); setReport(r); } catch (e) { handleError(e); } }
  async function getBlockers() { if (!project) { notify("Create or select a project first"); return; } try { setBlockerReport(await api.get(`/ai/projects/${project.id}/blockers`)); } catch (e) { handleError(e); } }
  async function getDuplicates() { if (!project) { notify("Create or select a project first"); return; } try { const result: any = await api.get(`/ai/projects/${project.id}/duplicates`); setDuplicateCandidates(result.candidates ?? []); } catch (e) { handleError(e); } }
  async function askWorkspace(e: React.FormEvent) { e.preventDefault(); if (assistantQuestion.trim().length < 3) return; setAssistantLoading(true); setError(""); try { setAssistantAnswer(await api.post("/ai/ask", { question: assistantQuestion.trim() })); } catch (e) { handleError(e); } finally { setAssistantLoading(false); } }
  async function inviteMember(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const result: any = await api.post("/organizations/invitations", { email: inviteEmail, role: inviteRole }); setInviteLink(result.token); setMembers(await api.get("/organizations/members") as any[]); notify("Invitation created; delivery is not configured"); }
    catch (e) { handleError(e); } finally { setBusy(false); }
  }

  if (!token || !user) return <main className="auth-screen"><div className="auth-art"><div className="brand-lockup"><div className="brand-mark"><Blocks size={18}/></div><span>nexora</span></div><div className="auth-art-copy"><div className="eyebrow light"><span className="pulse-dot"/> YOUR TEAM, IN SYNC</div><h1>Good work<br/><span>moves together.</span></h1><p>One clear view of what your team is building, what needs attention, and what comes next.</p><div className="auth-art-stats"><div><strong>01</strong><span>one workspace</span></div><i/><div><strong>∞</strong><span>room to build</span></div></div></div><div className="auth-art-bottom"><span>Thoughtful work, thoughtfully organized.</span><span>© 2026 Nexora Systems</span></div><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/></div><section className="auth-panel"><div className="auth-mobile-brand"><div className="brand-mark"><Blocks size={18}/></div> nexora</div><div className="auth-box"><div className="eyebrow">GET STARTED</div><h2>{inviteToken ? "Join your team" : authMode === "login" ? "Welcome back" : "Start your workspace"}</h2><p className="auth-sub">{inviteToken ? "Create an account with the invited email, or sign in to accept the invitation." : authMode === "login" ? "Sign in to pick up where your team left off." : "Set up your account and bring the work together."}</p><form onSubmit={submitAuth} className="stack-form">{authMode === "register" && <><label>Your name<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Alex Morgan"/></label><label>Workspace name <span className="field-hint">Optional when joining an invitation</span><input minLength={2} value={form.organizationName} onChange={e => setForm({ ...form, organizationName: e.target.value })} placeholder="Acme Studio"/></label></>}<label>Email address<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@company.com"/></label><label>Password<input type="password" required minLength={authMode === "register" ? 10 : 1} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={authMode === "register" ? "At least 10 characters" : "Your password"}/>{authMode === "login" && <span className="field-hint">Demo workspace: demo@nexora.local / NexoraDemo!2026</span>}</label>{error && <div className="form-error">{error}</div>}<button className="button button-primary button-wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}{inviteToken ? authMode === "login" ? "Sign in to join" : "Create account and join" : authMode === "login" ? "Sign in to Nexora" : "Create your workspace"}<ArrowRight size={16}/></button></form><div className="auth-switch">{authMode === "login" ? "New to Nexora?" : "Already have an account?"}<button onClick={() => { setError(""); setAuthMode(authMode === "login" ? "register" : "login"); }}>{authMode === "login" ? "Create an account" : "Sign in"}</button></div><div className="secure-note"><ShieldCheck size={14}/> Your workspace data is private and tenant-isolated.</div></div><div className="auth-footer">© 2026 Nexora Systems <span>·</span> Privacy <span>·</span> Terms</div></section></main>;

  return <div className={`app-shell ${dark ? "dark" : ""}`}>
    <aside className="sidebar">
      <div className="side-brand"><div className="brand-mark"><Blocks size={17}/></div><span>nexora</span><button className="icon-button side-more" onClick={() => setProjectMenu(!projectMenu)}><MoreHorizontal size={18}/></button></div>
      <button className="workspace-switcher" onClick={() => setProjectMenu(!projectMenu)}><div className="workspace-avatar">{initials(workspace?.name)}</div><span className="workspace-name"><b>{workspace?.name || "My workspace"}</b><small>{workspace?.role?.toLowerCase().replaceAll("_", " ")}</small></span><ChevronDown size={15}/></button>
      {projectMenu && <div className="workspace-menu">{workspaces.map(w => <button key={w.id} onClick={() => chooseWorkspace(w)}><span className="workspace-avatar small">{initials(w.name)}</span><span>{w.name}<small>{w.role.toLowerCase().replaceAll("_", " ")}</small></span>{workspace?.id === w.id && <Check size={15}/>}</button>)}<button className="workspace-add" onClick={() => { setProjectMenu(false); setPage("Settings"); }}><Plus size={14}/> Manage workspace</button></div>}
      <div className="side-search" onClick={() => document.getElementById("global-search")?.focus()}><Search size={15}/><span>Search anything</span><kbd>⌘ K</kbd></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav">{([ ["Overview", LayoutDashboard], ["My work", CheckCheck], ["Projects", Blocks], ["Project Health", ShieldAlert], ["Meetings", CalendarDays], ["Calendar", CalendarDays], ["AI command", Sparkles], ["Inbox", Bell] ] as const).map(([name, Icon]) => <button key={name} className={`nav-link ${page === name ? "active" : ""}`} aria-label={name} onClick={() => setPage(name)}><Icon size={17}/><span>{name}</span>{name === "Inbox" && (blockedCount + overdueCount > 0) && <i className="nav-badge">{blockedCount + overdueCount}</i>}</button>)}</nav>
      <div className="side-projects-head"><span>YOUR PROJECTS</span><button className="icon-button" onClick={() => setModal("project")} title="Create project"><Plus size={16}/></button></div>
      <nav className="project-nav">{projects.slice(0, 5).map((p, i) => <button key={p.id} className={`project-nav-link ${activeProjectId === p.id ? "chosen" : ""}`} aria-label={p.name} onClick={() => { setPage("Projects"); setActiveProjectId(p.id); }}><span className={`project-dot dot-${i % 4}`}/><span>{p.name}</span><span className="project-count">{p._count?.tasks ?? 0}</span></button>)}{projects.length === 0 && <span className="side-empty">Your projects will appear here</span>}</nav>
      <div className="sidebar-spacer"/>
      <div className="side-bottom"><button className={`nav-link ${page === "Activity" ? "active" : ""}`} onClick={() => setPage("Activity")}><Activity size={17}/><span>Activity</span></button><button className={`nav-link ${page === "Settings" ? "active" : ""}`} onClick={() => setPage("Settings")}><Settings2 size={17}/><span>Settings</span></button><div className="profile-card"><div className="person-avatar">{initials(user.name)}</div><div className="profile-name"><b>{user.name}</b><small>{user.email}</small></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={15}/></button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><b>{page === "Projects" && project ? project.name : page}</b></div><div className="top-actions"><div className="top-search"><Search size={15}/><input id="global-search" placeholder="Search tasks, projects..." value={query} onChange={e => setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><button className="icon-button notification-trigger" onClick={() => { setNotificationsOpen(!notificationsOpen); if (!notificationsOpen) api.get("/notifications").then((inbox: any) => { setNotificationItems(inbox.items ?? []); setUnreadNotifications(inbox.unreadCount ?? 0); }).catch(() => {}); }} title="Notifications"><Bell size={17}/>{unreadNotifications > 0 && <i/>}</button><button className="help-button" onClick={() => notify("Nexora help center is coming soon") }><CircleHelp size={16}/></button><div className="top-avatar">{initials(user.name)}</div></div></header>
      {query.trim().length >= 2 && <div className="search-results-pop"><div className="search-results-head"><b>Workspace search</b><span>{searchLoading ? "Searching…" : searchMode === "hybrid" ? "Keyword + semantic" : searchMode === "keyword" ? "Keyword" : ""}</span></div>{searchLoading && !searchResults.length ? <div className="search-empty">Searching your workspace…</div> : searchResults.length ? searchResults.slice(0, 8).map((item: any) => <button className="search-result" key={`${item.type}:${item.id}`} onClick={() => openSearchResult(item)}><span className={`search-result-icon ${item.type}`}><Search size={13}/></span><span><b>{item.title}</b><small>{item.type} · {item.snippet}</small></span>{item.similarity != null && <em>{item.similarity}%</em>}</button>) : !searchLoading && <div className="search-empty">No matching workspace sources.</div>}</div>}
      {notificationsOpen && <div className="notification-pop"><div className="popover-head"><b>Notifications</b><button className="text-button" onClick={readAllNotifications} disabled={!unreadNotifications}>Mark all read</button></div>{notificationItems.length ? notificationItems.slice(0, 8).map((item: any) => <button className={`notice-row ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => { void readNotification(item.id); setPage("Inbox"); setNotificationsOpen(false); }}><span className={`notice-icon ${item.type === "RISK" || item.type === "DEADLINE" ? "amber" : "violet"}`}>{item.type === "RISK" ? <Zap size={14}/> : <Bell size={14}/>}</span><span><b>{item.title}</b><small>{item.body}</small></span></button>) : <div className="empty-pop"><Check size={16}/> You&apos;re all caught up.</div>}<button className="notification-all" onClick={() => { setPage("Inbox"); setNotificationsOpen(false); }}>Open inbox <ArrowRight size={12}/></button></div>}
      <div className="page-wrap">
        {error && <div className="global-error"><span>{error}</span><button onClick={() => setError("")}><X size={14}/></button></div>}
        {loading && !project && <div className="loading-page"><LoaderCircle className="spin" size={22}/> Loading your workspace…</div>}

        {page === "Overview" && <>
          <div className="welcome-row"><div><div className="eyebrow"><span className="pulse-dot"/> {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</div><h1>Good morning, {user.name.split(" ")[0]}<span className="wave">✳</span></h1><p className="page-subtitle">Here’s a clear view of what’s moving across your workspace.</p></div><div className="welcome-actions"><button className="button button-secondary" onClick={getReport}><FileText size={15}/> Weekly report</button><button className="button button-primary" onClick={() => setModal("task")}><Plus size={16}/> Add task</button></div></div>
          <div className="metric-grid"><MetricCard label="Active projects" value={projects.length.toString().padStart(2, "0")} meta="Across your workspace" icon={<Blocks size={16}/>} tone="violet"/><MetricCard label="Tasks in motion" value={activeTasks.filter(t => t.status === "IN_PROGRESS").length.toString().padStart(2, "0")} meta={`${doneCount} completed in this project`} icon={<Target size={16}/>} tone="mint"/><MetricCard label="Needs attention" value={(blockedCount + overdueCount).toString().padStart(2, "0")} meta={blockedCount ? `${blockedCount} blocked · ${overdueCount} overdue` : "No critical blockers"} icon={<Zap size={16}/>} tone={blockedCount + overdueCount ? "amber" : "blue"}/><MetricCard label="Team members" value={(members.length || "—").toString().padStart(2, "0")} meta={members.length ? "In your workspace" : "Invite your collaborators"} icon={<Users size={16}/>} tone="rose"/></div>
          <div className="overview-grid">
            <section className="panel focus-panel">
              <div className="panel-head"><div><div className="eyebrow">PROJECT PULSE</div><h2>{project?.name || "Your project pulse"}</h2></div><button className="text-button" onClick={() => setPage("Projects")}>View project <ArrowRight size={14}/></button></div>
              {project ? (
                <>
                  <div className="pulse-summary">
                    <div className="health-label"><span className={`health-dot ${blockedCount || overdueCount ? "risk" : "good"}`}/><b>{blockedCount || overdueCount ? "Needs a closer look" : "Everything on track"}</b><span className="health-divider"/>Updated just now</div>
                    <div className="progress-detail">
                      <div className="progress-ring" style={{ background: `conic-gradient(#6a5bd7 ${progress * 3.6}deg, #ececf2 0deg)` }}><div><b>{progress}</b><small>%</small></div></div>
                      <div className="progress-copy"><b>{doneCount} of {activeTasks.length} tasks completed</b><span>Project progress</span><div className="progress-track"><i style={{ width: `${progress}%` }}/></div></div>
                      <div className="due-callout"><small>PROJECT DUE</small><b>{dueLabel(project.dueDate)}</b><span>{project.dueDate ? new Date(project.dueDate).toLocaleDateString("en", { month: "long", day: "numeric" }) : "Set a deadline"}</span></div>
                    </div>
                  </div>
                  <div className="focus-bottom">
                    <div className="focus-alert"><span className={blockedCount || overdueCount ? "alert-mark" : "ok-mark"}>{blockedCount || overdueCount ? <Zap size={14}/> : <Check size={14}/>}</span><span><b>{blockedCount || overdueCount ? `${blockedCount + overdueCount} item${blockedCount + overdueCount === 1 ? "" : "s"} to review` : "Your team is in good shape"}</b><small>{blockedCount ? `${blockedCount} blocked task${blockedCount === 1 ? "" : "s"} could affect downstream work.` : overdueCount ? `${overdueCount} task${overdueCount === 1 ? " is" : "s are"} past the due date.` : "No overdue tasks or blockers detected."}</small></span></div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="button button-quiet" onClick={() => setPage("Project Health")}><ShieldAlert size={14}/> Project health</button>
                      <button className="button button-quiet" onClick={() => setPage("AI command")}><Sparkles size={14}/> AI command</button>
                    </div>
                  </div>
                </>
              ) : <EmptyProject onCreate={() => setModal("project")}/>}
            </section>
            <section className="panel due-panel"><div className="panel-head"><div><div className="eyebrow">COMING UP</div><h2>Upcoming deadlines</h2></div><button className="icon-button" onClick={() => setPage("My work")}><ArrowRight size={15}/></button></div>{activeTasks.filter(t => t.status !== "DONE" && t.status !== "CANCELLED").slice(0, 4).length ? <div className="upcoming-list">{activeTasks.filter(t => t.status !== "DONE" && t.status !== "CANCELLED").slice(0, 4).map((t, i) => <div className="upcoming-row" key={t.id}><div className={`date-tile ${t.status === "BLOCKED" ? "date-risk" : ""}`}><b>{t.dueDate ? new Date(t.dueDate).getDate().toString().padStart(2, "0") : "—"}</b><small>{t.dueDate ? new Date(t.dueDate).toLocaleDateString("en", { month: "short" }).toUpperCase() : "DATE"}</small></div><div className="upcoming-copy"><b>{t.title}</b><span>{t.status === "BLOCKED" ? "Blocked" : dueLabel(t.dueDate)}</span></div><span className={`priority-pip ${t.priority.toLowerCase()}`}/></div>)}</div> : <div className="empty-inline">No upcoming tasks yet. Add one to get started.</div>}<button className="full-text-link" onClick={() => setPage("My work")}>See all tasks <ArrowRight size={14}/></button></section>
          </div>
          <section className="panel task-preview-panel"><div className="panel-head"><div><div className="eyebrow">IN FLIGHT</div><h2>Recent tasks</h2></div><button className="text-button" onClick={() => setPage("My work")}>All tasks <ArrowRight size={14}/></button></div>{activeTasks.length ? <TaskTable tasks={activeTasks.slice(0, 5)} onStatus={changeTask} onDependency={t => { setDependencySource(t.id); setModal("dependency"); }} onComment={openComments}/>: <div className="empty-inline">Create your first project and tasks to see work come together here.</div>}</section>
        </>}

        {page === "Projects" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Projects <span className="count-pill">{projects.length}</span></h1><p className="page-subtitle">The plans your team is moving forward.</p></div><button className="button button-primary" onClick={() => setModal("project")}><Plus size={16}/> New project</button></div><div className="project-tabs"><button className="selected">All projects <span>{projects.length}</span></button><span className="tabs-spacer"/><div className="segmented"><button className={view === "Board" ? "selected" : ""} aria-label="Board view" onClick={() => setView("Board")}><Blocks size={14}/> Board</button><button className={view === "List" ? "selected" : ""} aria-label="List view" onClick={() => setView("List")}><List size={14}/> List</button></div></div>{projects.length ? view === "Board" ? <div className="project-grid">{filteredProjects.map((p, i) => { const activeTasks = p.tasks?.filter(t => t.status !== "CANCELLED") ?? []; const pct = activeTasks.length ? Math.round(activeTasks.filter(t => t.status === "DONE").length / activeTasks.length * 100) : 0; return <a href={`#project-${p.id}`} className={`project-card card-accent-${i % 4}`} key={p.id} onClick={event => { event.preventDefault(); setActiveProjectId(p.id); }}><div className="project-card-top"><div className={`project-symbol symbol-${i % 4}`}><Blocks size={17}/></div></div><h3>{p.name}</h3><p>{p.description || "No project description yet."}</p><div className="project-card-meta"><span className={`status-tag ${p.status.toLowerCase()}`}>{p.status.replaceAll("_", " ").toLowerCase()}</span><span><Clock3 size={13}/>{dueLabel(p.dueDate)}</span></div><div className="card-progress"><div><span>Progress</span><b>{pct}%</b></div><div className="progress-track"><i style={{ width: `${pct}%` }}/></div></div><div className="project-card-foot"><div className="avatar-stack"><span>{initials(p.owner?.name || user.name)}</span><span className="more-people">+{Math.max(0, members.length - 1)}</span></div><span>{p._count?.tasks ?? 0} tasks <ArrowUpRight size={13}/></span></div></a>; })}<button className="new-project-card" onClick={() => setModal("project")}><div><Plus size={18}/></div><b>Start a new project</b><span>Give your next idea a home</span></button></div> : <section className="panel project-list-panel"><div className="panel-head"><div><h2>All projects</h2><span className="muted-copy">Sorted by recently updated</span></div></div><div className="project-list">{filteredProjects.map(p => <button key={p.id} className="project-list-row" onClick={() => { setActiveProjectId(p.id); setPage("My work"); }}><div className="project-symbol symbol-0"><Blocks size={16}/></div><span><b>{p.name}</b><small>{p.description || "No description"}</small></span><span className={`status-tag ${p.status.toLowerCase()}`}>{p.status.toLowerCase().replaceAll("_", " ")}</span><span>{p._count?.tasks ?? 0} tasks</span><span>{dueLabel(p.dueDate)}</span><ChevronRight size={15}/></button>)}</div></section> : <div className="panel empty-projects"><div className="empty-graphic"><Blocks size={22}/><Plus size={14}/></div><h3>A good plan needs a place to live.</h3><p>Create your first project, then bring the team and the work together.</p><button className="button button-primary" onClick={() => setModal("project")}><Plus size={15}/> Create a project</button></div>}</>}

        {page === "My work" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow">PROJECT WORKSPACE</div><h1>{project?.name || "My work"}</h1><p className="page-subtitle">{project?.description || "Your team's tasks, blockers, and next steps."}</p></div><div className="welcome-actions"><button className="button button-secondary" onClick={() => setModal("dependency")}><GitBranch size={15}/> Add dependency</button><button className="button button-primary" onClick={() => setModal("task")}><Plus size={16}/> Add task</button><button className="button button-secondary" onClick={() => setModal("milestone")}><Target size={15}/> Milestone</button></div></div><div className="project-context-strip"><div className="project-context-icon"><Blocks size={16}/></div><select aria-label="Choose project" value={activeProjectId} onChange={e => setActiveProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className={`status-tag ${project?.status?.toLowerCase()}`}>{project?.status?.toLowerCase().replaceAll("_", " ")}</span><span className="strip-spacer"/><div className="view-toggle"><button className={view === "Board" ? "selected" : ""} aria-label="Board view" onClick={() => setView("Board")}><Blocks size={14}/></button><button className={view === "List" ? "selected" : ""} aria-label="List view" onClick={() => setView("List")}><List size={14}/></button><button className={view === "Graph" ? "selected" : ""} aria-label="Dependency graph view" onClick={() => setView("Graph")}><GitBranch size={14}/></button></div></div>{project?.milestones?.length ? <div className="milestone-strip"><div className="eyebrow">PROJECT MILESTONES</div>{project.milestones.map(m => <button key={m.id} className={`milestone-chip ${m.completedAt ? "complete" : ""}`} onClick={() => toggleMilestone(m)}><span>{m.completedAt ? <Check size={11}/> : <i/>}</span><b>{m.title}</b><small>{dueLabel(m.targetDate)}</small></button>)}</div> : null}{view === "Board" ? <div className="kanban-grid">{([ ["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["BLOCKED", "Blocked"], ["DONE", "Done"], ["CANCELLED", "Cancelled"] ] as const).map(([status, label]) => <div className="kanban-column" key={status} onDragOver={e => e.preventDefault()} onDrop={() => { if (draggedTask) changeTask(draggedTask, status); setDraggedTask(null); }}><div className="kanban-head"><span className={`kanban-status-dot ${status.toLowerCase()}`}/><b>{label}</b><span>{filteredTasks.filter(t => t.status === status).length}</span>{status === "TODO" && <button className="icon-button" onClick={() => setModal("task")}><Plus size={15}/></button>}</div><div className="kanban-cards">{filteredTasks.filter(t => t.status === status).map(task => <TaskCard key={task.id} task={task} onStatus={changeTask} onDependency={t => { setDependencySource(t.id); setModal("dependency"); }} onComment={openComments} onDragStart={setDraggedTask}/>)}</div></div>)}</div> : view === "List" ? <section className="panel"><TaskTable tasks={filteredTasks} onStatus={changeTask} onDependency={t => { setDependencySource(t.id); setModal("dependency"); }} onComment={openComments}/></section> : <DependencyGraph tasks={filteredTasks}/>}</>}

        {page === "Project Health" && (
          <ProjectHealthDashboard
            projects={projects}
            user={user}
            workspace={workspace}
            initialProjectId={activeProjectId}
            onOpenProject={(id: string) => {
              setActiveProjectId(id);
              void refreshProjects(id);
              setPage("My work");
            }}
            notify={notify}
          />
        )}

        {page === "Meetings" && <MeetingsWorkspace projects={projects} members={members} notify={notify} onOpenProject={id => { setActiveProjectId(id); setPage("My work"); }}/ >}

        {page === "Calendar" && <CalendarWorkspace projects={projects} members={members} notify={notify} onOpenProject={id => { setActiveProjectId(id); setPage("My work"); }} onOpenMeetings={() => setPage("Meetings")}/>}

        {page === "AI command" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow"><span className="spark-dot"><Sparkles size={11}/></span> NEXORA INTELLIGENCE</div><h1>AI command center</h1><p className="page-subtitle">Project intelligence that keeps people in charge.</p></div><span className="provider-pill"><span className="pulse-dot"/> {process.env.NEXT_PUBLIC_AI_PROVIDER ? "Connected provider" : "Review mode"}</span></div><div className="ai-hero"><div className="ai-hero-copy"><div className="ai-orb"><Sparkles size={20}/></div><div className="eyebrow light">PLAN WITH CONTEXT</div><h2>From a brief to a<br/>plan your team can trust.</h2><p>Turn a project brief into a structured first draft. Review every task, owner, date, and dependency before anything is created.</p><button className="button button-lime" onClick={() => { setProposal(null); setModal("plan"); }}>Create a project plan <ArrowRight size={15}/></button></div><div className="ai-hero-preview"><div className="preview-window"><div className="preview-window-head"><span><i/> PLAN PREVIEW</span><MoreHorizontal size={16}/></div><div className="preview-title">Launch your next product</div><div className="preview-sub">A proposed sequence · 6 tasks · 2 milestones</div><div className="preview-task"><span className="preview-check done"><Check size={12}/></span><span>Define launch requirements</span><small>HIGH</small></div><div className="preview-connector"/><div className="preview-task"><span className="preview-check"><i/></span><span>Build core product experience</span><small>MEDIUM</small></div><div className="preview-connector"/><div className="preview-task"><span className="preview-check"><i/></span><span>Prepare rollout and QA</span><small>MEDIUM</small></div><div className="preview-approval"><ShieldCheck size={14}/> Review required before creation</div></div></div></div><div className="ai-tool-grid"><button className="ai-tool-card" onClick={() => setModal("plan")}><span className="ai-tool-icon violet"><Sparkles size={17}/></span><b>Project brief to plan</b><span>Draft milestones and sequenced tasks for approval.</span><ArrowUpRight size={15}/></button><button className="ai-tool-card" onClick={getBlockers}><span className="ai-tool-icon amber"><Zap size={17}/></span><b>Blocker detection</b><span>{blockedCount || overdueCount ? `${blockedCount + overdueCount} potential risks in the selected project.` : "Find risks and see which work sits downstream."}</span><ArrowUpRight size={15}/></button><button className="ai-tool-card" onClick={getReport}><span className="ai-tool-icon mint"><FileText size={17}/></span><b>Weekly health report</b><span>Completed work, overdue items, risks, and next steps.</span><ArrowUpRight size={15}/></button><button className="ai-tool-card" onClick={getDuplicates}><span className="ai-tool-icon blue"><Blocks size={17}/></span><b>Duplicate work</b><span>Review similar tasks; no task is ever merged automatically.</span><ArrowUpRight size={15}/></button></div><section className="panel approval-panel"><div className="panel-head"><div><div className="eyebrow">HUMAN IN THE LOOP</div><h2>Recent AI proposals</h2></div><span className="safe-label"><ShieldCheck size={14}/> Nothing executes without approval</span></div>{Array.isArray(recentProposals) && recentProposals.length ? recentProposals.map((p: any) => <div className="proposal-row" key={p.id}><span className="proposal-mark"><Sparkles size={15}/></span><span><b>{p.title}</b><small>{p.status.toLowerCase()} · {new Date(p.createdAt).toLocaleDateString()}</small></span><span className={`proposal-status ${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span></div>) : <div className="empty-inline">There are no AI proposals yet. A proposal is always reviewed before it changes your workspace.</div>}</section></>}

        {page === "AI command" && <section className="panel ai-assistant-panel"><div className="panel-head"><div><div className="eyebrow"><Sparkles size={11}/> WORKSPACE Q&amp;A</div><h2>Ask with source citations</h2></div><span className="safe-label"><ShieldCheck size={13}/> Tenant-scoped sources</span></div><p className="muted-copy">Questions use only workspace search results. Matching notes and meeting transcripts are treated as source text, never instructions.</p><form className="assistant-form" onSubmit={askWorkspace}><input aria-label="Ask your workspace" minLength={3} maxLength={2000} value={assistantQuestion} onChange={e => setAssistantQuestion(e.target.value)} placeholder="What decision was made about the launch?"/><button className="button button-primary" disabled={assistantLoading || assistantQuestion.trim().length < 3}>{assistantLoading ? <LoaderCircle className="spin" size={14}/> : <Send size={14}/>} Ask</button></form>{assistantAnswer && <div className="assistant-response">{assistantAnswer.answer ? <p>{assistantAnswer.answer}</p> : <div className="assistant-not-configured">{assistantAnswer.message}</div>}{assistantAnswer.sources?.length > 0 && <div className="assistant-citations"><b>{assistantAnswer.citations?.length ? "Sources" : "Matching sources"}</b>{assistantAnswer.sources.map((source: any) => <button key={`${source.type}:${source.id}`} onClick={() => openSearchResult(source)}><span><b>{source.title}</b><small>{source.type.replaceAll("_", " ")} · {source.excerpt}</small></span><ArrowUpRight size={13}/></button>)}</div>}{assistantAnswer.providerAvailable && !assistantAnswer.citations?.length && assistantAnswer.answer && <small className="assistant-no-citations">No source citation was returned; verify this answer against the workspace records.</small>}</div>}</section>}

        {page === "AI command" && intelligence && <section className="panel intelligence-panel"><div className="panel-head"><div><div className="eyebrow">DETERMINISTIC PROJECT INTELLIGENCE</div><h2>Workspace health signals</h2></div><span className="muted-copy">Computed from current tasks and dates · {new Date(intelligence.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div><div className="intelligence-metrics">{[["At risk", intelligence.metrics.atRiskProjects], ["Overdue", intelligence.metrics.overdueTasks], ["Blocked", intelligence.metrics.blockedTasks], ["Unassigned critical", intelligence.metrics.unassignedCriticalTasks], ["Stale", intelligence.metrics.staleTasks], ["Date conflicts", intelligence.metrics.assignmentConflicts]].map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div>{intelligence.projects.some((item: any) => item.status !== "on_track") ? <div className="intelligence-projects">{intelligence.projects.filter((item: any) => item.status !== "on_track").slice(0, 8).map((item: any) => <button key={item.id} onClick={() => { setActiveProjectId(item.id); setPage("My work"); }}><span className={`health-dot ${item.status === "at_risk" ? "risk" : "good"}`}/><span><b>{item.name}</b><small>{item.reasons.length ? item.reasons.join(" · ") : `${item.staleCount} stale task(s) · ${item.upcomingMilestones.length} milestone(s) due soon`}</small></span><em>{item.progress}% done</em></button>)}</div> : <div className="empty-inline">No overdue tasks or blocked project work was detected.</div>}{intelligence.assignmentConflicts.length > 0 && <div className="intelligence-conflicts"><b>Same day assignment load</b>{intelligence.assignmentConflicts.slice(0, 5).map((group: any) => <span key={`${group.memberId}:${group.date}`}>{group.memberName} · {group.date} · {group.tasks.length} tasks</span>)}</div>}</section>}

        {page === "AI command" && blockerReport && <section className="panel approval-panel"><div className="panel-head"><div><div className="eyebrow">DEPENDENCY ANALYSIS</div><h2>Blockers and downstream impact</h2></div><span className={`status-tag ${blockerReport.health}`}>{blockerReport.health.replaceAll("_", " ")}</span></div><p className="muted-copy">{blockerReport.recommendation}</p>{blockerReport.risks.length ? blockerReport.risks.map((risk: any) => <div className="proposal-row" key={risk.id}><span className="notice-icon amber"><Zap size={14}/></span><span><b>{risk.title}</b><small>{risk.reason} · {risk.affectedTaskCount} directly affected</small></span></div>) : <div className="empty-inline">No overdue or blocked tasks were found.</div>}{blockerReport.downstreamImpact.length > 0 && <div className="report-actions"><b>Downstream work to review</b>{blockerReport.downstreamImpact.map((task: any) => <span key={task.id}><ArrowRight size={12}/>{task.title} <small>· {task.reason}</small></span>)}</div>}</section>}
        {page === "AI command" && duplicateCandidates.length > 0 && <section className="panel approval-panel"><div className="panel-head"><div><div className="eyebrow">POSSIBLE OVERLAP</div><h2>Similar tasks to review</h2></div><span className="safe-label">Token similarity · no automatic changes</span></div>{duplicateCandidates.map((candidate: any) => <div className="proposal-row" key={`${candidate.taskA.id}-${candidate.taskB.id}`}><span className="proposal-mark"><Blocks size={14}/></span><span><b>{candidate.taskA.title} ↔ {candidate.taskB.title}</b><small>{candidate.reason}</small></span><span className="proposal-status">{candidate.similarity}%</span></div>)}</section>}
        {page === "Inbox" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow">STAY IN THE LOOP</div><h1>Inbox</h1><p className="page-subtitle">Personal notifications and current workspace risks.</p></div><button className="button button-secondary" onClick={() => setPage("Activity")}><Activity size={15}/> Full activity</button></div><section className="panel inbox-panel"><div className="panel-head"><div><h2>Notifications</h2><span className="muted-copy">{unreadNotifications} unread · latest 50</span></div><button className="text-button" onClick={readAllNotifications} disabled={!unreadNotifications}>Mark all read</button></div>{notificationItems.length ? notificationItems.map((item: any) => <button className={`inbox-item notification-inbox-item ${item.readAt ? "read" : "unread"}`} key={item.id} onClick={() => void readNotification(item.id)}><span className={`notice-icon ${item.type === "RISK" || item.type === "DEADLINE" ? "amber" : "violet"}`}>{item.type === "RISK" ? <Zap size={15}/> : <Bell size={15}/>}</span><span><b>{item.title}</b><small>{item.body} · {new Date(item.createdAt).toLocaleString()}</small></span><span className="notification-state">{item.readAt ? "Read" : "Unread"}</span></button>) : <div className="inbox-empty"><div><CheckCheck size={20}/></div><h3>You’re all caught up</h3><p>New assignments, comments, mentions, and risks will appear here.</p></div>}</section>{blockedCount + overdueCount > 0 && <section className="panel inbox-panel"><div className="panel-head"><div><h2>Project attention</h2><span className="muted-copy">Current signals in {project?.name || "your active project"}</span></div></div><div className="inbox-item"><span className="notice-icon amber"><Zap size={15}/></span><span><b>{blockedCount} blocked and {overdueCount} overdue tasks</b><small>Review downstream impact before changing dates.</small></span><button className="button button-secondary small-button" onClick={() => setPage("AI command")}>Review risk <ArrowRight size={13}/></button></div></section>}</>}

        {page === "Activity" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow">WORKSPACE HISTORY</div><h1>Activity</h1><p className="page-subtitle">A clear record of decisions and changes.</p></div><span className="safe-label"><ShieldCheck size={14}/> Append-only audit trail</span></div><section className="panel activity-panel"><div className="panel-head"><div><h2>Recent activity</h2><span className="muted-copy">The last 50 events in {workspace?.name}</span></div><button className="icon-button" onClick={() => refresh()}><ArrowRight size={15}/></button></div><ActivityList events={audit}/></section></>}

        {page === "Settings" && <><div className="welcome-row compact-welcome"><div><div className="eyebrow">WORKSPACE PREFERENCES</div><h1>Settings</h1><p className="page-subtitle">Manage your team, connections, and the way Nexora looks.</p></div></div><div className="settings-layout"><div className="settings-nav"><button className="selected"><Users size={15}/> Members</button><button onClick={() => notify("Integration connections can be enabled after OAuth credentials are configured.")}><GitBranch size={15}/> Integrations</button><button onClick={toggleTheme}><Zap size={15}/> Appearance <span>{dark ? "Dark" : "Light"}</span></button><button onClick={() => notify("Security settings are managed by workspace owners.")}><ShieldCheck size={15}/> Security</button></div><div className="settings-content"><section className="panel settings-panel"><div className="panel-head"><div><div className="eyebrow">YOUR TEAM</div><h2>Workspace members</h2></div><button className="button button-primary small-button" onClick={() => { setInviteLink(""); setModal("invite"); }}><Plus size={14}/> Invite member</button></div><div className="member-list">{members.map((m, i) => <div className="member-row" key={m.id}><div className="person-avatar" style={{ background: avatarColors[i % avatarColors.length] }}>{initials(m.user.name)}</div><span><b>{m.user.name}</b><small>{m.user.email}</small></span><span className="role-chip">{m.role.toLowerCase().replaceAll("_", " ")}</span></div>)}{!members.length && <div className="empty-inline">Members will appear after the workspace loads.</div>}</div><div className="settings-hint"><ShieldCheck size={15}/><span>Roles are checked on the server for every write. Invitations are created securely; email delivery needs SMTP configuration.</span></div></section><section className="panel settings-panel"><div className="panel-head"><div><div className="eyebrow">CONNECTED TOOLS</div><h2>Integrations</h2></div><span className="status-tag planning">SETUP</span></div><div className="integration-row"><div className="integration-icon github-mark">GH</div><span><b>GitHub</b><small>Repository activity and pull requests</small></span><span className="integration-status">Not connected</span><button className="button button-secondary small-button" onClick={() => notify("GitHub OAuth requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET")}>Configure</button></div><div className="integration-row"><div className="integration-icon google-mark">G</div><span><b>Google Calendar</b><small>Project meetings and schedules</small></span><span className="integration-status">Not connected</span><button className="button button-secondary small-button" onClick={() => notify("Google OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")}>Configure</button></div><div className="integration-row"><div className="integration-icon gmail-mark"><MessageSquare size={15}/></div><span><b>Gmail</b><small>Authorized email context</small></span><span className="integration-status">Not connected</span><button className="button button-secondary small-button" onClick={() => notify("Gmail access requires configured Google OAuth scopes")}>Configure</button></div></section><section className="panel settings-panel appearance-panel"><div><div className="eyebrow">PERSONALIZATION</div><h2>Appearance</h2><p>Choose a comfortable theme for your workspace.</p></div><button className={`theme-switch ${dark ? "on" : ""}`} onClick={toggleTheme}><i/>{dark ? "Dark mode" : "Light mode"}</button></section></div></div></>}
        {page === "Settings" && <GitHubIntegration projects={projects} canManage={workspace?.role === "OWNER" || workspace?.role === "ADMIN"} notify={notify}/>}
        {page === "Settings" && <StorageManagement projects={projects} canManage={workspace?.role === "OWNER" || workspace?.role === "ADMIN"} notify={notify}/>}
        {page === "Settings" && <GoogleWorkspaceIntegration projects={projects} canManage={workspace?.role === "OWNER" || workspace?.role === "ADMIN"} notify={notify}/>}
      </div>
    </main>

    {report && page !== "Inbox" && <div className="report-float"><ReportView report={report}/><button onClick={() => setReport(null)}><X size={14}/></button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><div className={`modal-card ${modal === "plan" ? "plan-modal" : ""}`}><div className="modal-head"><div><div className="eyebrow">{modal === "plan" ? "AI PROJECT PLANNER" : modal === "project" ? "PROJECT SETUP" : modal === "task" ? "QUICK CAPTURE" : modal === "invite" ? "WORKSPACE TEAM" : modal === "milestone" ? "PROJECT MILESTONE" : "TASK DEPENDENCY"}</div><h2>{modal === "plan" ? proposal ? "Review your proposed plan" : "Start with the brief" : modal === "project" ? "Create a project" : modal === "task" ? "Add a task" : modal === "invite" ? inviteLink ? "Invitation created" : "Invite a collaborator" : modal === "milestone" ? "Add a milestone" : "Link a dependency"}</h2></div><button className="icon-button" onClick={() => setModal(null)}><X size={18}/></button></div>
        {modal === "project" && <form className="modal-form" onSubmit={createProject}><label>Project name<input required minLength={2} maxLength={120} autoFocus value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="e.g. Product launch"/></label><label>Description<textarea rows={3} value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} placeholder="What will this team deliver?"/></label><div className="form-row"><label>Priority<select value={projectForm.priority} onChange={e => setProjectForm({ ...projectForm, priority: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label>Target date<input type="date" value={projectForm.dueDate} onChange={e => setProjectForm({ ...projectForm, dueDate: e.target.value })}/></label></div><ModalFooter busy={busy} submitLabel="Create project" onCancel={() => setModal(null)}/></form>}
        {modal === "task" && <form className="modal-form" onSubmit={createTask}><div className="form-project-chip"><span className="project-dot dot-0"/><select value={activeProjectId} onChange={e => setActiveProjectId(e.target.value)} required>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></div><label>Task name<input required minLength={2} autoFocus value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="What needs to get done?"/></label><label>Description<textarea rows={3} value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Add context for the team…"/></label><div className="form-row"><label>Priority<select value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label>Due date<input type="date" value={taskForm.dueDate} onChange={e => setTaskForm({ ...taskForm, dueDate: e.target.value })}/></label></div><ModalFooter busy={busy} submitLabel="Add task" onCancel={() => setModal(null)}/></form>}
        {modal === "milestone" && <form className="modal-form" onSubmit={createMilestone}><p className="modal-copy">Mark a meaningful delivery point for the project. Milestones can be completed or reopened from the project view.</p><label>Milestone name<input required minLength={2} maxLength={160} autoFocus value={milestoneForm.title} onChange={e => setMilestoneForm({ ...milestoneForm, title: e.target.value })} placeholder="e.g. Beta release ready"/></label><label>Target date<input type="date" value={milestoneForm.targetDate} onChange={e => setMilestoneForm({ ...milestoneForm, targetDate: e.target.value })}/></label><ModalFooter busy={busy} submitLabel="Add milestone" onCancel={() => setModal(null)}/></form>}
        {modal === "dependency" && <form className="modal-form" onSubmit={addDependency}><p className="modal-copy">Mark one task as a blocker for another. Nexora checks the full dependency graph to prevent circular chains.</p><label>Blocking task<select required value={dependencySource} onChange={e => setDependencySource(e.target.value)}><option value="">Choose a task</option>{activeTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><div className="dependency-arrow"><GitBranch size={15}/> blocks <ArrowDownRight size={15}/></div><label>Blocked task<select id="blocked-task" required><option value="">Choose a task</option>{activeTasks.filter(t => t.id !== dependencySource).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><ModalFooter busy={busy} submitLabel="Save dependency" onCancel={() => setModal(null)}/></form>}
        {modal === "plan" && !proposal && <form className="modal-form" onSubmit={generatePlan}><div className="modal-ai-note"><Sparkles size={16}/><span>AI plans are proposals. Review the draft before tasks are added to your workspace.</span></div><label>What are you planning?<textarea autoFocus required minLength={20} maxLength={8000} rows={7} value={brief} onChange={e => setBrief(e.target.value)} placeholder="Describe the outcome, key deliverables, constraints, and any dates or team members that were explicitly agreed…"/></label><div className="brief-footer"><span>{brief.length}/8,000 characters</span><span>Names are only assigned when you explicitly identify a team member.</span></div>{error && <div className="form-error">{error}</div>}<ModalFooter busy={busy} submitLabel="Generate plan draft" onCancel={() => setModal(null)} icon={<Sparkles size={14}/>}/></form>}
        {modal === "plan" && proposal && <div className="proposal-review"><div className="proposal-project"><span className="project-symbol symbol-0"><Blocks size={16}/></span><span><b>{proposal.proposed.projectName}</b><small>{proposal.proposed.projectDescription}</small></span></div><div className="review-summary"><span><b>{proposal.proposed.tasks.length}</b> proposed tasks</span><span><b>{proposal.proposed.milestones.length}</b> milestones</span><span className="review-provider">{proposal.provider === "local_rules" ? "Local draft" : "AI generated"}</span></div>{proposal.proposed.assumptions?.length > 0 && <div className="assumption-note"><CircleHelp size={14}/><span><b>Assumptions to review</b><small>{proposal.proposed.assumptions.join(" ")}</small></span></div>}<div className="review-task-list">{proposal.proposed.tasks.map((t, i) => <div className="review-task" key={i}><span className="review-index">{String(i + 1).padStart(2, "0")}</span><span><b>{t.title}</b><small>{t.description || (t.blockedBy?.length ? `Depends on task ${t.blockedBy.map(x => x + 1).join(", ")}` : "No description supplied")}</small></span><span className={`priority-label ${t.priority?.toLowerCase()}`}>{t.priority || "MEDIUM"}</span><span className="review-due">{t.dueDate ? dueLabel(t.dueDate) : "No date"}</span></div>)}</div><div className="review-footer"><span><ShieldCheck size={14}/> Changes are logged in the workspace audit.</span><div><button className="button button-secondary" disabled={busy} onClick={() => decideProposal(false)}>Decline</button><button className="button button-primary" disabled={busy} onClick={() => decideProposal(true)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} Approve and create</button></div></div></div>}
        {modal === "invite" && <form className="modal-form" onSubmit={inviteMember}>{inviteLink ? <div className="invite-result"><div className="invite-result-icon"><Check size={18}/></div><h3>Secure invite is ready</h3><p>Token stored as a hash. Copy this one-time invite token for delivery; email sending is not set up yet.</p><code>{inviteLink}</code><button type="button" className="button button-secondary button-wide" onClick={() => navigator.clipboard?.writeText(inviteLink).then(() => notify("Invite token copied"))}><FileText size={14}/> Copy invite token</button></div> : <><label>Email address<input autoFocus type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="teammate@company.com"/></label><label>Workspace role<select value={inviteRole} onChange={e => setInviteRole(e.target.value)}><option value="TEAM_MEMBER">Team member</option><option value="PROJECT_MANAGER">Project manager</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option></select></label><p className="field-hint">Only owners and admins can create invitations.</p><ModalFooter busy={busy} submitLabel="Create invitation" onCancel={() => setModal(null)}/></>}</form>}
      </div></div>}
    {commentTask && (
      <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setCommentTask(null); }}>
        <section className="comment-modal">
          <div className="comment-modal-head">
            <div>
              <div className="eyebrow">TASK DETAILS & ACTIVITY</div>
              <h2>{commentTask.title}</h2>
            </div>
            <button className="icon-button" aria-label="Close task discussion" onClick={() => setCommentTask(null)}>
              <X size={18}/>
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "10px 0 8px", borderBottom: "1px solid var(--line)" }}>
            <div className="segmented">
              <button className={taskModalTab === "comments" ? "selected" : ""} onClick={() => setTaskModalTab("comments")}>
                <MessageSquare size={12}/> Comments ({comments.length})
              </button>
              <button className={taskModalTab === "github" ? "selected" : ""} onClick={() => setTaskModalTab("github")}>
                <GitBranch size={12}/> GitHub Activity ({(taskActivity?.events?.length || 0) + (taskActivity?.runs?.length || 0)})
              </button>
            </div>
            <button
              type="button"
              className="button button-secondary small-button"
              style={{ fontSize: "8.5px", padding: "3px 8px", height: "26px" }}
              onClick={() => {
                navigator.clipboard?.writeText(`NEXORA-TASK:${commentTask.id}`).then(() => notify(`Task ref NEXORA-TASK:${commentTask.id.slice(0, 8)}… copied`));
              }}
              title="Click to copy task reference"
            >
              <Copy size={11}/> NEXORA-TASK:{commentTask.id.slice(0, 8)}…
            </button>
          </div>

          {taskModalTab === "comments" ? (
            <>
              <div className="comment-list">
                {comments.length ? comments.map((comment: any) => (
                  <div className="comment-item" key={comment.id}>
                    <div className="person-avatar">{initials(comment.author.name)}</div>
                    <div>
                      <div className="comment-meta">
                        <b>{comment.author.name}</b>
                        <time>{new Date(comment.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                      </div>
                      <p>{comment.body}</p>
                    </div>
                  </div>
                )) : (
                  <div className="comment-empty">
                    <MessageSquare size={17}/>
                    <span>No comments yet. Start the conversation with your team.</span>
                  </div>
                )}
              </div>
              <form className="comment-form" onSubmit={sendComment}>
                <textarea rows={3} required maxLength={5000} value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder="Write a comment…"/>
                <div>
                  <span>{user.name} · Workspace members can reply</span>
                  <button className="button button-primary small-button" disabled={busy || !commentBody.trim()}>
                    <Send size={13}/> Send
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div style={{ minHeight: "220px", maxHeight: "390px", overflowY: "auto", padding: "10px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ padding: "9px 12px", background: "var(--panel-wash, #f7f7fa)", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "9px" }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: "3px", display: "flex", alignItems: "center", gap: "5px" }}>
                  <GitBranch size={13} style={{ color: "#7b68ee" }}/> Link PRs & Commits to this Task
                </div>
                <div style={{ color: "#7d8690", lineHeight: 1.4 }}>
                  Include <code style={{ background: "#ede9fe", color: "#5b21b6", padding: "1px 5px", borderRadius: "4px", fontSize: "9px" }}>NEXORA-TASK:{commentTask.id}</code> in your pull request description or commit message to record linked history and trigger workflow automations.
                </div>
              </div>

              {taskActivity?.runs?.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: "6px" }}>AUTOMATION RUNS ({taskActivity.runs.length})</div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {taskActivity.runs.map((run: any) => (
                      <div key={run.id} style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px", background: "var(--surface)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                          <b style={{ color: "var(--ink)" }}>{run.ruleName}</b>
                          <span className={`status-tag ${run.status.toLowerCase()}`}>{run.status.replaceAll("_", " ")}</span>
                        </div>
                        <div style={{ color: "#7d8690", fontSize: "8px" }}>
                          <span>Trigger: {run.triggerEvent?.replaceAll("_", " ")}</span>
                          {run.targetStatus && <span> · Target: {run.targetStatus}</span>}
                          {run.executedAt && <span> · {new Date(run.executedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
                        </div>
                        {run.proposalNotes && <div style={{ marginTop: "4px", fontStyle: "italic", color: "#6366f1" }}>{run.proposalNotes}</div>}
                        {run.rejectionReason && <div style={{ marginTop: "4px", color: "#ef4444" }}>Reason: {run.rejectionReason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {taskActivity?.events?.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: "6px" }}>LINKED GITHUB ACTIVITY ({taskActivity.events.length})</div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {taskActivity.events.map((evt: any) => (
                      <div key={evt.id} style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px", background: "var(--surface)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, color: "var(--ink)" }}>{evt.repository}</span>
                          <time style={{ color: "#9ba1a9", fontSize: "8px" }}>{new Date(evt.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                        </div>
                        <div style={{ color: "#7d8690", fontSize: "8.5px", marginTop: "2px" }}>
                          Action: <b>{evt.action}</b> by @{evt.sender}
                          {evt.payload?.pull_request?.title && (
                            <div style={{ marginTop: "2px", color: "#475569" }}>
                              PR #{evt.payload.pull_request.number}: {evt.payload.pull_request.title}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!taskActivity?.runs?.length && !taskActivity?.events?.length) && (
                <div className="comment-empty" style={{ minHeight: "120px" }}>
                  <GitBranch size={17}/>
                  <span>No GitHub activity linked yet. Include the task ref in your PR or commit.</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    )}
    {toast && <div className="toast"><span><Check size={14}/></span>{toast}</div>}
  </div>;
}

function MetricCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: React.ReactNode; tone: string }) { return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className="metric-meta">{meta}</div></div>; }
function EmptyProject({ onCreate }: { onCreate: () => void }) { return <div className="empty-focus"><div className="empty-focus-art"><Target size={20}/><span><Plus size={12}/></span></div><div><b>Your first project starts here.</b><small>Build a shared plan, then turn it into clear, trackable work.</small></div><button className="button button-secondary small-button" onClick={onCreate}><Plus size={14}/> Create project</button></div>; }
function TaskTable({ tasks, onStatus, onDependency, onComment }: { tasks: Task[]; onStatus: (task: Task, status: string) => void; onDependency: (task: Task) => void; onComment?: (task: Task) => void }) {
  return <div className="task-table-wrap"><table className="task-table"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due date</th><th>Actions</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id}><td><div className="table-task-name"><span className={`task-status-icon ${task.status.toLowerCase()}`}>{task.status === "DONE" ? <Check size={12}/> : task.status === "BLOCKED" ? <Zap size={11}/> : <i/>}</span><span><b>{task.title}</b>{task.description && <small>{task.description}</small>}{task.blockedBy?.length ? <em><GitBranch size={10}/> blocked by {task.blockedBy[0].blockingTask.title}</em> : null}</span></div></td><td><select className={`status-select ${task.status.toLowerCase()}`} aria-label={`Change ${task.title} status`} value={task.status} onChange={e => onStatus(task, e.target.value)}><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="BLOCKED">Blocked</option><option value="IN_REVIEW">In review</option><option value="DONE">Done</option><option value="CANCELLED">Cancelled</option></select></td><td><span className={`priority-text ${task.priority.toLowerCase()}`}><i/>{task.priority.toLowerCase()}</span></td><td><span className="table-assignee"><i>{initials(task.assignee?.name || "?")}</i>{task.assignee?.name || "Unassigned"}</span></td><td><span className={`date-text ${task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "DONE" && task.status !== "CANCELLED" ? "overdue" : ""}`}>{dueLabel(task.dueDate)}</span></td><td><div className="row-actions"><button className="icon-button" title={`Comments for ${task.title}`} aria-label={`Comments for ${task.title}`} onClick={() => onComment?.(task)}><MessageSquare size={14}/></button><button className="icon-button" title={`Add dependency for ${task.title}`} aria-label={`Add dependency for ${task.title}`} onClick={() => onDependency(task)}><GitBranch size={14}/></button></div></td></tr>)}</tbody></table>{!tasks.length && <div className="empty-inline">No tasks match this view yet.</div>}</div>;
}
function TaskCard({ task, onStatus, onDependency, onComment, onDragStart }: { task: Task; onStatus: (task: Task, status: string) => void; onDependency: (task: Task) => void; onComment?: (task: Task) => void; onDragStart?: (task: Task) => void }) {
  return <article className="task-card" draggable onDragStart={() => onDragStart?.(task)}><div className="task-card-top"><span className={`task-status-icon ${task.status.toLowerCase()}`}>{task.status === "DONE" ? <Check size={11}/> : task.status === "BLOCKED" ? <Zap size={10}/> : <i/>}</span><div className="row-actions"><button className="icon-button" onClick={() => onComment?.(task)} title={`Comments for ${task.title}`} aria-label={`Comments for ${task.title}`}><MessageSquare size={14}/></button><button className="icon-button" onClick={() => onDependency(task)} title="Add dependency"><GitBranch size={14}/></button></div></div><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}{task.blockedBy?.length ? <div className="task-dependency"><GitBranch size={11}/> Blocked by {task.blockedBy.map(b => b.blockingTask.title).join(", ")}</div> : null}<div className="task-card-foot"><span className={`priority-pill ${task.priority.toLowerCase()}`}><i/>{task.priority.toLowerCase()}</span><span className={`due-mini ${task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "DONE" && task.status !== "CANCELLED" ? "overdue" : ""}`}><CalendarDays size={12}/>{dueLabel(task.dueDate)}</span><select aria-label={`Change ${task.title} status`} value={task.status} onChange={e => onStatus(task, e.target.value)}><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="BLOCKED">Blocked</option><option value="IN_REVIEW">In review</option><option value="DONE">Done</option><option value="CANCELLED">Cancelled</option></select></div></article>;
}
function TaskFlowNode({ data }: NodeProps) {
  const task = data.task as Task;
  return <div className={`flow-task ${task.status.toLowerCase()}`}><Handle type="target" position={Position.Left}/><div className="flow-task-head"><span className={`kanban-status-dot ${task.status.toLowerCase()}`}/><small>{task.status.replaceAll("_", " ").toLowerCase()}</small></div><b>{task.title}</b><span className="flow-task-foot"><span className={`priority-pip ${task.priority.toLowerCase()}`}/>{task.priority.toLowerCase()}<span>{dueLabel(task.dueDate)}</span></span><Handle type="source" position={Position.Right}/></div>;
}
const dependencyNodeTypes = { task: TaskFlowNode };
function DependencyGraph({ tasks }: { tasks: Task[] }) {
  const nodes = useMemo<Node[]>(() => tasks.map((task, index) => ({ id: task.id, type: "task", position: { x: (index % 3) * 255, y: Math.floor(index / 3) * 118 }, data: { task } })), [tasks]);
  const edges = useMemo<Edge[]>(() => tasks.flatMap(task => (task.blockedBy ?? []).map(edge => ({ id: `${edge.blockingTask.id}-${task.id}`, source: edge.blockingTask.id, target: task.id, type: "smoothstep", animated: edge.blockingTask.status === "BLOCKED", markerEnd: { type: "arrowclosed" as const, color: "#8275db" }, style: { stroke: "#8275db", strokeWidth: 1.5 } }))), [tasks]);
  return <section className="panel dependency-graph"><div className="graph-head"><div><div className="eyebrow">TASK SEQUENCE</div><h2>Dependency map</h2></div><span><GitBranch size={13}/>{edges.length} relationship{edges.length === 1 ? "" : "s"}</span></div>{!edges.length && <div className="graph-hint">Add a dependency to show which work needs to finish first. Tasks are positioned for readability; connect them with the dependency action.</div>}<div className="graph-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={dependencyNodeTypes} fitView fitViewOptions={{ padding: 0.25 }} nodesConnectable={false} nodesDraggable={false} elementsSelectable><Background color="#a8a4bf" gap={22} size={1}/><Controls showInteractive={false}/></ReactFlow></div></section>;
}
function ModalFooter({ busy, submitLabel, onCancel, icon }: { busy: boolean; submitLabel: string; onCancel: () => void; icon?: React.ReactNode }) { return <div className="modal-footer"><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : icon}{submitLabel}</button></div>; }
function ActivityList({ events }: { events: any[] }) { return <div className="activity-list">{events.length ? events.map((event: any) => <div className="activity-row" key={event.id}><span className={`activity-event-icon ${event.actorType?.toLowerCase()}`}><Activity size={14}/></span><span><b>{event.actor?.name || (event.actorType === "AI" ? "Nexora AI" : "System")}</b> {event.action?.replaceAll(".", " ").replaceAll("_", " ")}<small>{event.targetType?.replaceAll("_", " ")} {event.targetId ? `· ${event.targetId.slice(0, 8)}` : ""}</small></span><time>{new Date(event.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>) : <div className="inbox-empty"><div><Activity size={19}/></div><h3>No activity yet</h3><p>Project and workspace changes will leave a record here.</p></div>}</div>; }
function ReportView({ report }: { report: any }) { return <div className="report-view"><div className="report-head"><span className="ai-tool-icon mint"><FileText size={15}/></span><span><b>Weekly health · {report.project}</b><small>{new Date(report.periodStart).toLocaleDateString()} – {new Date(report.periodEnd).toLocaleDateString()}</small></span><span className={`status-tag ${report.health === "at_risk" ? "at_risk" : "active"}`}>{report.health.replaceAll("_", " ")}</span></div><div className="report-stats"><span><b>{report.completed.length}</b> completed</span><span><b>{report.overdue.length}</b> overdue</span><span><b>{report.blockers.length}</b> blockers</span><span><b>{report.upcoming.length}</b> due soon</span></div>{report.suggestedActions.length ? <div className="report-actions"><b>Suggested actions</b>{report.suggestedActions.map((x: string, i: number) => <span key={i}><ArrowRight size={12}/>{x}</span>)}</div> : <p className="report-clear">No corrective actions needed at the moment.</p>}</div>; }
