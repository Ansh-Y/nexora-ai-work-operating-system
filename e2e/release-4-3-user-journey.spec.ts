import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.3 — Complete End-to-End User Journey Audit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // --------------------------------------------------------------------------
  // STEP 1: User logs into NEXORA with existing demo credentials
  // --------------------------------------------------------------------------
  await page.goto('/');

  // Ensure login mode is active
  const createAccountBtn = page.getByRole('button', { name: 'Create an account' });
  const signInToggleBtn = page.getByRole('button', { name: 'Sign in instead' });
  if (await signInToggleBtn.isVisible()) {
    await signInToggleBtn.click();
  }

  // Fill existing demo credentials
  await page.getByLabel('Email address').fill('demo@nexora.local');
  await page.getByLabel('Password').fill('NexoraDemo!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // --------------------------------------------------------------------------
  // STEP 2: User opens the dashboard (Overview)
  // --------------------------------------------------------------------------
  await expect(page.getByRole('heading', { name: /Good morning|Good afternoon|Good evening|Welcome/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nexora Studio', { exact: false }).first()).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 3: User opens Product Launch
  // --------------------------------------------------------------------------
  const projectsNav = page.locator('button.nav-link[aria-label="Projects"]');
  await expect(projectsNav).toBeVisible();
  await projectsNav.click();

  // Verify Product Launch project card is present and open it
  const productLaunchCard = page.getByText('Product Launch').first();
  await expect(productLaunchCard).toBeVisible({ timeout: 10_000 });
  await productLaunchCard.click();

  // Verify Project details view
  await expect(page.getByRole('heading', { name: 'Product Launch' })).toBeVisible({ timeout: 10_000 });

  // --------------------------------------------------------------------------
  // STEP 4: User inspects project health
  // --------------------------------------------------------------------------
  const healthNav = page.locator('button.nav-link[aria-label="Project Health"]');
  await expect(healthNav).toBeVisible();
  await healthNav.click();

  await expect(page.locator('.project-health-workspace')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.eyebrow', { hasText: 'PROJECT INTELLIGENCE & RISK ENGINE' })).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 5: User opens the blocked backend task
  // --------------------------------------------------------------------------
  const myWorkNav = page.locator('button.nav-link[aria-label="My work"]');
  await expect(myWorkNav).toBeVisible();
  await myWorkNav.click();

  const commentsBtn = page.locator('button[title="Comments for Complete backend API"]');
  await expect(commentsBtn).toBeVisible({ timeout: 10_000 });
  await commentsBtn.click();

  // Task modal opens
  const taskModal = page.locator('.comment-modal');
  await expect(taskModal).toBeVisible({ timeout: 10_000 });

  // --------------------------------------------------------------------------
  // STEP 6: User inspects its dependencies and activity
  // --------------------------------------------------------------------------
  await expect(taskModal.getByRole('heading', { name: 'Complete backend API' })).toBeVisible();
  await expect(taskModal.locator('.segmented')).toBeVisible();

  // Close task modal
  await taskModal.locator('button[aria-label="Close task discussion"]').click();
  await expect(taskModal).not.toBeVisible({ timeout: 5_000 });

  // --------------------------------------------------------------------------
  // STEP 7: User uses AI Project Assistant to ask about the blocker
  // --------------------------------------------------------------------------
  const assistantNav = page.locator('button.nav-link[aria-label="AI Assistant"]');
  await expect(assistantNav).toBeVisible();
  await assistantNav.click();

  await expect(page.getByRole('heading', { name: 'AI Project Assistant' })).toBeVisible({ timeout: 10_000 });

  // Click a starter prompt or ask question
  const starterCard = page.locator('.starter-prompt-card').first();
  if (await starterCard.isVisible()) {
    await starterCard.click();
  } else {
    const assistantInput = page.locator('.assistant-input-box textarea');
    await assistantInput.fill('What is blocking the Complete backend API task?');
    await page.locator('.send-btn').click();
  }

  // Verify grounded response appears
  await expect(page.locator('.assistant-message-row.assistant-row .message-bubble')).toBeVisible({ timeout: 25_000 });

  // --------------------------------------------------------------------------
  // STEP 8: User opens Smart Assignment and reviews candidates
  // --------------------------------------------------------------------------
  await myWorkNav.click();
  const assignBtn = page.locator('button[title="AI Recommend Assignee for Complete backend API"]');
  await expect(assignBtn).toBeVisible({ timeout: 10_000 });
  await assignBtn.click();

  // Verify Smart Assignment Modal opens
  const assignModal = page.locator('.smart-assign-modal');
  await expect(assignModal).toBeVisible({ timeout: 10_000 });
  await expect(assignModal.locator('.smart-assign-card').first()).toBeVisible({ timeout: 10_000 });

  // --------------------------------------------------------------------------
  // STEP 9: User approves a test assignment where safe
  // --------------------------------------------------------------------------
  const approveAssignBtn = assignModal.getByRole('button', { name: /Approve & Assign/i }).first();
  await expect(approveAssignBtn).toBeVisible();
  await approveAssignBtn.click();
  await expect(assignModal).not.toBeVisible({ timeout: 8_000 });

  // --------------------------------------------------------------------------
  // STEP 10: User opens Workflow Automations
  // --------------------------------------------------------------------------
  const autoNav = page.locator('button.nav-link[aria-label="Automations"]');
  await expect(autoNav).toBeVisible();
  await autoNav.click();

  await expect(page.getByTestId('automations-workspace')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'AI Workflow Automation' })).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 11: User reviews a pending approval / rules tab
  // --------------------------------------------------------------------------
  const rulesTab = page.getByTestId('tab-rules');
  if (await rulesTab.isVisible()) {
    await rulesTab.click();
  }
  const pendingTab = page.getByTestId('tab-pending');
  if (await pendingTab.isVisible()) {
    await pendingTab.click();
    await page.waitForTimeout(300);
  }

  // --------------------------------------------------------------------------
  // STEP 12: User opens the Weekly Project Report
  // --------------------------------------------------------------------------
  const reportsNav = page.locator('button.nav-link[aria-label="Reports"]');
  await expect(reportsNav).toBeVisible();
  await reportsNav.click();

  await expect(page.getByTestId('reports-workspace')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'AI Weekly Project Reports' })).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 13: User views or generates a report using safe test data
  // --------------------------------------------------------------------------
  const genBtn = page.locator('.reports-generate-btn');
  if (await genBtn.isVisible()) {
    await genBtn.click();
    const genModal = page.getByTestId('generate-report-modal');
    await expect(genModal).toBeVisible({ timeout: 5_000 });
    await genModal.locator('textarea').fill('Audit sprint velocity, blocker resolution, and launch schedule.');
    await genModal.getByRole('button', { name: 'Generate Intelligence Report' }).click();

    // Verify detail modal opens
    const reportDetail = page.getByTestId('report-detail-modal');
    await expect(reportDetail).toBeVisible({ timeout: 25_000 });
    await expect(reportDetail.getByTestId('report-executive-summary')).toBeVisible();

    // Close report detail
    await reportDetail.locator('button.btn-close').click();
    await expect(reportDetail).not.toBeVisible({ timeout: 5_000 });
  }

  // --------------------------------------------------------------------------
  // STEP 14: User opens the Notification Center
  // --------------------------------------------------------------------------
  const inboxNav = page.locator('button.nav-link[aria-label="Inbox"]');
  await expect(inboxNav).toBeVisible();
  await inboxNav.click();

  await expect(page.locator('.smart-notif-title')).toHaveText('Smart Notification Center', { timeout: 10_000 });
  await expect(page.locator('.smart-notif-tabs')).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 15: User marks a notification as read
  // --------------------------------------------------------------------------
  const markReadBtn = page.locator('.smart-notif-tool-btn.mark-read').first();
  if (await markReadBtn.isVisible()) {
    await markReadBtn.click();
  }

  // --------------------------------------------------------------------------
  // STEP 16: User changes notification preferences
  // --------------------------------------------------------------------------
  await page.locator('.smart-notif-btn', { hasText: 'Preferences' }).click();
  const prefModal = page.locator('.smart-modal-dialog');
  await expect(prefModal).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.smart-modal-title')).toHaveText('Smart Notification Preferences');

  // Change lead time selector
  const leadSelect = prefModal.locator('.smart-pref-select');
  await leadSelect.selectOption('48');

  // Save Preferences
  await prefModal.locator('.smart-notif-btn-primary', { hasText: 'Save Preferences' }).click();
  await expect(prefModal).not.toBeVisible({ timeout: 5_000 });

  // --------------------------------------------------------------------------
  // STEP 17: User navigates to Settings
  // --------------------------------------------------------------------------
  const settingsNav = page.locator('button.nav-link', { hasText: 'Settings' });
  await expect(settingsNav).toBeVisible();
  await settingsNav.click();

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Nexora Studio', { exact: false }).first()).toBeVisible();

  // --------------------------------------------------------------------------
  // STEP 18: User switches between light and dark themes
  // --------------------------------------------------------------------------
  const themeToggle = page.locator('button[aria-label="Toggle theme"]');
  await expect(themeToggle).toBeVisible();

  // Toggle theme
  await themeToggle.click();
  await page.waitForTimeout(300);

  // Toggle back
  await themeToggle.click();
  await page.waitForTimeout(300);

  // --------------------------------------------------------------------------
  // STEP 19: User logs out
  // --------------------------------------------------------------------------
  const signOutBtn = page.locator('button[title="Sign out"]').first();
  await expect(signOutBtn).toBeVisible();
  await signOutBtn.click();

  // Verify redirected back to the login/auth screen
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Email address')).toBeVisible();
});
