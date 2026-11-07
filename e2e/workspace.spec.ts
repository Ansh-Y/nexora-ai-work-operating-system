import { expect, test } from '@playwright/test';

test('a new member can create a project and review grounded meeting actions', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const projectName = `Browser project ${stamp}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Browser Test');
  await page.getByLabel('Workspace name').fill(`Browser space ${stamp}`);
  await page.getByLabel('Email address').fill(`browser-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('BrowserTest!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Created through the authenticated browser flow.');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'New meeting' }).click();
  await page.getByLabel('Title').fill(`Launch review ${stamp}`);
  await page.getByLabel('Description').fill('Review launch decisions and action owners.');
  await page.locator('.meeting-create select:not([multiple])').selectOption({ label: projectName });
  await page.locator('.meeting-create').getByRole('button', { name: 'Create meeting' }).click();

  await expect(page.getByRole('heading', { name: `Launch review ${stamp}` })).toBeVisible();
  await page.locator('.meeting-upload input[type="file"]').setInputFiles({
    name: 'launch.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000fixture'),
  });
  await expect(page.locator('.meeting-process-state b')).toHaveText('Analysis complete', { timeout: 20_000 });
  await expect(page.getByLabel('Action title').nth(0)).toHaveValue('Prepare release notes');
  await expect(page.getByLabel('Action title').nth(1)).toHaveValue('Freeze feature scope');
  const prepareCard = page.locator('.meeting-action-card').nth(0);
  await expect(prepareCard.locator('.action-evidence')).toContainText('Taylor will prepare the release notes');
  await expect(page.locator('.meeting-evidence-card small')).toContainText('We agreed to freeze features for the launch.');

  const rejectCard = page.locator('.meeting-action-card').nth(1);
  await rejectCard.getByRole('button', { name: 'Reject' }).click();
  await expect(rejectCard.getByText('rejected')).toBeVisible();

  const approveCard = page.locator('.meeting-action-card').nth(0);
  await approveCard.getByRole('button', { name: 'Approve' }).click();
  await approveCard.getByRole('button', { name: 'Create task' }).click();
  await expect(approveCard.getByText('Added:')).toBeVisible();

  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('meeting action converted', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'AI command', exact: true }).click();
  await page.getByLabel('Ask your workspace').fill('What feature freeze decision was made?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Configure OPENAI_API_KEY', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Freeze features for launch/ })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar & timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.timeline-axis')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
  await expect(page.getByText('GitHub OAuth is not configured.')).toBeVisible();
});
