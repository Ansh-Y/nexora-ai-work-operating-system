# NEXORA MVP hardening report

Audit completed: 2026-11-07. The application architecture and existing data were preserved. No database reset was performed.

## Results

| Check | Before | After |
|---|---:|---:|
| `npm audit --omit=dev` | 17 findings: 11 high, 6 moderate | 0 findings |
| Full `npm audit` | 46 findings: 15 high, 20 moderate, 11 low | 8 moderate, 0 high/critical |
| Database migration | Prisma 6 schema workflow | Prisma 7 adapter/config migration applied |

The eight remaining audit entries all trace to one moderate advisory, GHSA-g3hv-75wg-m249: `minimatch@10.2.6` is nested under `@typescript-eslint/typescript-estree@8.72.1`, which is included by `eslint-config-next@16.4.5`. NPM counts the affected transitive chain members separately. It is in the development-only lint dependency tree; production dependencies have no audit findings. The advisory affects minimatch versions `>=7.0.0 <11.0.1`. The patched release is `11.0.1` or newer, but typescript-estree currently declares `^10.2.2`. NPM's suggested `--force` fix downgrades `eslint-config-next` to 15.5.29, which is incompatible with this Next.js 16 application. I left the compatible Next 16 toolchain intact instead of forcing that downgrade. Recheck after typescript-eslint publishes a compatible dependency range.

## Vulnerable versions and dependency changes

The original lockfile contained these direct findings:

| Direct package family | Affected version in baseline | Current version / disposition |
|---|---:|---|
| `@nestjs/common`, `core`, `platform-express`, `platform-socket.io`, `testing`, `websockets` | 10.4.22 | 12.4.0, pinned consistently |
| `@nestjs/config` | 3.3.0 | 12.1.1 |
| `@nestjs/cli` | 10.4.9 | 12.0.12 |
| `@nestjs/schematics` | 10.2.3 | 12.0.13 |
| `@nestjs/swagger` | 8.1.1 | 12.1.1 |
| `@prisma/client`, `prisma` | 6.19.3 | 7.10.1, pinned consistently |
| `zod` | 3.25.76 | 4.6.7 |
| `eslint-config-next` | 16.4.5 | 16.4.5; its transitive minimatch advisory remains as described above |
| Jest stack (`jest`, `@jest/core`, `create-jest`) | 29.7.0 | Removed; API tests use Vitest 4.1.12 |
| `ts-jest` | 29.4.15 | Removed with Jest |

The baseline transitive inventory also included `@angular-devkit/core`, `@angular-devkit/schematics`, and `@angular-devkit/schematics-cli` 17.3.11; `@typescript-eslint/eslint-plugin`, `parser`, `type-utils`, `typescript-estree`, and `utils` 8.72.1; `ajv` 6.15.0 and 8.20.0; `body-parser` 1.20.4; `deepmerge` 4.3.1; `deepmerge-ts` 7.1.5; `file-type` 20.4.1; `glob` 7.2.3 and 10.4.5; `inquirer` 8.2.6 and 9.2.15; `js-yaml` 3.15.2, 4.1.0 and 4.3.2; `lodash` 4.17.21; `minimatch` 3.1.5, 9.0.9 and 10.2.6; `multer` 2.0.2; `picomatch` 2.3.2 and 4.0.1; `qs` 6.14.3; `tmp` 0.0.33; and `webpack` 5.97.1 and 5.112.2. Nest CLI's Angular DevKit packages now resolve to 22.2.6; other changed resolutions include `body-parser` 2.4.0, `deepmerge-ts` 8.0.2, `file-type` 22.3.0, `lodash` 4.18.1, `multer` 2.5.0, and `qs` 6.17.1. The Jest-only tooling and obsolete CLI transitive packages were removed. The final audit identifies only the minimatch chain above; package presence alone is not counted as a current vulnerability.

### Updated dependency list

- NestJS runtime packages: common/core/platform adapters/testing/websockets 12.4.0; config 12.1.1; JWT 12.0.4; Swagger 12.1.1; throttler 6.7.1; CLI 12.0.12; schematics 12.0.13.
- Prisma client and CLI 7.10.1, PostgreSQL adapter 7.10.1, `pg` 8.23.1, and dotenv 18.0.3.
- Zod 4.6.7, TypeScript 6.0.2, ESLint 9.39.5, Vitest 4.1.12, and Playwright 1.65.0.
- Next.js remains 16.4.5. The lockfile was regenerated with these compatible versions; no `npm audit fix --force` was used.

NestJS 12 is ESM-based and requires a newer supported Node runtime, so the API test runner was moved from Jest/ts-jest to Vitest. Prisma 7 requires an explicit PostgreSQL driver adapter and moves the database URL into Prisma config. These changes are reflected in the API package, root engine range, and lockfile.

## Security changes and checks

- Tenant scope comes from the signed active-workspace claim and a live membership check. The database-backed HTTP suite attempts cross-organization reads for projects, tasks, comments, dependencies, milestones, notifications, search, audit history, and AI proposals. It also checks that a notification job cannot address a nonmember in another organization.
- Workspace role changes and invitations now block owner assignment and administrator escalation by admins; self-role changes are rejected. Backend role checks remain authoritative. Passwords over bcrypt's 72-byte input limit are rejected rather than silently truncated.
- Auth checks cover unauthenticated requests, invalid credentials, expired JWTs, invalid/rotated refresh tokens, role-restricted routes, and invitation/role escalation attempts.
- AI plan output is normalized and bounded, assignees are matched against current tenant membership, stored proposals are revalidated before execution, and workspace text is explicitly treated as untrusted model input. Approval/rejection checks reviewer roles and expiry. Conditional status transitions plus a transaction prevent concurrent duplicate execution; create, approve, and reject actions are audited. Expired proposals transition to `EXPIRED`.
- Dependency creation checks task/project/tenant consistency and rejects cycles in a serializable transaction. Unit and integration cases cover multiple chains, blocked work, downstream impact, completed tasks, dates, and critical-path calculations.
- BullMQ reminders use UTC scheduling, retry with exponential backoff, log failed jobs, deduplicate by event and recipient, validate recipients against live membership, expose manager-only queue status, and close queue/worker handles on shutdown.
- Project cards no longer contain an interactive button inside a button. The browser smoke test now completes signup and project creation without the previous hydration warning.

## Database migration

Prisma 7 configuration was added in `apps/api/prisma.config.ts`, and `PrismaService` now connects through `@prisma/adapter-pg`. The additive migration `apps/api/prisma/migrations/20261107000000_ai_proposal_expiration/migration.sql` adds proposal expiry and the `EXPIRED` state, backfilling existing proposals to expire 30 days after creation. New proposals expire after seven days. The migration was applied using `prisma migrate deploy`; the database was not reset and existing records were retained. The database-backed acceptance test adds uniquely named test users and workspaces; those test rows were left in place.

## Verification

All commands below ran with Node 24.15.0, against the updated lockfile and migrated local PostgreSQL/Redis services:

| Command | Result |
|---|---|
| `npm run build` | Passed: Nest API and Next.js production build |
| `npm test` | Passed: 2 unit-test files, 9 tests; frontend ESLint passed |
| `npm run test:e2e` | Passed: database-backed HTTP workflow/security suite, 1 test file |
| `npm run test:browser` | Passed: Chromium signup and project creation, 1 test |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npm audit` | Reports 8 moderate entries from the single minimatch advisory chain; command exits nonzero |

## Remaining issues and next phase

- Update the Next.js lint dependency chain when a compatible typescript-eslint/minimatch 11 release is published, then require a clean full `npm audit`.
- Expand browser tests beyond signup/project creation, and add worker fault-injection tests for Redis loss, retry exhaustion, shutdown during an active job, and cross-timezone daylight-saving boundaries. The current tests verify API-level dedupe and queue authorization but do not simulate all worker failure modes.
- Production readiness still needs deployment-level controls and operations: managed secrets, TLS, backup/restore rehearsal, rate/abuse review, email verification and password-reset delivery, and credential-backed OAuth/provider validation. Do not enable integrations until their provider flows are implemented and tested.
- Keep the existing persistent database; run future schema changes through migrations and test them against a backup before production rollout.

## Release 2 implementation and re-verification (2026-11-07)

Release 2 was added on top of the existing NestJS/Prisma architecture. No schema reset was used. Five additive migrations add cancelled tasks, meeting intelligence and review records, task start dates, meeting action expiration, and GitHub connection/repository/event state. Existing proposal and meeting action rows are backfilled where applicable. The GitHub migration was applied to the configured database and Prisma reports it up to date.

Release 2 introduced no npm package dependencies; package manifests and lockfiles were left unchanged.

### Changes delivered

- Added tenant-scoped meeting CRUD, private local audio storage with upload validation and protected downloads, queued transcription/analysis adapters, transcript segment storage, exact-evidence validation, approval/rejection/expiry for extracted actions, and audited task conversion. Unconfigured provider jobs retain the recording/transcript and expose a retry state.
- Added calendar event queries for tasks, projects, milestones and meetings, bounded date windows and tenant-validated filters. The UI has month/week/day/timeline views, critical-path indicators and explicit date editing. Dependent task dates are not silently cascaded.
- Added cited workspace Q&A using tenant-scoped search sources, plus deterministic portfolio risk metrics. Workspace source text is treated as untrusted input and the Q&A path has no action tools.
- Added cancelled-task handling and improved BullMQ reconnect/retry/shutdown, dedupe and UTC scheduling paths. Added real Redis reliability coverage.
- Added GitHub OAuth with one-time hashed state tied to a live workspace membership, owner/admin gates, AES-256-GCM encryption of access tokens and webhook secrets, repository-to-project links, one-time webhook-secret setup, signature-verified/deduplicated push/PR/issue capture, explicit same-project task references, and local plus remote disconnect handling. No event updates task status automatically.
- Added GitHub event sources to tenant-scoped keyword and optional vector search. Retrieved GitHub content remains untrusted context for workspace Q&A.
- Isolated database-backed and browser tests in temporary databases created from migrations. The wrapper drops only the uniquely named test database after execution. Meeting audio fixtures live in temporary storage and external AI calls are disabled in tests.
- Fixed an AI command UI race discovered by Chromium: proposal rows and audit events now use separate state, preventing an audit event from being rendered as a proposal.

### Current dependency audit

The current lockfile audit is:

| Audit | Result |
|---|---:|
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 8 moderate entries, 0 high/critical; exits nonzero |

The eight counted entries are the package chain for one advisory, GHSA-g3hv-75wg-m249, in the development-only Next.js ESLint tree: `minimatch@10.2.6` under `@typescript-eslint/typescript-estree@8.72.1`, included by `typescript-eslint@8.72.1` and `eslint-config-next@16.4.5`. NPM counts `@typescript-eslint/eslint-plugin`, `parser`, `type-utils`, `typescript-estree`, `utils`, `typescript-eslint`, `eslint-config-next`, and `minimatch` as affected entries. The advisory range is `minimatch >=7.0.0 <11.0.1`; the patched release is 11.0.1 or newer, but the current typescript-estree dependency range is `^10.2.2`. NPM's proposed automatic remediation downgrades `eslint-config-next` to 15.5.29, a major mismatch with the current Next 16.4.5 app. No forced downgrade or override was applied. The previous 17 reported vulnerabilities (11 high, 6 moderate) are reduced to zero in production and this one moderate advisory chain in the development dependency tree.

### Verification

The Release 2 verification run used the local PostgreSQL/Redis services and the current lockfile:

| Command | Result |
|---|---|
| `npm run build` | Passed: NestJS and Next.js production builds |
| `npm test` | Passed: 6 API test files, 24 tests; web ESLint passed |
| `npm run test:e2e` | Passed: 2 files, 3 database-backed tests on a disposable migrated database; includes mocked GitHub OAuth/repository responses and signed webhook authorization/deduplication |
| `npm run test:browser` | Passed: signup, project creation, meeting upload/grounded action review, audit, cited Q&A, calendar/timeline navigation, and GitHub setup state |
| Backup/restore rehearsal | Passed after migration: custom-format PostgreSQL dump restored to a temporary database, all 9 migration records verified, temporary DB and dump removed |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npm audit` | 8 moderate development-only entries described above |

Paid LLM/transcription behavior was not exercised because tests intentionally clear those credentials. GitHub OAuth/repository/revocation calls used a deterministic mock provider; no real GitHub app credentials were configured.

### Remaining Release 2 scope

- Google Calendar/Gmail sync remains unimplemented. GitHub webhooks must be manually registered in GitHub using the one-time secret shown by Settings; organization-level GitHub App installation support is not included.
- GitHub events link to tasks only with an explicit task UUID and never change task status. Configurable merge rules, commit browsing, branch views, and issue/PR workflow mapping remain future work.
- Meeting audio uses private local disk storage. Hosted object storage, encryption-key lifecycle, retention/deletion policy, and malware scanning remain production work.
- The calendar supports explicit date editing but not drag-to-reschedule. Date changes do not recalculate dependent task dates.
- Search/Q&A now include meeting decisions/actions and GitHub events, but do not yet chunk long documents/transcripts, index the full audit/activity stream, or have production-scale retrieval tuning.
- Browser coverage is a focused end-to-end journey, not full cross-browser coverage. Credential-backed provider tests, load tests and deployment-level monitoring remain future work.
- Configure and test recovery/verification email before activating self-service account recovery. Preserve the existing database and use additive migrations.

### Recommended next development phase

Implement the next provider workflow as Google Calendar sync and add configurable GitHub pull-request merge rules with explicit project permissions. In parallel, move meeting recordings behind a private object-storage adapter with retention controls, expand RAG chunking for documents/transcripts, and add credential-backed provider tests. Revisit the ESLint dependency chain when a compatible patched minimatch range is available.

## Release 3 Step 2 — Private Cloud Storage & Retention Management (2026-11-07)

Release 3 Step 2 was implemented on top of the baseline commit `85878ad` (Release 3 Step 1). All changes were strictly additive and preserved backward compatibility with existing meeting recordings and documents.

### Schema Changes & Migration
Additive migration `20261107123000_storage_and_retention_management` was applied to the active database `nexora` (11 migrations total).
- New enums: `StorageUploadStatus` (`PENDING`, `READY`, `FAILED`), `RetentionHoldType` (`LEGAL`, `OPERATIONAL`, `COMPLIANCE`).
- New models:
  - `StorageObject`: Tracks tenant-isolated object keys, SHA-256 checksums, byte sizes, MIME types, provider names, upload status, expiration dates, and links to `MeetingRecording` and `Document`.
  - `OrganizationRetentionPolicy`: Configurable days for `recordingRetentionDays` and `documentRetentionDays`, `autoDeleteExpired` flag, and `manualDeletionAllowed`.
  - `FileRetentionHold`: Immutable holds with reason, hold type, applying user, and release audit tracking.
- Relations: `MeetingRecording.storageObjectId` and `Document.storageObjectId`.

### Security Hardening & Zero-Dependency S3
- **Zero New Dependencies**: Implemented private S3-compatible cloud storage (AWS S3 & Cloudflare R2) using Node.js native `crypto` and `fetch` with AWS Signature Version 4 (SigV4). Avoided adding large or vulnerable AWS SDK client packages.
- **Traversal Defense**: Multi-layered path traversal prevention in `LocalStorageProvider` and `FileValidator`. Rejects paths with `..`, `\`, null bytes, and forces resolution inside tenant-isolated root roots. Filename normalization neutralizes dangerous characters and traversal sequences.
- **MIME Sniffing & Content Validation**: `FileValidator` verifies binary magic bytes for audio (MP3 ID3, WAV RIFF, MP4 ftyp) and documents (PDF `%PDF-`, UTF-8 text/markdown/json/csv). Rejects disguised executables and malicious payloads with `BadRequestException`.
- **Integrity**: SHA-256 checksums calculated and verified on all incoming uploads.
- **Short-Lived Signed URLs**: Download and upload URLs expire within configurable TTLs (default 15 minutes) signed via HMAC-SHA256 (local) or AWS SigV4 (S3). Secret credentials are never exposed in query strings or transmitted to the client.
- **Legal Hold Shielding**: Files under active `FileRetentionHold` are strictly protected against both manual deletion (400 Bad Request) and automatic background retention sweeps.
- **Dry-Run Inspection**: Safe `/api/storage/retention/dry-run` endpoint allows workspace owners to inspect eligible vs. held files before triggering deletions.
- **Background Worker**: BullMQ queue `nexora-storage-retention` handles background sweeps and incomplete upload cleanups with exponential backoff retries and audit logging.

### Full Test Verification
| Command | Result |
|---|---|
| `npm run build` | Passed: NestJS API and Next.js frontend compiled cleanly with 0 TypeScript/ESLint errors |
| `npm test` | Passed: 9 unit test suites, 50 tests (including 10 storage reliability tests and 8 storage security tests); frontend ESLint clean |
| `npm run test:e2e` | Passed: 4 E2E test suites, 28 tests on isolated database (including 16 storage & retention tests) |
| `npm run test:browser` | Passed: Playwright Chromium user journey covering workspace creation, meetings, calendar, GitHub, and private storage UI |
| `npm audit --omit=dev` | Passed: 0 vulnerabilities |
| `npm audit` | 8 moderate development-only entries from known Next.js minimatch advisory chain |

## Release 3 Step 2.1 — Storage Reliability Remediation (2026-11-07)

### 1. Reliable Deletion & Orphaned Object Prevention
- **Retryable Deletion State**: When physical deletion fails from storage providers (S3 timeout, 403, 500, network loss), database records are **not** marked `deletedAt`. Instead, the file transitions into a retryable state (`metadata.deletion.status = 'PENDING_RETRY'`) preserving key, provider, attempt count, and last error.
- **Access Guarding**: Files in `PENDING_RETRY` or `FAILED_PERMANENT` are immediately blocked from download streams or presigned URL generation (`404 Not Found`).
- **Bounded Backoff & Cap**: Retries use exponential backoff (`10s * 2^(attempts-1)`, capped at 3600s) up to `MAX_RETRY_DELETION_ATTEMPTS = 5`. Upon exhaustion, transitions to `FAILED_PERMANENT` with `storage.deletion.exhausted` audit log.
- **Hold Re-Evaluation on Retry**: When `reconcileFailedDeletions` processes a retry, it re-verifies active holds. If an active hold was placed between attempts, deletion is immediately aborted and transitioned to `CANCELLED_HOLD_APPLIED`.
- **Idempotent Missing Objects**: Deleting an already-missing object (S3 404 / local ENOENT) succeeds idempotently and marks `deletedAt: now, status: 'COMPLETED'`.

### 2. Redis Outage & Retention Sweep Concurrency
- **Unbounded Execution Prevention**: Fallback sweeps during queue outages are strictly bounded to `MAX_SYNCHRONOUS_FALLBACK_BATCH = 25`. Unforced sweeps are deferred rather than executing in the request thread.
- **Observability & Recovery**: Failed queue additions emit `storage.retention_sweep.enqueue_failed` and track target workspaces in `pendingOfflineSweeps`. When Redis connectivity restores, `resumePendingSweeps()` automatically drains and enqueues deferred sweeps.
- **Deduplication & Mutual Exclusion**: BullMQ jobs use deterministic job IDs (`retention-sweep-${target}`). An internal `isSweeping` mutex prevents concurrent duplicate sweep executions from running simultaneously.


