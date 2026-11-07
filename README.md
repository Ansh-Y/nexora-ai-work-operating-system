# Nexora — AI Work Operating System

Nexora is a multi-tenant project workspace with tenant-scoped projects, tasks, dependencies, risk analysis and approval-based AI planning. The repository is a TypeScript monorepo: Next.js web client and NestJS REST/Socket.IO API, Prisma/PostgreSQL (pgvector), with Redis available for background queues.

## Run locally

Requirements: Node.js 20.19+, 22.22.3+, 24.15+, or 26+, npm, and Docker Compose. These Node versions satisfy the NestJS 12 and Prisma 7 toolchain requirements.

1. Copy `.env.example` to `.env`. For local development, the example database URL and Redis URL work with the included Compose services. Replace `JWT_SECRET` with a unique secret.
2. Start data services: `docker compose up -d`.
3. Install dependencies: `npm install`.
4. Generate Prisma client and create schema: `npm run db:generate` then `npm run db:migrate`.
5. Optional demo workspace: `npm run db:seed` (email `demo@nexora.local`, password `NexoraDemo!2026`).
6. Start API and web app: `npm run dev`.

Web: http://localhost:3000 · API: http://localhost:4000/api · Swagger: http://localhost:4000/api/docs

Without seed data, register at the sign-in screen to create a new account and workspace. AI planning and meeting analysis use OpenAI when `OPENAI_API_KEY` is configured; meeting transcription uses the configured OpenAI-compatible endpoint and `TRANSCRIPTION_API_KEY` (or the OpenAI key). Without provider credentials, processing stays visibly unconfigured and recordings can be retried when configured. Provider integrations are shown as unconfigured until their credentials and OAuth callback URLs are set.

Run API unit tests and web lint with `npm test`. `npm run test:e2e` and `npm run test:browser` create a uniquely named temporary PostgreSQL database, apply all migrations, and drop that database afterward; fixtures never use the configured application database. They require a PostgreSQL role able to create/drop databases, Redis, and (for browser tests) Chromium (`npx playwright install chromium`).

## Environment

See `.env.example`. Never commit `.env`. Database, Redis and JWT settings are required. OpenAI, OAuth and SMTP settings are optional and should be configured only for their respective provider flows.

## API overview

For GitHub, create an OAuth App with callback `http://localhost:4000/api/integrations/github/callback`, set its client ID and secret, and provide a 32-byte random key as 64 hex characters for `GITHUB_TOKEN_ENCRYPTION_KEY` (generate one with `openssl rand -hex 32`). Set `API_PUBLIC_URL` to the API origin. After connection, link a repository to a project in Settings; generate a webhook secret there and register the displayed HTTPS payload URL in GitHub for push, pull request, and issue events. Event text is untrusted. Only explicit `[NEXORA-TASK:<uuid>]` references are linked; merged pull requests do not change task status automatically.

All routes are under `/api`; interactive OpenAPI docs are served at `/api/docs`.

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/switch-workspace`
- `GET/POST /organizations`, `GET /organizations/members`, `POST /organizations/invitations`, `PATCH /organizations/members/:id/role`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, milestones, health and critical-path routes
- `GET/POST /projects/:projectId/tasks`, `PATCH/DELETE /tasks/:id`, dependencies and comments
- `GET/POST /meetings`, `PATCH/DELETE /meetings/:id`, private recording upload/download, transcript and grounded decision/action review routes
- `GET /calendar/events` returns tenant-scoped projects, tasks, milestones and meetings within a bounded date range
- `/integrations/github` reports OAuth status and supports `POST /connect`, `GET /repositories/available`, `POST /repositories`, webhook setup, disconnect, recent events, and signed `POST /webhook` ingestion
- `GET /search?q=...` searches tenant-scoped projects, tasks, comments, meetings, documents and linked GitHub activity. It combines keyword results with pgvector similarity when an OpenAI embedding key is configured; otherwise it returns keyword results.
- `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`
- AI plan proposals/approval, cited workspace Q&A, deterministic portfolio intelligence, blocker analysis, weekly reports and duplicate candidates
- `GET /audit`

Authenticated requests use `Authorization: Bearer <access token>`. The active workspace is embedded in the signed token and is checked against a live membership on each API request.

## Architecture and delivery status

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture, schema rationale, risks, and the phased development checklist. API and database logic enforce tenant scoping; the web client does not supply an authoritative organization id.

The app implements the project-management and AI approval vertical slice, task discussions and dependency views, tenant-scoped search, in-app notifications, meeting recording/transcription/action review, calendar/timeline views, and GitHub OAuth with repository linking and signed webhook activity capture. BullMQ checks task/milestone deadlines daily at 09:00 UTC and processes meeting recordings when configured. Semantic ranking requires an embedding-capable OpenAI key. Google Calendar/Gmail sync, email delivery, hosted object storage, GitHub-driven task status automation, and production deployment automation remain follow-on work; unconfigured integrations are not shown as synchronized.

This is a runnable MVP, not yet a production release. NestJS and Prisma have been upgraded and the production dependency audit is clean. The full development dependency audit reports eight moderate entries in one minimatch advisory chain through the Next.js ESLint toolchain; see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) for affected versions, test results, and remaining work.

## Deployment

Build and run PostgreSQL with pgvector and Redis as managed services, then deploy `apps/api` and `apps/web` as separate Node services. Set the environment variables from `.env.example`, set `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` to deployed HTTPS origins, run `npm run db:migrate` as a release step, then start the API and web processes. Use managed secrets, TLS, a restricted database role, backups, and separate credentials per environment. Configure OAuth redirect URLs and provider webhooks to their public API routes before enabling integrations.
