# NEXORA — Environment Variables Reference

This document provides a comprehensive reference for all environment variables supported by the **NEXORA AI Work Operating System** across local development and production deployments.

> [!CAUTION]
> **NEVER commit real secrets, API keys, or database connection strings to source control.**
> Local development reads from `.env` (which is git-ignored). Production secrets must be configured directly within your cloud hosting provider dashboards (Vercel, Render, etc.).

---

## 1. Core Backend API Configuration (`apps/api`)

| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `NODE_ENV` | Optional | `development` | Environment mode (`development`, `production`, `test`). |
| `PORT` | Optional | `4000` | Port on which the NestJS HTTP/WebSocket server listens. |
| `DATABASE_URL` | **Yes** | `postgresql://...` | Connection string for PostgreSQL database. In production with Neon, use the pooled connection URL (`?sslmode=require`). |
| `DIRECT_URL` | Optional | — | Direct (unpooled) connection string for Neon PostgreSQL, used during schema migrations (`prisma migrate deploy`). |
| `REDIS_URL` | Optional | `redis://localhost:6379` | Native Redis TCP connection URL for BullMQ queues and caching. In production with Upstash, use `rediss://...` for TLS. |
| `JWT_SECRET` | **Yes** | — | Cryptographic secret for signing and verifying JSON Web Tokens (minimum 32 characters). |
| `JWT_EXPIRES_IN` | Optional | `15m` | Token expiration time (e.g., `15m`, `1d`). |
| `WEB_ORIGIN` | **Yes** | `http://localhost:3000` | Allowed CORS origin(s) for the frontend client. Comma-separated list supported in production. |
| `API_PUBLIC_URL` | Optional | `http://localhost:4000` | Publicly reachable HTTPS base URL of the API (used for OAuth callbacks and webhook payloads). |

---

## 2. Frontend Web Application (`apps/web`)

| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `NEXT_PUBLIC_API_URL` | **Yes** | `http://localhost:4000/api` | Base REST API URL accessed by the browser client. In production, points to the deployed backend (e.g., `https://nexora-api.onrender.com/api`). |

---

## 3. AI Intelligence & Large Language Models

| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `OPENAI_API_KEY` | Optional | — | OpenAI API key for AI Project Planner, Assistant, and Smart Assignment. |
| `OPENAI_MODEL` | Optional | `gpt-4o-mini` | Model identifier used for generative completions and proposals. |
| `OPENAI_EMBEDDING_MODEL` | Optional | `text-embedding-3-small` | Model identifier used for semantic workspace vector embeddings (`pgvector`). |
| `TRANSCRIPTION_API_KEY` | Optional | — | API key for speech-to-text audio transcription (defaults to `OPENAI_API_KEY` if omitted). |
| `MEETING_TRANSCRIPTION_URL` | Optional | `https://api.openai.com/v1/audio/transcriptions` | Endpoint for Whisper-compatible audio transcription. |
| `MEETING_TRANSCRIPTION_MODEL` | Optional | `whisper-1` | Model name for meeting audio transcription. |

---

## 4. Storage & Retention Management

| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `STORAGE_PROVIDER` | Optional | `local` | Storage driver (`local` for filesystem or `s3` for S3-compatible object storage). |
| `STORAGE_LOCAL_DIR` | Optional | `./var/storage` | Local filesystem path where uploaded documents and files are stored. |
| `MEETING_STORAGE_DIR` | Optional | `./var/meeting-recordings` | Filesystem path for meeting audio recordings. |
| `MEETING_MAX_UPLOAD_BYTES` | Optional | `26214400` | Maximum file upload size in bytes (default 25 MB). |
| `STORAGE_S3_BUCKET` | Cond. | — | S3 or Cloudflare R2 bucket name (required if `STORAGE_PROVIDER=s3`). |
| `STORAGE_S3_REGION` | Cond. | `auto` | AWS or R2 region. |
| `STORAGE_S3_ENDPOINT` | Cond. | — | Endpoint URL for Cloudflare R2 or MinIO (e.g. `https://<account-id>.r2.cloudflarestorage.com`). |
| `STORAGE_S3_ACCESS_KEY_ID` | Cond. | — | S3/R2 Access Key ID. |
| `STORAGE_S3_SECRET_ACCESS_KEY`| Cond. | — | S3/R2 Secret Access Key. |
| `STORAGE_S3_FORCE_PATH_STYLE` | Cond. | `false` | Whether to force path-style S3 URLs (set `true` for MinIO). |

---

## 5. Third-Party Integrations

### GitHub OAuth & Webhooks
| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `GITHUB_CLIENT_ID` | Optional | — | Client ID from your GitHub OAuth App. |
| `GITHUB_CLIENT_SECRET` | Optional | — | Client Secret from your GitHub OAuth App. |
| `GITHUB_CALLBACK_URL` | Optional | `.../api/integrations/github/callback` | OAuth redirect URI registered in GitHub. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Optional | — | 32-byte hexadecimal key (64 hex characters) for encrypting stored OAuth tokens at rest. |

### Google Workspace
| Variable | Required | Default (Local) | Description |
|:---|:---:|:---|:---|
| `GOOGLE_CLIENT_ID` | Optional | — | OAuth Client ID from Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Optional | — | OAuth Client Secret from Google Cloud Console. |
| `GOOGLE_CALLBACK_URL` | Optional | `.../api/integrations/google/callback` | Authorized redirect URI registered in Google Cloud. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Optional | — | 32-byte hexadecimal key for encrypting stored Google OAuth tokens at rest. |

---

## 6. Production Deployment Mapping

```
                                  ┌────────────────────────┐
                                  │      Vercel Hobby      │
                                  │       apps/web         │
                                  └───────────┬────────────┘
                                              │ NEXT_PUBLIC_API_URL
                                              ▼
┌─────────────────────────┐       ┌────────────────────────┐       ┌─────────────────────────┐
│     Neon PostgreSQL     │◄──────┤       Render Free      ├──────►│      Upstash Redis      │
│  DATABASE_URL / pgvector│       │        apps/api        │       │    REDIS_URL (rediss://)│
└─────────────────────────┘       └────────────────────────┘       └─────────────────────────┘
```
