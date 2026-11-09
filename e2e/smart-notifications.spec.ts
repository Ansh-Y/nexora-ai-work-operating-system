import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.2.5 — AI Smart Notifications & Notification Center End-to-End Flow', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Sentinel Systems ${stamp}`;

  // 1. Setup browser and register workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Alex Rivera');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`alex-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('NexoraSmartAlerts!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Alex' })).toBeVisible({ timeout: 15_000 });

  // 2. Dispatch smart notifications representing all 4 categories and priorities via client API
  await page.evaluate(async () => {
    const token = window.sessionStorage.getItem('nexora-token');
    if (!token) throw new Error('No token found in sessionStorage');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const notifs = [
      {
        category: 'PROJECT',
        priority: 'CRITICAL',
        title: 'Critical Risk: Database Replication Lag Exceeds Threshold',
        body: 'Read replicas are lagging behind primary by 420 seconds. Automated failover standing by.',
        actionUrl: '/health',
      },
      {
        category: 'TASK',
        priority: 'HIGH',
        title: 'Task Blocked: Payment Gateway Migration',
        body: 'Stripe webhook refactoring depends on SSL certificate renewal scheduled for tomorrow.',
        actionUrl: '/tasks',
      },
      {
        category: 'AI',
        priority: 'MEDIUM',
        title: 'AI Workflow Proposal: Auto-reassign Inactive Task',
        body: 'Proposal to reassign frontend design review to Jordan after 48h inactivity.',
        actionUrl: '/automations',
      },
      {
        category: 'TEAM',
        priority: 'LOW',
        title: 'Jordan mentioned you in Architecture Review',
        body: 'Can you double-check the database indexes for smart notifications deduplication?',
        actionUrl: '/meetings',
      },
    ];

    for (const n of notifs) {
      const res = await fetch('http://localhost:4000/api/notifications/test', {
        method: 'POST',
        headers,
        body: JSON.stringify(n),
      });
      if (!res.ok) {
        throw new Error(`Failed to create test notification: ${res.status}`);
      }
    }
  });

  // 3. Navigate to Smart Notification Center via Sidebar
  await page.getByRole('button', { name: 'Inbox' }).click();
  await expect(page.locator('.smart-notif-title')).toHaveText('Smart Notification Center', { timeout: 10_000 });
  await expect(page.locator('.smart-notif-subtitle')).toBeVisible();

  // Verify all 4 notification cards are displayed
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).toBeVisible();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).toBeVisible();
  await expect(page.getByText('AI Workflow Proposal: Auto-reassign Inactive Task')).toBeVisible();
  await expect(page.getByText('Jordan mentioned you in Architecture Review')).toBeVisible();

  // 4. Test Category Filter Tabs
  // Filter by Projects
  await page.locator('.smart-notif-tab', { hasText: 'Projects' }).click();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).toBeVisible();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).not.toBeVisible();

  // Filter by Tasks
  await page.locator('.smart-notif-tab', { hasText: 'Tasks' }).click();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).toBeVisible();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).not.toBeVisible();

  // Filter by AI Intelligence
  await page.locator('.smart-notif-tab', { hasText: 'AI Intelligence' }).click();
  await expect(page.getByText('AI Workflow Proposal: Auto-reassign Inactive Task')).toBeVisible();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).not.toBeVisible();

  // Filter by Team
  await page.locator('.smart-notif-tab', { hasText: 'Team' }).click();
  await expect(page.getByText('Jordan mentioned you in Architecture Review')).toBeVisible();

  // Return to All Alerts
  await page.locator('.smart-notif-tab', { hasText: 'All Alerts' }).click();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).toBeVisible();

  // 5. Test Priority Pills
  await page.locator('.smart-notif-pill.critical').click();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).toBeVisible();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).not.toBeVisible();

  await page.locator('.smart-notif-pill', { hasText: 'All' }).click();
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).toBeVisible();

  // 6. Test Live Search
  const searchInput = page.locator('.smart-notif-search-input');
  await searchInput.fill('Stripe');
  await expect(page.getByText('Task Blocked: Payment Gateway Migration')).toBeVisible();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).not.toBeVisible();

  await page.locator('.clear-search-btn').click();
  await expect(page.getByText('Critical Risk: Database Replication Lag Exceeds Threshold')).toBeVisible();

  // 7. Test Actionable Navigation Button
  // Clicking "Review Proposal" navigates to Automations
  const aiCard = page.locator('.smart-notif-card', { hasText: 'AI Workflow Proposal' });
  await aiCard.locator('.smart-notif-action-btn').click();
  await expect(page.locator('.automations-workspace')).toBeVisible({ timeout: 10_000 });

  // Return to Inbox
  await page.getByRole('button', { name: 'Inbox' }).click();
  await expect(page.locator('.smart-notif-title')).toBeVisible();

  // 8. Test Mark as Read & Dismiss
  const taskCard = page.locator('.smart-notif-card', { hasText: 'Task Blocked: Payment Gateway Migration' });
  await taskCard.locator('.smart-notif-tool-btn.mark-read').click();

  // Test dismiss
  const teamCard = page.locator('.smart-notif-card', { hasText: 'Jordan mentioned you in Architecture Review' });
  await teamCard.locator('.smart-notif-tool-btn.dismiss').click();
  await expect(page.getByText('Jordan mentioned you in Architecture Review')).not.toBeVisible();

  // 9. Visual Audit: Ensure Dark Mode is Active & Capture Dark Theme Screenshot
  const isDark = await page.locator('.app-shell.dark').isVisible();
  if (!isDark) {
    await page.locator('button[aria-label="Toggle theme"]').click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-notifications-dark.png'),
    fullPage: false,
  });

  // 10. Switch to Light Theme & Capture Screenshot
  await page.locator('button[aria-label="Toggle theme"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-notifications-light.png'),
    fullPage: false,
  });

  // 11. Test Notification Preferences Modal (switch back to Dark Mode for modal capture)
  await page.locator('button[aria-label="Toggle theme"]').click();
  await page.waitForTimeout(300);

  await page.locator('.smart-notif-btn', { hasText: 'Preferences' }).click();
  const prefModal = page.locator('.smart-modal-dialog');
  await expect(prefModal).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.smart-modal-title')).toHaveText('Smart Notification Preferences');

  // Change lead time selector
  const leadSelect = prefModal.locator('.smart-pref-select');
  await leadSelect.selectOption('48');

  // Capture Preferences Modal Screenshot
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-notifications-preferences.png'),
    fullPage: false,
  });

  // Save Preferences
  await prefModal.locator('.smart-notif-btn-primary', { hasText: 'Save Preferences' }).click();
  await expect(prefModal).not.toBeVisible({ timeout: 5_000 });
});
