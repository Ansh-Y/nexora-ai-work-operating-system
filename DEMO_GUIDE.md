# NEXORA — Placement Demo & Feature Walkthrough Guide

This guide walks through the complete **19-Step Customer Journey** implemented and verified in the automated end-to-end audit suite ([e2e/release-4-3-user-journey.spec.ts](e2e/release-4-3-user-journey.spec.ts)).

---

## Demo Access Credentials

| Field | Value | Notes |
|:---|:---|:---|
| **Web Application URL** | `http://localhost:3000` *(Local)* or Deployed Vercel URL | Works on any modern browser |
| **Demo Email** | `demo@nexora.local` | Pre-seeded with team members & projects |
| **Demo Password** | `NexoraDemo!2026` | Enterprise test credentials |
| **Active Workspace** | `Nexora Studio` | Multi-tenant organization slug: `nexora-demo` |

---

## 19-Step Feature Walkthrough

### 1. Authentication & Session Initiation
- Navigate to the sign-in page.
- Enter `demo@nexora.local` and `NexoraDemo!2026`.
- Click **Sign in to Nexora**. Session token is generated and stored securely in session storage.

### 2. Workspace Overview Dashboard
- Land on the Overview screen.
- Verify personalized greeting, active project count, pending tasks, overdue indicators, and workspace activity stream.

### 3. Project Management — Product Launch
- Click **Projects** in the sidebar.
- Open the **Product Launch** project card.
- Inspect project timeline, description, high priority status, and progress metrics.

### 4. Task Management & Lifecycle Progression
- Switch to the **Tasks** tab.
- Filter tasks by status (`TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`).
- Click a task status pill to transition status (e.g., from `TODO` to `IN_PROGRESS`).

### 5. Dependency Graph Visualization
- Click the **Dependency Graph** tab.
- Inspect the interactive DAG representing task blockers (e.g. *Complete backend API* blocking *Prepare launch checklist*).
- Confirm cycle prevention guards protect workflow ordering.

### 6. AI Smart Task Assignment
- On any task card, click the **AI Recommend Assignee** button (Sparkles icon).
- The modal opens displaying top ranked candidates (e.g., Jordan Rivera, Taylor Chen, Alex Morgan).
- Inspect confidence scores, workload analysis, deadline proximity, and explanation rationale.
- Click **Assign to [Candidate]** to apply the recommendation with one click.

### 7. Task Collaboration & Discussions
- Click the **Comments** icon on a task.
- Review historical threaded comments.
- Submit a collaborative update; observe instant rendering with author attribution.

### 8. AI Project Assistant (Grounded Workspace Q&A)
- Navigate to **AI Assistant** in the sidebar.
- Ask: *"What tasks are currently blocking our product launch deadline?"*
- Observe real-time response grounded in actual database tasks with source citations.

### 9. AI Command Center
- Navigate to **AI command** in the sidebar.
- Type an operational prompt: *"Review blockers and propose mitigation strategy for launch."*
- Review the generated structured AI plan proposal before approving or rejecting.

### 10. Project Health & Predictive Risk Engine
- Click **Project Health** in the sidebar.
- View real-time health score gauge (0–100), composite risk factors, and delivery forecast.

### 11. Historical Health Recalculation
- Click **Recalculate health**.
- Observe the historical snapshot chart updating dynamically with time-series health progression.

### 12. AI Weekly Project Intelligence Reports
- Navigate to **Reports** in the sidebar.
- Select the `Product Launch` project and click **Generate Weekly Report**.
- Inspect deterministic metrics: completed tasks, blockers, velocity trends, and executive summary.

### 13. High-Resolution PDF Report Export
- Click **Export PDF** on the generated report.
- Browser downloads a binary PDF report formatted with enterprise typography, margin grid, and metrics table.

### 14. Collaborative Meetings & Audio Intelligence
- Navigate to **Meetings** in the sidebar.
- Inspect the scheduled *Sprint 4 Architecture & Launch Alignment* meeting.
- View audio upload simulation and AI-extracted action items.

### 15. AI Workflow Automations
- Navigate to **Automations** in the sidebar.
- Inspect event-driven automation rules (e.g., *Notify manager when task is blocked*).
- Review pending runs and human-in-the-loop approval actions.

### 16. Smart Notification Center & Preferences
- Navigate to **Inbox** in the sidebar.
- Filter alerts by category (`AI Intelligence`, `Tasks`, `Projects`, `Team`) and priority (`Critical`, `High`, `Medium`).
- Click **Preferences**; toggle custom delivery frequencies and click **Save Preferences**.

### 17. Workspace Settings & Integrations
- Click **Settings** in the bottom sidebar.
- Inspect workspace members, team roles (`OWNER`, `PROJECT_MANAGER`, `TEAM_MEMBER`), and integration tabs (GitHub, Google Workspace, Storage).

### 18. Obsidian & Jade Theme Toggle
- Click the Theme Toggle button (Sun/Moon icon) in the header.
- Observe instantaneous transition between Jade Dark (`#0d0f12`) and Crisp Light (`#f8fafc`) themes across all cards, graphs, and modals.

### 19. Secure Sign Out
- Click the **Sign out** button in the bottom profile card.
- User is securely logged out, token is purged, and browser returns to the sign-in screen.
