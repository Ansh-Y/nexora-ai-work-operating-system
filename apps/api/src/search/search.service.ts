import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';

type Source = { id: string; type: string; title: string; content: string; projectId?: string | null; url: string };
type SearchResult = { id: string; type: string; title: string; snippet: string; projectId?: string | null; url: string; similarity?: number; match: string };

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  async search(user: Principal, rawQuery: string) {
    const query = rawQuery.trim();
    const lexical = await this.keywordSearch(user.orgId, query);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return { query, mode: 'keyword', results: lexical.slice(0, 20), semanticAvailable: false };

    try {
      const sources = await this.sources(user.orgId);
      const byKey = new Map(sources.map(source => [`${source.type}:${source.id}`, source]));
      const chunks = await this.prisma.searchChunk.findMany({ where: { organizationId: user.orgId }, select: { id: true, sourceType: true, sourceId: true, content: true } });
      const current = new Map(chunks.map(chunk => [`${chunk.sourceType}:${chunk.sourceId}`, chunk]));
      const missing = sources.filter(source => current.get(`${source.type}:${source.id}`)?.content !== source.content).slice(0, 200);
      const embeddingBySource = new Map<string, number[]>();
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        const vectors = await this.embed(apiKey, batch.map(source => source.content));
        for (let index = 0; index < batch.length; index++) embeddingBySource.set(`${batch[index].type}:${batch[index].id}`, vectors[index]);
      }
      for (const source of missing) {
        const key = `${source.type}:${source.id}`;
        const vector = embeddingBySource.get(key);
        if (!vector) continue;
        const chunk = await this.prisma.searchChunk.upsert({
          where: { organizationId_sourceType_sourceId: { organizationId: user.orgId, sourceType: source.type, sourceId: source.id } },
          create: { organizationId: user.orgId, sourceType: source.type, sourceId: source.id, content: source.content },
          update: { content: source.content },
          select: { id: true },
        });
        const literal = `[${vector.join(',')}]`;
        await this.prisma.$executeRaw`UPDATE "SearchChunk" SET "embedding" = ${literal}::vector WHERE "id" = ${chunk.id}::uuid AND "organizationId" = ${user.orgId}::uuid`;
      }
      const [queryVector] = await this.embed(apiKey, [query]);
      const literal = `[${queryVector.join(',')}]`;
      const ranked = await this.prisma.$queryRaw<{ sourceType: string; sourceId: string; similarity: number }[]>(Prisma.sql`
        SELECT "sourceType", "sourceId", (1 - ("embedding" <=> ${literal}::vector))::float AS similarity
        FROM "SearchChunk"
        WHERE "organizationId" = ${user.orgId}::uuid AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> ${literal}::vector
        LIMIT 30
      `);
      const vectorResults = ranked.flatMap(row => {
        const source = byKey.get(`${row.sourceType}:${row.sourceId}`);
        return source ? [{ ...source, similarity: Math.round(row.similarity * 100), match: 'semantic' as const }] : [];
      });
      const combined = new Map<string, SearchResult>();
      for (const item of lexical) combined.set(`${item.type}:${item.id}`, { ...item, match: 'keyword' });
      for (const item of vectorResults) {
        const key = `${item.type}:${item.id}`; const previous = combined.get(key);
        combined.set(key, { ...previous, id: item.id, type: item.type, title: item.title, snippet: previous?.snippet || item.content.slice(0, 240), projectId: item.projectId, url: item.url, similarity: item.similarity, match: previous ? 'keyword + semantic' : 'semantic' });
      }
      const results = [...combined.values()].sort((a, b) => (b.similarity ?? (b.match === 'keyword + semantic' ? 65 : 35)) - (a.similarity ?? (a.match === 'keyword + semantic' ? 65 : 35))).slice(0, 20);
      return { query, mode: 'hybrid', results, semanticAvailable: true };
    } catch {
      // Search remains useful if the optional embedding provider is temporarily unavailable.
      return { query, mode: 'keyword', results: lexical.slice(0, 20), semanticAvailable: false };
    }
  }

  private async sources(orgId: string): Promise<Source[]> {
    const [projects, tasks, comments, meetings, documents, decisions, actions, githubEvents] = await Promise.all([
      this.prisma.project.findMany({ where: { organizationId: orgId, status: { not: 'ARCHIVED' } }, select: { id: true, name: true, description: true } }),
      this.prisma.task.findMany({ where: { organizationId: orgId }, include: { project: { select: { name: true } } }, take: 1000 }),
      this.prisma.comment.findMany({ where: { organizationId: orgId }, include: { task: { select: { id: true, title: true, projectId: true } }, project: { select: { id: true, name: true } } }, take: 1000 }),
      this.prisma.meeting.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, title: true, transcript: true, summary: true, projectId: true }, take: 500 }),
      this.prisma.document.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, extractedText: true, projectId: true }, take: 500 }),
      this.prisma.meetingDecision.findMany({ where: { organizationId: orgId, meeting: { archivedAt: null } }, include: { meeting: { select: { title: true, projectId: true } } }, take: 1000 }),
      this.prisma.meetingActionItem.findMany({ where: { organizationId: orgId, meeting: { archivedAt: null } }, include: { meeting: { select: { title: true, projectId: true } } }, take: 1000 }),
      this.prisma.gitHubEvent.findMany({ where: { organizationId: orgId }, include: { repository: { select: { fullName: true, project: { select: { id: true } } } }, linkedTask: { select: { title: true } } }, take: 1000 }),
    ]);
    return [
      ...projects.map(p => ({ id: p.id, type: 'project', title: p.name, content: `${p.name}\n${p.description}`.slice(0, 12000), url: `/projects/${p.id}` })),
      ...tasks.map(t => ({ id: t.id, type: 'task', title: t.title, content: `${t.title}\n${t.description}\nProject: ${t.project.name}`.slice(0, 12000), projectId: t.projectId, url: `/projects/${t.projectId}?task=${t.id}` })),
      ...comments.map(c => ({ id: c.id, type: 'comment', title: c.task?.title || c.project?.name || 'Project comment', content: `${c.task?.title || c.project?.name || 'Comment'}\n${c.body}`.slice(0, 12000), projectId: c.task?.projectId || c.projectId, url: c.task?.projectId ? `/projects/${c.task.projectId}?task=${c.task.id}` : c.projectId ? `/projects/${c.projectId}` : '/projects' })),
      ...meetings.map(m => ({ id: m.id, type: 'meeting', title: m.title, content: `${m.title}\n${m.summary || ''}\n${m.transcript || ''}`.slice(0, 12000), projectId: m.projectId, url: '/meetings' })),
      ...documents.filter(d => d.extractedText).map(d => ({ id: d.id, type: 'document', title: d.title, content: `${d.title}\n${d.extractedText}`.slice(0, 12000), projectId: d.projectId, url: '/documents' })),
      ...decisions.map(d => ({ id: d.id, type: 'meeting_decision', title: d.title, content: `${d.meeting.title}\nDecision: ${d.title}\nEvidence: ${d.evidence}`.slice(0, 6000), projectId: d.meeting.projectId, url: '/meetings' })),
      ...actions.map(a => ({ id: a.id, type: 'meeting_action', title: a.title, content: `${a.meeting.title}\nAction: ${a.title}\n${a.description}\nStatus: ${a.status}\nEvidence: ${a.evidence}`.slice(0, 6000), projectId: a.projectId ?? a.meeting.projectId, url: '/meetings' })),
      ...githubEvents.map(event => ({ id: event.id, type: 'github_event', title: event.title || `${event.repository.fullName} · ${event.eventType}`, content: `${event.repository.fullName}\n${event.eventType} ${event.action || ''}\n${event.title || ''}\n${event.summary || ''}\n${event.branch || ''}\n${event.linkedTask?.title || ''}`.slice(0, 6000), projectId: event.repository.project.id, url: event.url || `/projects/${event.repository.project.id}` })),
    ];
  }

  private async keywordSearch(orgId: string, q: string) {
    const stopWords = new Set(['what', 'which', 'where', 'when', 'were', 'was', 'are', 'the', 'and', 'for', 'from', 'with', 'that', 'this', 'have', 'has', 'does', 'did', 'about', 'into', 'after', 'before', 'made']);
    const terms = [...new Set((q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(term => !stopWords.has(term)))].slice(0, 8);
    const matches = (fields: string[]) => [...new Set([q, ...terms])].flatMap(term => fields.map(field => ({ [field]: { contains: term, mode: 'insensitive' as const } })));
    const [projects, tasks, comments, meetings, documents, decisions, actions, githubEvents] = await Promise.all([
      this.prisma.project.findMany({ where: { organizationId: orgId, status: { not: 'ARCHIVED' }, OR: matches(['name', 'description']) }, select: { id: true, name: true, description: true }, take: 8 }),
      this.prisma.task.findMany({ where: { organizationId: orgId, OR: matches(['title', 'description']) }, include: { project: { select: { name: true } } }, take: 10 }),
      this.prisma.comment.findMany({ where: { organizationId: orgId, OR: matches(['body']) }, include: { task: { select: { id: true, title: true, projectId: true } }, project: { select: { id: true, name: true } } }, take: 8 }),
      this.prisma.meeting.findMany({ where: { organizationId: orgId, archivedAt: null, OR: matches(['title', 'summary', 'transcript']) }, select: { id: true, title: true, summary: true, transcript: true, projectId: true }, take: 8 }),
      this.prisma.document.findMany({ where: { organizationId: orgId, OR: matches(['title', 'extractedText']) }, select: { id: true, title: true, extractedText: true, projectId: true }, take: 8 }),
      this.prisma.meetingDecision.findMany({ where: { organizationId: orgId, meeting: { archivedAt: null }, OR: matches(['title', 'evidence']) }, include: { meeting: { select: { title: true, projectId: true } } }, take: 8 }),
      this.prisma.meetingActionItem.findMany({ where: { organizationId: orgId, meeting: { archivedAt: null }, OR: matches(['title', 'description', 'evidence']) }, include: { meeting: { select: { title: true, projectId: true } } }, take: 8 }),
      this.prisma.gitHubEvent.findMany({ where: { organizationId: orgId, OR: matches(['eventType', 'action', 'title', 'summary', 'branch', 'commitSha']) }, include: { repository: { select: { fullName: true, project: { select: { id: true, name: true } } } }, linkedTask: { select: { title: true } } }, take: 12 }),
    ]);
    const results = [
      ...projects.map(p => ({ id: p.id, type: 'project', title: p.name, snippet: p.description, url: `/projects/${p.id}` })),
      ...tasks.map(t => ({ id: t.id, type: 'task', title: t.title, snippet: `${t.project.name} · ${t.description}`, projectId: t.projectId, url: `/projects/${t.projectId}?task=${t.id}` })),
      ...comments.map(c => ({ id: c.id, type: 'comment', title: c.task?.title || c.project?.name || 'Project comment', snippet: c.body, projectId: c.task?.projectId || c.projectId, url: c.task?.projectId ? `/projects/${c.task.projectId}?task=${c.task.id}` : c.projectId ? `/projects/${c.projectId}` : '/projects' })),
      ...meetings.map(m => ({ id: m.id, type: 'meeting', title: m.title, snippet: (m.summary || m.transcript || '').slice(0, 240), projectId: m.projectId, url: '/meetings' })),
      ...documents.map(d => ({ id: d.id, type: 'document', title: d.title, snippet: (d.extractedText || '').slice(0, 240), projectId: d.projectId, url: '/documents' })),
      ...decisions.map(d => ({ id: d.id, type: 'meeting_decision', title: d.title, snippet: `${d.meeting.title} · ${d.evidence}`.slice(0, 240), projectId: d.meeting.projectId, url: '/meetings' })),
      ...actions.map(a => ({ id: a.id, type: 'meeting_action', title: a.title, snippet: `${a.meeting.title} · ${a.evidence}`.slice(0, 240), projectId: a.projectId ?? a.meeting.projectId, url: '/meetings' })),
      ...githubEvents.map(event => ({ id: event.id, type: 'github_event', title: event.title || `${event.repository.fullName} · ${event.eventType}`, snippet: `${event.repository.project.name} · ${event.summary || event.branch || event.eventType}`.slice(0, 240), projectId: event.repository.project.id, url: event.url || `/projects/${event.repository.project.id}` })),
    ];
    const score = (item: { title: string; snippet: string }) => terms.reduce((total, term) => total + (item.title.toLowerCase().includes(term) ? 3 : 0) + (item.snippet.toLowerCase().includes(term) ? 1 : 0), item.title.toLowerCase().includes(q.toLowerCase()) ? 5 : 0);
    return results.sort((a, b) => score(b) - score(a)).slice(0, 42);
  }

  private async embed(apiKey: string, input: string[]) {
    const response = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.config.get('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'), input }) });
    if (!response.ok) throw new Error('Embedding provider unavailable');
    const body = await response.json() as { data: { embedding: number[]; index: number }[] };
    return body.data.sort((a, b) => a.index - b.index).map(row => row.embedding);
  }
}
