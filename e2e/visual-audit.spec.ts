import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('visual audit of AI Command Center, Inbox, Meeting Form, Details, and Health Chart', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const projectName = `Audit Space ${stamp}`;

  // 1. Register account
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Auditor Alex');
  await page.getByLabel('Workspace name').fill(projectName);
  await page.getByLabel('Email address').fill(`auditor-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('AuditPass!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Auditor' })).toBeVisible();

  // Create project
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Audit project for visual inspection of repaired components.');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  // Add tasks and milestone to generate health/risk signals
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('Task name').fill('Core Platform Framework');
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.locator('form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Core Platform Framework')).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('Task name').fill('Security Critical Review');
  await page.getByLabel('Priority').selectOption('URGENT');
  await page.getByLabel('Due date').fill('2026-01-01');
  await page.locator('form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Security Critical Review')).toBeVisible();

  await page.getByRole('button', { name: 'Milestone' }).click();
  await page.getByLabel('Milestone name').fill('Alpha Launch Release');
  await page.getByLabel('Target date').fill('2026-12-31');
  await page.locator('form').getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByText('Alpha Launch Release')).toBeVisible();

  // ==========================================
  // DEFECT 1: AI COMMAND CENTER
  // ==========================================
  await page.getByRole('button', { name: 'AI command', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI command center' })).toBeVisible();
  await expect(page.getByText('PLAN PREVIEW')).toBeVisible();
  await expect(page.getByText('Project brief to plan')).toBeVisible();
  await expect(page.getByText('Blocker detection')).toBeVisible();
  await expect(page.getByText('Weekly health report')).toBeVisible();
  await expect(page.getByText('Duplicate work detection')).toBeVisible();

  // Capture AI Command Center Light Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-ai-command-light-desktop.png'), fullPage: true });

  // Switch to Dark Theme
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.theme-switch').click();
  await expect(page.locator('.app-shell')).toHaveClass(/dark/);

  // Return to AI Command Center Dark Desktop (1440px)
  await page.getByRole('button', { name: 'AI command', exact: true }).click();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-ai-command-dark-desktop.png'), fullPage: true });

  // Capture AI Command Center Mobile (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-ai-command-mobile.png'), fullPage: true });

  // Open Plan Proposal Modal to verify proposed task preview cards
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Create a project plan' }).click();
  await expect(page.getByRole('heading', { name: 'Start with the brief' })).toBeVisible();
  await page.getByLabel('What are you planning?').fill(`**Project objective:**
Upgrade the core workflow engine to support multi-tenant isolation, real-time collaboration, and automated dependency graphs.

**Key deliverables:**
1. Unified WebSocket gateway for real-time task sync and collaboration
2. Dependency cycle validation engine preventing circular blockers
3. Automated critical-path scheduling calculator
4. Predictive risk engine analyzing deadline velocity and stalled work
5. Enterprise storage with AES-256-GCM encryption and audit logging
6. Executive health dashboard with trend sparklines and risk factor breakdown

**Constraints & assumptions:**
- Zero downtime during database migration and deployment
- Strict tenant data isolation enforced at service layer
- High contrast accessible Obsidian and Jade design system`);
  await page.locator('form').getByRole('button', { name: 'Generate plan draft' }).click();
  await expect(page.locator('.proposal-review')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.brief-section-heading').first()).toHaveText('Project objective');
  await expect(page.locator('.brief-numbered-list')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-plan-proposal-review.png') });
  await page.getByRole('button', { name: 'Approve and create' }).click();
  await expect(page.locator('.proposal-review')).toHaveCount(0);

  // ==========================================
  // DEFECT 2: INBOX
  // ==========================================
  await page.locator('button.nav-link[aria-label="Inbox"]').click();
  await expect(page.getByRole('heading', { name: /Smart Notification Center|Inbox/i })).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-inbox-dark-desktop.png'), fullPage: true });

  // Switch back to Light Theme for Inbox Light
  await page.locator('button.nav-link[aria-label="Settings"]').click();
  await page.locator('.theme-switch').click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/dark/);
  await page.locator('button.nav-link[aria-label="Inbox"]').click();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-inbox-light-desktop.png'), fullPage: true });

  // Inbox Mobile (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-inbox-mobile.png'), fullPage: true });

  // ==========================================
  // DEFECT 3: MEETING EDIT FORM & DETAILS
  // ==========================================
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Meetings/ })).toBeVisible();

  // Open Meeting Form
  await page.getByRole('button', { name: 'New meeting' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule or log a meeting' })).toBeVisible();
  await page.getByLabel('Title').fill('Sprint 4 Architecture & Launch Alignment');
  await page.getByLabel('Description').fill('Quarterly milestone review, risk mitigations, and ownership assignments.');
  await page.getByLabel('Date and time').fill('2026-11-15T10:00');
  await page.getByLabel('Duration (minutes)').fill('45');
  await page.locator('.meeting-create select:not([multiple])').selectOption({ label: projectName });

  // Capture Meeting Edit Form Light Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-form-light-desktop.png') });

  // Switch to Dark Theme
  await page.locator('button.nav-link[aria-label="Settings"]').click();
  await page.locator('.theme-switch').click();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'New meeting' }).click();
  await page.getByLabel('Title').fill('Sprint 4 Architecture & Launch Alignment');
  await page.getByLabel('Description').fill('Quarterly milestone review, risk mitigations, and ownership assignments.');
  await page.getByLabel('Date and time').fill('2026-11-15T10:00');
  await page.getByLabel('Duration (minutes)').fill('45');

  // Capture Meeting Edit Form Dark Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-form-dark-desktop.png') });

  // Capture Meeting Edit Form Mobile (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-form-mobile.png') });

  // Submit and create meeting
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.meeting-create').getByRole('button', { name: 'Create meeting' }).click();
  await expect(page.getByRole('heading', { name: 'Sprint 4 Architecture & Launch Alignment' })).toBeVisible();

  // Upload Audio Recording Fixture to verify details panel
  await page.locator('.meeting-upload input[type="file"]').setInputFiles({
    name: 'audit-launch.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000fixture'),
  });
  await expect(page.locator('.meeting-process-state b')).toHaveText('Analysis complete', { timeout: 25_000 });

  // Capture Meeting Details Dark Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-details-dark-desktop.png'), fullPage: true });

  // Meeting Details Light Desktop (1440px)
  await page.locator('button.nav-link[aria-label="Settings"]').click();
  await page.locator('.theme-switch').click();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.locator('.meeting-list-row').first().click();
  await expect(page.getByRole('heading', { name: 'Sprint 4 Architecture & Launch Alignment' })).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-details-light-desktop.png'), fullPage: true });

  // Meeting Details Mobile (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-meeting-details-mobile.png'), fullPage: true });

  // ==========================================
  // DEFECT 4: PROJECT HEALTH HISTORY CHART
  // ==========================================
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Project Health', exact: true }).click();
  await expect(page.locator('.project-health-workspace')).toBeVisible();

  // Click into the project detail
  if (await page.locator('.health-card').first().isVisible().catch(() => false)) {
    await page.locator('.health-card').first().click();
  }
  await expect(page.locator('.health-gauge')).toBeVisible();

  // Recalculate health to generate multiple historical snapshots
  await page.getByRole('button', { name: 'Recalculate health' }).click();
  await expect(page.getByText('recalculation completed', { exact: false })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Recalculate health' }).click();
  await expect(page.getByText('recalculation completed', { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.history-panel')).toBeVisible();

  // Capture Project Health and History Chart in Light Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-health-chart-light-desktop.png'), fullPage: true });

  // Switch to Dark Theme
  await page.locator('button.nav-link[aria-label="Settings"]').click();
  await page.locator('.theme-switch').click();
  await page.getByRole('button', { name: 'Project Health', exact: true }).click();
  if (await page.locator('.health-card').first().isVisible().catch(() => false)) {
    await page.locator('.health-card').first().click();
  }
  await expect(page.locator('.health-gauge')).toBeVisible();

  // Capture Project Health and History Chart in Dark Desktop (1440px)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-health-chart-dark-desktop.png'), fullPage: true });

  // Capture Mobile (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-health-chart-mobile.png'), fullPage: true });
});
