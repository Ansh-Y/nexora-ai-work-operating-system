# NEXORA — AI Work Operating System

<div align="center">

**An enterprise-grade, multi-tenant AI work operating system for intelligent project planning, smart task assignment, workflow automation, predictive health scoring, and team collaboration.**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12.4-red.svg?logo=nestjs)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.10-teal.svg?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.15-blue.svg?logo=postgresql)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.8.6-blue.svg)](https://github.com/pgvector/pgvector)
[![Redis](https://img.shields.io/badge/Redis-7.0-red.svg?logo=redis)](https://redis.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[Architecture](ARCHITECTURE.md) • [Zero-Cost Deployment](DEPLOYMENT.md) • [Environment Variables](ENVIRONMENT_VARIABLES.md) • [Placement Demo Guide](DEMO_GUIDE.md)

</div>

---

## Overview

**NEXORA** is designed to transform how software and engineering teams coordinate work. By embedding grounded artificial intelligence directly into the operational database, NEXORA moves beyond traditional static Kanban boards to provide proactive, predictive project intelligence:

- **AI Project Assistant:** Context-aware conversational AI grounded in live workspace data (tasks, milestones, dependencies, meetings, team workloads) with source citations.
- **AI Smart Task Assignment:** Intelligent multi-factor assignee recommendation ranking team members by current workload, deadline proximity, skill profile, and organizational role.
- **AI Workflow Automation:** Event-driven rule engine supporting automatic triggers (`TASK_STATUS_CHANGED`, `PROJECT_HEALTH_DROPPED`, `TASK_BLOCKED`) with human-in-the-loop approvals.
- **Predictive Project Health & Risk Engine:** Rule-based health scoring (0–100) combining schedule slippage, blocker ratios, dependency depth, and deadline proximity with historical snapshot tracking.
- **Weekly Project Intelligence Reports:** High-resolution PDF generation with deterministic KPI calculations, velocity metrics, and executive summaries.
- **Smart Notification Center:** Priority-classified and categorized notifications with intelligent deduplication and real-time WebSocket delivery.
- **Obsidian & Jade Design System:** Sleek, accessible UI adhering to strict monochromatic dark surfaces (`#0d0f12`) accented by Jade green (`#10b981`), with high-contrast light mode support.

---

## Technology Stack

### Frontend Client (`apps/web`)
- **Framework:** Next.js 16.4 (App Router & Turbopack)
- **UI Runtime:** React 19, TypeScript
- **Styling:** Custom CSS Design System (Jade Dark / Crisp Light themes)
- **Icons:** Lucide React
- **Real-Time:** Socket.IO Client 4.8

### Backend API (`apps/api`)
- **Framework:** NestJS 12.4 (Modular Monolithic Architecture)
- **Runtime:** Node.js 22+ (TypeScript 6.0)
- **ORM:** Prisma 7.10 with `@prisma/adapter-pg`
- **Database:** PostgreSQL 16 with `pgvector` extension for vector embeddings
- **Caching & Queues:** Redis 7 with BullMQ 6.7
- **Reporting Engine:** PDFKit 0.20
- **Security:** Helmet, Throttler, Class-Validator, BCrypt (12 salt rounds), JWT authentication

---

## Quickstart & Local Setup

### Prerequisites
- Node.js `20.19+`, `22.22+`, or `24.15+`
- npm 10+
- Docker & Docker Compose

### 1. Clone the Repository
```bash
git clone https://github.com/Ansh-Y/nexora-ai-work-operating-system.git
cd nexora-ai-work-operating-system
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(The defaults in `.env.example` are pre-configured to work out of the box with the included Docker Compose services).*

### 3. Start Data Services
```bash
docker compose up -d
```
Starts PostgreSQL 16 (with pgvector) on port `5432` and Redis 7 on port `6379`.

### 4. Install Dependencies & Initialize Database
```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```
*The seed command provisions demo credentials:*
- **Email:** `demo@nexora.local`
- **Password:** `NexoraDemo!2026`
- **Organization:** `Nexora Studio`

### 5. Launch Application
```bash
npm run dev
```
- **Web App:** [http://localhost:3000](http://localhost:3000)
- **API Server:** [http://localhost:4000/api](http://localhost:4000/api)
- **Interactive Swagger Docs:** [http://localhost:4000/api/docs](http://localhost:4000/api/docs)
- **Health Check:** [http://localhost:4000/api/health](http://localhost:4000/api/health)

---

## Testing & Quality Gates

The project maintains 100% test pass rate across all test suites:

```bash
# Run all backend unit tests (175 tests across 17 suites)
npm --workspace apps/api run test

# Run backend integration E2E tests (10 suites)
npm --workspace apps/api run test:e2e

# Run Playwright browser E2E tests (11 specs including 19-step customer journey)
npm run test:browser

# Run repository linter across backend and frontend
npm run lint

# Run production builds
npm run build
```

---

## Cloud Deployment (Strictly ₹0 / Free Tier)

| Service | Hosting Provider | Free Plan Details | Configuration Guide |
|:---|:---|:---|:---|
| **Frontend Web** | [Vercel Hobby](https://vercel.com/) | 100 GB Bandwidth, Next.js Edge | [DEPLOYMENT.md](DEPLOYMENT.md#5-step-4-frontend-deployment-on-vercel-hobby-tier) |
| **Backend API** | [Render Free](https://render.com/) | 750 hrs/month, HTTPS, WebSockets | [DEPLOYMENT.md](DEPLOYMENT.md#4-step-3-backend-api-deployment-on-render-free-tier) |
| **PostgreSQL DB** | [Neon Free](https://neon.tech/) | Serverless PG 16 + `pgvector` | [DEPLOYMENT.md](DEPLOYMENT.md#2-step-1-database-setup-on-neon-free-tier) |
| **Redis & Queues**| [Upstash Free](https://upstash.com/) | Native TLS Redis TCP, BullMQ | [DEPLOYMENT.md](DEPLOYMENT.md#3-step-2-redis-setup-on-upstash-free-tier) |

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions and [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for variable specifications.

---

## Free-Tier Operational Notes & Mitigations

1. **Render Free Sleep Cycle:** Render free services spin down after 15 minutes of idle traffic. The first request after sleep experiences a 30–50 second cold start.
2. **Co-located Background Queue:** BullMQ background queues operate alongside the API web process with an automatic in-process fallback to guarantee zero service interruption if Redis quotas are reached.
3. **Neon Auto-Suspension:** Neon serverless compute resumes automatically in ~1–2 seconds upon incoming connections with zero data loss.

---

## License

This project is licensed under the MIT License.
