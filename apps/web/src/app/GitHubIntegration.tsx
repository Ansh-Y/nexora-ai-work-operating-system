"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Project = { id: string; name: string };
type Repository = { id: string; fullName: string; project: Project; _count: { events: number }; webhookSecretCiphertext?: string | null };
type AvailableRepository = { id: string; fullName: string; isPrivate: boolean; defaultBranch: string | null };
type GitHubStatus = { configured: boolean; encryptionReady: boolean; connected: boolean; account?: { githubLogin: string; scopes: string[] }; repositories: Repository[]; webhookBaseUrl: string | null };
type GitHubEvent = { id: string; eventType: string; action?: string | null; title?: string | null; url?: string | null; occurredAt: string; repository: { fullName: string; project: Project }; linkedTask?: { id: string; title: string; status: string } | null };

export default function GitHubIntegration({ projects, canManage, notify }: { projects: Project[]; canManage: boolean; notify: (message: string) => void }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [available, setAvailable] = useState<AvailableRepository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [webhook, setWebhook] = useState<{ webhookUrl: string; secret: string; events: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api.get("/integrations/github") as GitHubStatus;
      setStatus(next);
      if (next.connected) setEvents(await api.get("/integrations/github/events") as GitHubEvent[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load GitHub connection status."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setBusy(true); setError("");
    try { const result = await api.post("/integrations/github/connect", {}); window.location.assign(result.authorizationUrl); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start GitHub authorization."); setBusy(false); }
  }
  async function loadRepositories() {
    setBusy(true); setError("");
    try { setAvailable(await api.get("/integrations/github/repositories/available") as AvailableRepository[]); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load repositories."); }
    finally { setBusy(false); }
  }
  async function linkRepository() {
    if (!repoId || !projectId) return;
    setBusy(true); setError("");
    try { await api.post("/integrations/github/repositories", { repositoryId: repoId, projectId }); setAvailable([]); await refresh(); notify("GitHub repository linked to project"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not link repository."); }
    finally { setBusy(false); }
  }
  async function unlinkRepository(id: string) {
    setBusy(true); setError("");
    try { await api.delete(`/integrations/github/repositories/${id}`); await refresh(); notify("Repository unlinked"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not unlink repository."); }
    finally { setBusy(false); }
  }
  async function createWebhook(id: string) {
    setBusy(true); setError("");
    try { setWebhook(await api.post(`/integrations/github/repositories/${id}/webhook`, {})); await refresh(); notify("Webhook secret created. Copy it before leaving this page."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create webhook configuration."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect GitHub and remove linked repositories and stored events from this workspace?")) return;
    setBusy(true); setError("");
    try { const result = await api.post("/integrations/github/disconnect", {}); setEvents([]); setAvailable([]); setWebhook(null); await refresh(); notify(result.remoteRevocation === "revoked" ? "GitHub disconnected and access token revoked" : "GitHub disconnected locally; revoke its OAuth grant in GitHub if needed"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect GitHub."); }
    finally { setBusy(false); }
  }

  return <section className="panel settings-panel github-integration-panel">
    <div className="panel-head"><div><div className="eyebrow">CONNECTED TOOLS</div><h2>GitHub</h2></div><span className={`status-tag ${status?.connected ? "active" : "planning"}`}>{status?.connected ? "CONNECTED" : "NOT CONNECTED"}</span></div>
    <p className="muted-copy">Link repositories to projects. Signed push, pull request, and issue events are kept in this workspace. Only explicit <code>NEXORA-TASK:uuid</code> references are linked to tasks.</p>
    {error && <div className="form-error github-error" role="alert">{error}</div>}
    {!status ? <div className="empty-inline">Checking GitHub configuration…</div> : !status.connected && (!status.configured || !status.encryptionReady) ? <div className="github-setup-note"><b>GitHub OAuth is not configured.</b><span>Set <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, <code>GITHUB_CALLBACK_URL</code>, and a 64-character hex <code>GITHUB_TOKEN_ENCRYPTION_KEY</code>. Configure <code>API_PUBLIC_URL</code> before setting up webhooks.</span></div> : !status.connected ? <div className="integration-row"><div className="integration-icon github-mark">GH</div><span><b>Connect GitHub</b><small>OAuth requests account and repository access only.</small></span><button className="button button-secondary small-button" disabled={!canManage || busy} onClick={() => void connect()}>{busy ? "Opening…" : "Connect GitHub"}</button></div> : <>
      {(!status.configured || !status.encryptionReady) && <div className="github-setup-note"><b>OAuth configuration is incomplete.</b><span>Repository operations are unavailable. You can still disconnect locally; revocation of the GitHub grant may not be confirmed.</span></div>}
      <div className="github-account-row"><span><b>@{status.account?.githubLogin}</b><small>Authorized scopes: {status.account?.scopes.join(", ") || "provider default"}</small></span><div><button className="button button-secondary small-button" disabled={busy || !canManage} onClick={() => void loadRepositories()}>Add repository</button><button className="button button-secondary small-button" disabled={busy || !canManage} onClick={() => void disconnect()}>Disconnect</button></div></div>
      {!canManage && <div className="settings-hint">Only workspace owners and admins can manage connected repositories.</div>}
      {!!available.length && <div className="github-repository-picker"><label>Repository<select aria-label="GitHub repository" value={repoId} onChange={e => setRepoId(e.target.value)}><option value="">Choose repository</option>{available.map(repo => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.isPrivate ? " · private" : ""}</option>)}</select></label><label>Link to project<select aria-label="Link repository to project" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Choose project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="button button-primary small-button" disabled={busy || !repoId || !projectId || !canManage} onClick={() => void linkRepository()}>Link</button></div>}
      <div className="github-linked-list">{status.repositories.map(repo => <div className="integration-row" key={repo.id}><div className="integration-icon github-mark">GH</div><span><b>{repo.fullName}</b><small>{repo.project.name} · {repo._count.events} captured events</small></span><button className="text-button" disabled={busy || !canManage} onClick={() => void createWebhook(repo.id)}>Configure webhook</button><button className="text-button danger-text" disabled={busy || !canManage} onClick={() => void unlinkRepository(repo.id)}>Unlink</button></div>)}{!status.repositories.length && !available.length && <div className="empty-inline">No repositories linked. Add a repository to associate its development activity with a project.</div>}</div>
      {webhook && <div className="github-webhook-secret"><b>GitHub webhook setup · copy the secret now</b><label>Payload URL<input readOnly value={webhook.webhookUrl}/></label><label>Secret<input readOnly value={webhook.secret}/></label><small>Choose JSON payloads and subscribe to: {webhook.events.join(", ")}. Rotating this secret invalidates the previous hook secret.</small></div>}
      {!!events.length && <div className="github-events"><h3>Recent repository activity</h3>{events.slice(0, 8).map(event => <div className="github-event-row" key={event.id}><span><b>{event.title || event.eventType.replaceAll("_", " ")}</b><small>{event.repository.fullName} · {event.repository.project.name}{event.action ? ` · ${event.action}` : ""}{event.linkedTask ? ` · linked to ${event.linkedTask.title}` : ""}</small></span>{event.url ? <a href={event.url} target="_blank" rel="noreferrer">Open</a> : <time>{new Date(event.occurredAt).toLocaleDateString()}</time>}</div>)}</div>}
    </>}
  </section>;
}
