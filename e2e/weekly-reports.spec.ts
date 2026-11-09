import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.2.4 — AI Weekly Project Reports End-to-End Flow', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Reporting Org ${stamp}`;
  const projectName = `Nebula Cloud Engine ${stamp}`;

  // 1. Setup browser and register workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Taylor Director');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`taylor-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('NexoraReports!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Taylor' })).toBeVisible({ timeout: 15_000 });

  // 2. Create project
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Scalable cloud infrastructure and data analytics pipeline');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10_000 });

  // 3. Add tasks to give data to report
  await page.getByRole('button', { name: 'My work', exact: true }).click();

  // Add Task 1
  const addTaskBtn = page.getByRole('button', { name: 'Add task' }).first();
  await expect(addTaskBtn).toBeVisible({ timeout: 10_000 });
  await addTaskBtn.click();
  await page.getByLabel('Task name').fill('Deploy Redis Cluster and Failover Sentinel');
  await page.locator('.modal-form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Deploy Redis Cluster and Failover Sentinel').first()).toBeVisible({ timeout: 10_000 });

  // Add Task 2
  await addTaskBtn.click();
  await page.getByLabel('Task name').fill('Configure PostgreSQL Read Replicas');
  await page.locator('.modal-form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Configure PostgreSQL Read Replicas').first()).toBeVisible({ timeout: 10_000 });

  // Mark Task 1 as DONE
  const statusCombobox1 = page.getByRole('combobox', { name: /change .* status/i }).first();
  await expect(statusCombobox1).toBeVisible({ timeout: 10_000 });
  await statusCombobox1.selectOption('DONE');

  // Mark Task 2 as BLOCKED
  const statusCombobox2 = page.getByRole('combobox', { name: /change .* status/i }).nth(1);
  if (await statusCombobox2.isVisible()) {
    await statusCombobox2.selectOption('BLOCKED');
  }

  await page.waitForTimeout(600);

  // 4. Navigate to Reports Workspace
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByTestId('reports-workspace')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'AI Weekly Project Reports' })).toBeVisible();

  // Verify initial empty state
  await expect(page.getByTestId('reports-empty-state')).toBeVisible({ timeout: 5_000 });

  // 5. Open "Generate Weekly Report" Modal
  const genBtn = page.locator('.reports-generate-btn');
  await expect(genBtn).toBeVisible();
  await genBtn.click();

  const modal = page.getByTestId('generate-report-modal');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Fill custom directive
  await modal.locator('textarea').fill('Focus on infrastructure readiness, Redis caching, and database replication stability.');

  // Click Submit
  await modal.getByRole('button', { name: 'Generate Intelligence Report' }).click();

  // 6. Wait for generation to complete and modal to close
  await expect(modal).not.toBeVisible({ timeout: 25_000 });

  // Verify detailed report modal opens automatically or report appears in grid
  const detailModal = page.getByTestId('report-detail-modal');
  await expect(detailModal).toBeVisible({ timeout: 10_000 });

  // Verify Executive Summary & Metrics in detail view
  await expect(detailModal.getByTestId('report-executive-summary')).toBeVisible();
  await expect(detailModal.locator('.report-metrics-grid')).toBeVisible();
  await expect(detailModal.getByText('Deploy Redis Cluster and Failover Sentinel')).toBeVisible();

  // 7. Capture Screenshot in Dark Theme
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-weekly-report-dark.png'),
    fullPage: false,
  });

  // 8. Toggle to Light Theme and capture screenshot
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
  await page.waitForTimeout(400);

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-weekly-report-light.png'),
    fullPage: false,
  });

  // 9. Close Detail Modal to view Reports List
  await detailModal.locator('.btn-close').click();
  await expect(detailModal).not.toBeVisible({ timeout: 5_000 });

  // Verify reports grid list
  await expect(page.getByTestId('reports-grid')).toBeVisible();
  await expect(page.locator('.report-card')).toHaveCount(1);
  await expect(page.locator('.report-card-title')).toContainText('Weekly Report');

  // Capture screenshot of reports list
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-weekly-reports-list.png'),
    fullPage: false,
  });

  // Switch theme back to dark
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
});
