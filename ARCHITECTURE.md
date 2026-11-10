# NEXORA — Architecture & System Design

NEXORA is an AI-powered multi-tenant work operating system built as a modern TypeScript monorepo combining Next.js, NestJS, Prisma 7, PostgreSQL with pgvector, Redis BullMQ queues, and LLM integrations.

---

## 1. System Topology

```mermaid
flowchart TD
    subgraph Client ["Frontend Client (Next.js 16 / React 19)"]
        UI["Obsidian & Jade Design System"]
        Palette["Global Command Palette (Cmd+K)"]
        SocketClient["Socket.IO Client (Real-Time Updates)"]
        Theme["Theme Engine (Light / Dark)"]
    end

    subgraph Edge ["Network & Reverse Proxy"]
        VercelCDN["Vercel Global Edge Network"]
        RenderGateway["Render HTTPS / TLS Ingress"]
    end

    subgraph API ["Backend Application Layer (NestJS 12)"]
        AuthGuards["RolesGuard & JwtAuthGuard"]
        TenancyScope["Tenant Scoping Context (Principal)"]
        
        subgraph CoreControllers ["Core Modules"]
            ProjectsModule["Projects & Milestones"]
            TasksModule["Tasks & Dependencies Graph"]
            MeetingsModule["Meetings & Transcription"]
            StorageModule["Storage & Retention Management"]
        end
        
        subgraph AIControllers ["AI Intelligence Layer"]
            AssistantModule["AI Project Assistant (RAG)"]
            PlannerModule["AI Project Planner"]
            AssignmentModule["Smart Task Assignment Engine"]
            AutomationModule["Event-Triggered Automation Rules"]
            ReportsModule["Weekly Intelligence Reports & PDF"]
            HealthModule["Predictive Risk & Health Scoring"]
        end

        SocketGateway["WebSocket Gateway (Socket.IO)"]
    end

    subgraph Data ["Persistence & Distributed State"]
        PrismaORM["Prisma 7 ORM (PrismaPg Adapter)"]
        PostgresDB[("Neon PostgreSQL 16 + pgvector")]
        RedisCache[("Upstash Redis 7 / BullMQ")]
    end

    Client --> VercelCDN
    Client -- "REST / WebSocket" --> RenderGateway
    RenderGateway --> AuthGuards
    AuthGuards --> TenancyScope
    TenancyScope --> CoreControllers
    TenancyScope --> AIControllers
    TenancyScope --> SocketGateway

    CoreControllers --> PrismaORM
    AIControllers --> PrismaORM
    AIControllers --> RedisCache
    PrismaORM --> PostgresDB
```

---

## 2. Multi-Tenant Isolation & Security Model

NEXORA operates on a strict multi-tenant boundary:
1. **Principal Extraction:** Authentication requests validate JWT signatures and extract `{ sub, orgId, role, email, name }`.
2. **Database Query Scoping:** Every Prisma query includes an explicit `where: { organizationId: user.orgId }` clause. Cross-tenant access is architecturally prevented at the database layer.
3. **Role-Based Access Control (RBAC):**
   - `OWNER`: Full organization control, billing, integrations, and member deletion.
   - `ADMIN`: Project and workspace settings management.
   - `PROJECT_MANAGER`: Workflow automations, health recalculation, task lifecycle approval.
   - `TEAM_MEMBER`: Task creation, comment authoring, status progression.
   - `VIEWER`: Read-only access across all workspace views.

---

## 3. Background Job & Queue Architecture

NEXORA leverages **BullMQ** on **Redis** for asynchronous processing:
- **Project Health Recalculation:** Triggered on bulk status shifts, task cancellations, and scheduled cron ticks.
- **Storage Retention Sweeps:** Automatic lifecycle enforcement based on organization retention policies and legal hold tags.
- **Fail-Safe In-Process Fallback:** When Redis is unreachable or on resource-constrained free tiers, the application automatically activates bounded synchronous fallbacks to ensure uninterrupted operation.

---

## 4. AI Engine & Grounded Context Model

```mermaid
sequenceDiagram
    autonumber
    actor User as Team Member
    participant Assistant as AI Project Assistant
    participant Context as Workspace Context Aggregator
    participant DB as Neon PostgreSQL (pgvector)
    participant LLM as OpenAI (gpt-4o-mini)

    User->>Assistant: "What tasks are blocking the Product Launch release?"
    Assistant->>Context: Fetch active project context (orgId, projectId)
    Context->>DB: Query tasks, dependencies, milestones & health
    DB-->>Context: Return scoped operational data
    Context->>Assistant: Formulate structured prompt & grounding citations
    Assistant->>LLM: Generate cited answer
    LLM-->>Assistant: Streamed markdown response with references
    Assistant-->>User: Render interactive response with clickable task pills
```
