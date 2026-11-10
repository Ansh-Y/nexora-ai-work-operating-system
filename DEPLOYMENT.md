# NEXORA — Zero-Cost Cloud Deployment Guide

This guide describes how to deploy the **NEXORA AI Work Operating System** using strictly **FREE-TIER** cloud infrastructure:

- **Frontend:** [Vercel Hobby](https://vercel.com/) (Next.js 16 / React 19)
- **Backend API:** [Render Free Web Service](https://render.com/) (NestJS 12 / Socket.IO)
- **Database:** [Neon Free Serverless PostgreSQL](https://neon.tech/) (with `pgvector` enabled)
- **Queue & Cache:** [Upstash Free Serverless Redis](https://upstash.com/) (Native TLS Redis TCP)
- **Optional Storage:** [Cloudflare R2 Free](https://cloudflare.com/) (10 GB free object storage)

---

## 1. Prerequisites & Account Checklist

1. **GitHub Account:** Repository must be hosted on GitHub (e.g. `https://github.com/Ansh-Y/nexora-ai-work-operating-system`).
2. **Neon Account:** [Neon Console](https://console.neon.tech/) for managed PostgreSQL.
3. **Upstash Account:** [Upstash Console](https://console.upstash.com/) for managed Redis.
4. **Render Account:** [Render Dashboard](https://dashboard.render.com/) for containerized Node.js API.
5. **Vercel Account:** [Vercel Dashboard](https://vercel.com/) for Next.js web application.

---

## 2. Step 1: Database Setup on Neon (Free Tier)

1. **Create or Select Project:** In the [Neon Console](https://console.neon.tech/), navigate to your project (e.g. `dark-river-10941264`).
2. **Create Database:** Create a dedicated database named `nexora` on the `production` branch.
3. **Enable `pgvector` Extension:** Run SQL in the Neon SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. **Deploy Schema Migrations:**
   From your local development machine, deploy all 16 Prisma migrations using the direct (unpooled) connection string:
   ```bash
   DATABASE_URL="postgresql://<user>:<password>@<endpoint>.neon.tech/nexora?sslmode=require" npx prisma migrate deploy
   ```
5. **Seed Demo Data (Optional):**
   ```bash
   DATABASE_URL="postgresql://<user>:<password>@<endpoint>.neon.tech/nexora?sslmode=require" npx tsx prisma/seed.ts
   ```
   *Creates demo account:* `demo@nexora.local` / `NexoraDemo!2026`.

---

## 3. Step 2: Redis Setup on Upstash (Free Tier)

1. In the [Upstash Console](https://console.upstash.com/), create a free Redis database in your nearest region.
2. Select **Redis Connect** and copy the **Node.js (ioredis)** native TCP connection URL.
3. Format: `rediss://default:<password>@<host>.upstash.io:6379` (Note: Ensure the scheme is `rediss://` for TLS).

---

## 4. Step 3: Backend API Deployment on Render (Free Tier)

### Method A: One-Click Blueprint (`render.yaml`)
1. Log in to the [Render Dashboard](https://dashboard.render.com/).
2. Click **New** $\rightarrow$ **Blueprint**.
3. Select your repository: `Ansh-Y/nexora-ai-work-operating-system`.
4. Render will parse [render.yaml](render.yaml) automatically.
5. Configure environment variables in the Render UI:
   - `DATABASE_URL`: Your pooled Neon connection string (`postgresql://...@...-pooler.neon.tech/nexora?sslmode=require`)
   - `REDIS_URL`: Your native Upstash Redis URL (`rediss://...`)
   - `JWT_SECRET`: Random 32+ character string
   - `WEB_ORIGIN`: Your Vercel frontend URL (e.g. `https://nexora-web.vercel.app`)
6. Click **Apply**.

### Method B: Manual Web Service Setup
- **Name:** `nexora-api`
- **Environment:** `Node`
- **Region:** Singapore / Oregon / Frankfurt (closest to your Neon database)
- **Branch:** `main`
- **Root Directory:** *(leave blank — repository root)*
- **Build Command:**
  ```bash
  npm install && npm run db:generate && npm --workspace apps/api run build
  ```
- **Start Command:**
  ```bash
  npm --workspace apps/api run start
  ```
- **Health Check Path:** `/api/health`

---

## 5. Step 4: Frontend Deployment on Vercel (Hobby Tier)

1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New...** $\rightarrow$ **Project**.
3. Import your GitHub repository: `Ansh-Y/nexora-ai-work-operating-system`.
4. **Configure Project:**
   - **Framework Preset:** `Next.js`
   - **Root Directory:** Click Edit and select `apps/web`.
5. **Environment Variables:**
   - Add `NEXT_PUBLIC_API_URL`: `https://nexora-api.onrender.com/api` (replace with your actual Render API URL).
6. Click **Deploy**.

---

## 6. Step 5: Post-Deployment Verification

1. **Verify Backend Health:**
   ```bash
   curl -i https://<your-render-url>.onrender.com/api/health
   # Expected: {"status":"ok","timestamp":"...","service":"nexora-api"}
   ```
2. **Verify Frontend Access:** Open `https://<your-vercel-domain>.vercel.app` in your browser.
3. **Verify Demo Login:**
   - Email: `demo@nexora.local`
   - Password: `NexoraDemo!2026`
4. Confirm Overview Dashboard loads with the `Product Launch` project and real-time statistics.

---

## 7. Free-Tier Operational Constraints & Known Limitations

| Provider | Constraint | Impact & Mitigation |
|:---|:---|:---|
| **Render Free Web Service** | Spins down after 15 minutes of inactivity | First request after sleep experiences a 30–50s cold start. Background jobs and cron sweeps pause while the container sleeps. |
| **Upstash Free Redis** | 10,000 commands/day limit | Sufficient for demonstration and small team usage. If exceeded, queues fall back gracefully to in-memory/direct execution. |
| **Neon Free PostgreSQL** | Compute auto-suspends on idle (100% free) | Cold resume takes ~1–2 seconds. Stored data is persistent and never deleted on active projects. |
| **Vercel Hobby** | 100 GB bandwidth, serverless execution limits | Ample headroom for high-performance static rendering and client-side interactions. |
