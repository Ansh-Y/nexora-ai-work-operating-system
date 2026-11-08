import { expect, test } from '@playwright/test';

test('Project Health & Predictive Risk dashboard lifecycle journey', async ({ page, browser }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const projectName = `Health Project ${stamp}`;

  // 1. Register Workspace Manager/Owner
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Health Manager');
  await page.getByLabel('Workspace name').fill(`Health Space ${stamp}`);
  await page.getByLabel('Email address').fill(`manager-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('ManagerPass!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Health' })).toBeVisible();

  // 2. Create Project
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('End-to-end predictive project health verification');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  // Navigate to My Work (Project Workspace)
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  // 3. Populate Project with tasks and milestones via UI
  // Add Task 1: Normal active task
  await page.getByRole('main').getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('Task name').fill('Core Architecture Setup');
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.locator('form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Core Architecture Setup')).toBeVisible();

  // Add Task 2: Critical overdue task to trigger risk rules
  await page.getByRole('main').getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('Task name').fill('Security Critical Review');
  await page.getByLabel('Priority').selectOption('URGENT');
  // Past due date
  await page.getByLabel('Due date').fill('2026-01-01');
  await page.locator('form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Security Critical Review')).toBeVisible();

  // Add Milestone
  await page.getByRole('button', { name: 'Milestone' }).click();
  await page.getByLabel('Milestone name').fill('Alpha Launch Target');
  await page.getByLabel('Target date').fill('2026-12-31');
  await page.locator('form').getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByText('Alpha Launch Target')).toBeVisible();

  // 4. Navigate to Health & Risks tab from the project workspace
  await page.getByRole('button', { name: 'Health & Risks' }).click();

  // Verify header and project context
  await expect(page.locator('.eyebrow', { hasText: 'PROJECT INTELLIGENCE & RISK ENGINE' })).toBeVisible();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  // 5. Verify Health Score and Classification Badge
  const gauge = page.locator('.health-gauge');
  await expect(gauge).toBeVisible();
  await expect(page.locator('.health-pill')).toBeVisible();

  // 6. Verify All Five Dimension Cards Render with correct weights
  await expect(page.getByText('Task Completion & Progress (25%)')).toBeVisible();
  await expect(page.getByText('Deadline Performance (25%)')).toBeVisible();
  await expect(page.getByText('Blockers & Dependencies (25%)')).toBeVisible();
  await expect(page.getByText('Milestone Performance (15%)')).toBeVisible();
  await expect(page.getByText('Recent Momentum & Activity (10%)')).toBeVisible();

  // 7. Verify Forecast Panel and Confidence Indicator
  await expect(page.getByRole('heading', { name: 'Project Delay Forecast' })).toBeVisible();
  await expect(page.getByText('Forecast Confidence')).toBeVisible();

  // 8. Verify Risk Cards and Evidence
  await expect(page.getByRole('heading', { name: /Detected Risks & Recommendations/ })).toBeVisible();
  const riskCard = page.locator('.risk-item-card').first();
  await expect(riskCard).toBeVisible();
  await expect(riskCard.locator('.risk-severity-badge')).toBeVisible();
  await expect(riskCard.locator('.risk-recommendation-box')).toBeVisible();

  // 9. Manager Dismissal Dialog Workflow
  const dismissBtn = riskCard.getByRole('button', { name: 'Dismiss risk' });
  await expect(dismissBtn).toBeVisible();
  await dismissBtn.click();

  // Verify modal dialog opened
  await expect(page.getByRole('heading', { name: 'Dismiss Detected Risk' })).toBeVisible();
  await page.getByLabel('Reason for dismissal').fill('Risk acknowledged and approved during executive steering meeting.');
  await page.getByRole('button', { name: 'Confirm Dismissal' }).click();

  // Switch filter to view dismissed risks and verify audit record
  await page.getByLabel('Filter by status').selectOption('ALL');
  await expect(page.locator('.risk-dismissed-badge').first()).toContainText('executive steering meeting', { timeout: 10_000 });

  // 10. Viewer Access Enforcement (RBAC)
  // Invite a viewer
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email address').fill(`viewer-${stamp}@nexora.test`);
  await page.getByLabel('Workspace role').selectOption('VIEWER');
  await page.getByRole('button', { name: 'Create invitation' }).click();

  const inviteCodeEl = page.locator('.invite-result code');
  await expect(inviteCodeEl).toBeVisible();
  const inviteToken = (await inviteCodeEl.textContent())?.trim();
  expect(inviteToken).toBeTruthy();

  // Close the invite modal
  await page.locator('.modal-card .modal-head button.icon-button').click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  // Create Viewer session in isolated browser context
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(`/?invite=${inviteToken}`);
  await viewerPage.getByLabel('Your name').fill('Auditor Viewer');
  await viewerPage.getByLabel(/Workspace name/).fill('Viewer Studio');
  await viewerPage.getByLabel('Email address').fill(`viewer-${stamp}@nexora.test`);
  await viewerPage.getByLabel('Password').fill('ViewerPass!2026');
  await viewerPage.getByRole('button', { name: 'Create account and join' }).click();

  await expect(viewerPage.getByRole('heading', { name: 'Good morning, Auditor' })).toBeVisible();
  await expect(viewerPage.getByText(/You joined/)).toBeVisible();

  // Viewer navigates to Project Health
  await viewerPage.getByRole('button', { name: 'Project Health', exact: true }).click();
  await expect(viewerPage.locator('.project-health-workspace')).toBeVisible();

  // If in overview, click into the project details
  if (await viewerPage.locator('.health-card').first().isVisible().catch(() => false)) {
    await viewerPage.locator('.health-card').first().click();
  }

  // Verify viewer sees the score and dimension cards
  await expect(viewerPage.locator('.health-gauge')).toBeVisible();
  await expect(viewerPage.getByText('Task Completion & Progress (25%)')).toBeVisible();

  // Verify viewer CANNOT see manager-only dismissal actions or recalculate button
  await expect(viewerPage.getByRole('button', { name: 'Dismiss risk' })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Recalculate health' })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Propose AI Action Plan' })).toHaveCount(0);
  await viewerContext.close();

  // 11. Theme Verification: Light and Dark Theme Support
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const themeSwitch = page.locator('.theme-switch');
  await expect(themeSwitch).toBeVisible();

  // Switch to Dark theme
  await themeSwitch.click();
  await expect(page.locator('.app-shell')).toHaveClass(/dark/);

  // Return to Project Health in dark theme
  await page.getByRole('button', { name: 'Project Health', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/dark/);
  await expect(page.locator('.health-gauge')).toBeVisible();
  await expect(page.getByText('Deadline Performance (25%)')).toBeVisible();

  // Switch back to Light theme
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await themeSwitch.click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/dark/);
});
