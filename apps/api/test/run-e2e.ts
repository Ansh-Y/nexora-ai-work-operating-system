import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const apiDirectory = process.cwd();
const rootDirectory = resolve(apiDirectory, '../..');
const mode = process.argv[2] === 'browser' ? 'browser' : 'api';
loadEnv({ path: resolve(apiDirectory, '../../.env') });
loadEnv();

const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl) throw new Error('DATABASE_URL is required to create an isolated E2E database.');
const sourceUrl = configuredUrl;
const dbName = `nexora_e2e_${process.pid}_${randomBytes(4).toString('hex')}`;
const admin = new URL(sourceUrl);
admin.pathname = '/postgres';
admin.searchParams.delete('schema');
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const adminClient = new Client({ connectionString: admin.toString() });

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = apiDirectory) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
  } finally {
    await adminClient.end();
  }

  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${dbName}`;
  const storageDirectory = join(tmpdir(), dbName);
  const browserBuildDirectory = resolve(apiDirectory, '.browser-dist');
  const githubConfig = mode === 'api'
    ? { GITHUB_CLIENT_ID: 'nexora-e2e-client', GITHUB_CLIENT_SECRET: 'e2e-client-secret', GITHUB_CALLBACK_URL: 'https://api.nexora.test/api/integrations/github/callback', API_PUBLIC_URL: 'https://api.nexora.test' }
    : { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_CALLBACK_URL: '', API_PUBLIC_URL: '' };
  const env = { ...process.env, DATABASE_URL: testUrl.toString(), MEETING_STORAGE_DIR: storageDirectory, STORAGE_LOCAL_DIR: storageDirectory, OPENAI_API_KEY: '', ...githubConfig, GITHUB_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
  let status = 1;
  try {
    status = run(process.execPath, [resolve(apiDirectory, '../../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], env);
    if (status === 0 && mode === 'api') {
      const vitestBin = resolve(apiDirectory, '../../node_modules/vitest/vitest.mjs');
      status = run(process.execPath, [vitestBin, 'run', '--config', './vitest.config.mts', 'test/app.e2e-spec.ts'], env);
      if (status === 0) status = run(process.execPath, [vitestBin, 'run', '--config', './vitest.config.mts', 'test/github-automation.e2e-spec.ts'], env);
      if (status === 0) status = run(process.execPath, [vitestBin, 'run', '--config', './vitest.config.mts', 'test/storage.e2e-spec.ts'], env);
      if (status === 0) status = run(process.execPath, [vitestBin, 'run', '--config', './vitest.config.mts', 'test/notifications-reliability.spec.ts'], env);
      if (status === 0) status = run(process.execPath, [vitestBin, 'run', '--config', './vitest.config.mts', 'test/project-health.e2e-spec.ts'], env);
    }
    if (status === 0 && mode === 'browser') status = run(process.execPath, [resolve(rootDirectory, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.browser.json'], env);
    if (status === 0 && mode === 'browser') status = run(process.execPath, [resolve(rootDirectory, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(rootDirectory, 'playwright.config.ts')], env, rootDirectory);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
    await rm(browserBuildDirectory, { recursive: true, force: true });
    const cleanupClient = new Client({ connectionString: admin.toString() });
    await cleanupClient.connect();
    try { await cleanupClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)} WITH (FORCE)`); }
    finally { await cleanupClient.end(); }
  }
  process.exitCode = status;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
