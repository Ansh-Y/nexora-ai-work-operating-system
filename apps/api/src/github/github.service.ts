import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationRole, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';
import { decryptGithubSecret, encryptGithubSecret, hashGithubOAuthState, newGithubOAuthState, taskReference, verifyGithubSignature } from './github-security';
import { LinkGitHubRepositoryDto } from './github.dto';

const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Nexora-Workspace' };
type JsonRecord = Record<string, any>;

@Injectable()
export class GitHubService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private assertManager(user: Principal) {
    if (user.role !== OrganizationRole.OWNER && user.role !== OrganizationRole.ADMIN) throw new ForbiddenException('Workspace owners or admins must manage GitHub integration settings');
  }

  private oauthConfig() {
    const credentials = this.appCredentials();
    const callbackUrl = this.config.get<string>('GITHUB_CALLBACK_URL');
    if (!callbackUrl) throw new ServiceUnavailableException('Configure GITHUB_CALLBACK_URL to connect GitHub.');
    try { new URL(callbackUrl); } catch { throw new ServiceUnavailableException('GITHUB_CALLBACK_URL must be a valid HTTPS URL.'); }
    if (!callbackUrl.startsWith('https://') && !['localhost', '127.0.0.1'].includes(new URL(callbackUrl).hostname)) throw new ServiceUnavailableException('GITHUB_CALLBACK_URL must use HTTPS outside local development.');
    return { ...credentials, callbackUrl };
  }

  private appCredentials() {
    const clientId = this.config.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.config.get<string>('GITHUB_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new ServiceUnavailableException('Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to connect GitHub.');
    return { clientId, clientSecret };
  }

  private encryptionKey() { return this.config.get<string>('GITHUB_TOKEN_ENCRYPTION_KEY'); }
  private async connection(orgId: string) {
    const row = await this.prisma.gitHubConnection.findUnique({ where: { organizationId: orgId } });
    if (!row) throw new BadRequestException('Connect a GitHub account first.');
    return { ...row, token: decryptGithubSecret(row.tokenCiphertext, this.encryptionKey()) };
  }

  async status(user: Principal) {
    const [connection, repositories] = await Promise.all([
      this.prisma.gitHubConnection.findUnique({ where: { organizationId: user.orgId }, select: { githubLogin: true, scopes: true, createdAt: true } }),
      this.prisma.gitHubRepository.findMany({ where: { organizationId: user.orgId }, orderBy: { fullName: 'asc' }, select: { id: true, githubRepoId: true, fullName: true, owner: true, name: true, defaultBranch: true, isPrivate: true, project: { select: { id: true, name: true } }, _count: { select: { events: true } } } }),
    ]);
    const configured = Boolean(this.config.get('GITHUB_CLIENT_ID') && this.config.get('GITHUB_CLIENT_SECRET') && this.config.get('GITHUB_CALLBACK_URL'));
    const encryptionReady = /^[\da-f]{64}$/i.test(this.encryptionKey() ?? '');
    return { configured, encryptionReady, connected: Boolean(connection), account: connection, repositories: repositories.map(({ githubRepoId, ...repository }) => ({ ...repository, githubRepoId: githubRepoId.toString() })), webhookBaseUrl: this.config.get<string>('API_PUBLIC_URL') ? `${this.config.get<string>('API_PUBLIC_URL')!.replace(/\/$/, '')}/api/integrations/github/webhook` : null };
  }

  async beginConnection(user: Principal) {
    this.assertManager(user);
    const { clientId, callbackUrl } = this.oauthConfig();
    // Fail before redirecting so a successful OAuth callback can never store an unusable plaintext token.
    if (!/^[\da-f]{64}$/i.test(this.encryptionKey() ?? '')) throw new ServiceUnavailableException('Configure GITHUB_TOKEN_ENCRYPTION_KEY as 64 hexadecimal characters before connecting GitHub.');
    const state = newGithubOAuthState();
    await this.prisma.gitHubOAuthState.deleteMany({ where: { organizationId: user.orgId, OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }] } });
    await this.prisma.gitHubOAuthState.create({ data: { stateHash: hashGithubOAuthState(state), organizationId: user.orgId, userId: user.sub, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'read:user repo');
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString() };
  }

  async callback(code: string, state: string) {
    if (!code || code.length > 2000 || !state || state.length > 200) throw new BadRequestException('GitHub returned an invalid OAuth response.');
    const { clientId, clientSecret } = this.oauthConfig();
    const now = new Date();
    const stateHash = hashGithubOAuthState(state);
    const claim = await this.prisma.gitHubOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (!claim.count) throw new UnauthorizedException('GitHub authorization state is invalid, expired, or already used.');
    const stateRow = await this.prisma.gitHubOAuthState.findUnique({ where: { stateHash } });
    const membership = stateRow ? await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: stateRow.organizationId, userId: stateRow.userId } } }) : null;
    if (!stateRow || !membership || (membership.role !== OrganizationRole.OWNER && membership.role !== OrganizationRole.ADMIN)) throw new UnauthorizedException('Workspace membership or role changed during GitHub authorization.');

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', signal: AbortSignal.timeout(15_000), headers: { ...API_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    if (!tokenResponse.ok) throw new BadRequestException('GitHub could not exchange the authorization code.');
    const tokenBody = await tokenResponse.json() as JsonRecord;
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token || tokenBody.token_type !== 'bearer') throw new BadRequestException('GitHub returned an invalid access token.');
    const token = tokenBody.access_token.slice(0, 4000);
    const profileResponse = await fetch('https://api.github.com/user', { headers: { ...API_HEADERS, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!profileResponse.ok) throw new BadRequestException('GitHub could not verify the connected account.');
    const profile = await profileResponse.json() as JsonRecord;
    if (!Number.isSafeInteger(profile.id) || typeof profile.login !== 'string' || !profile.login) throw new BadRequestException('GitHub returned an invalid account profile.');
    const scopes = typeof tokenBody.scope === 'string' ? tokenBody.scope.split(',').map((scope: string) => scope.trim()).filter(Boolean) : [];
    const tokenCiphertext = encryptGithubSecret(token, this.encryptionKey());
    const connection = await this.prisma.gitHubConnection.upsert({
      where: { organizationId: stateRow.organizationId },
      create: { organizationId: stateRow.organizationId, connectedById: stateRow.userId, githubUserId: String(profile.id), githubLogin: profile.login.slice(0, 100), tokenCiphertext, scopes },
      update: { connectedById: stateRow.userId, githubUserId: String(profile.id), githubLogin: profile.login.slice(0, 100), tokenCiphertext, scopes },
    });
    await this.prisma.auditEvent.create({ data: { organizationId: stateRow.organizationId, actorType: 'USER', actorId: stateRow.userId, action: 'github.connected', targetType: 'github_connection', targetId: connection.id, metadata: { githubLogin: connection.githubLogin, scopes } } });
    return stateRow.organizationId;
  }

  async disconnect(user: Principal) {
    this.assertManager(user);
    const storedConnection = await this.prisma.gitHubConnection.findUnique({ where: { organizationId: user.orgId } });
    const connection = storedConnection && { id: storedConnection.id, githubLogin: storedConnection.githubLogin };
    if (!connection) return { disconnected: true };
    let remoteRevocation = false;
    try {
      const { clientId, clientSecret } = this.appCredentials();
      const accessToken = decryptGithubSecret(storedConnection!.tokenCiphertext, this.encryptionKey());
      const response = await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`, {
        method: 'DELETE', signal: AbortSignal.timeout(10_000),
        headers: { ...API_HEADERS, Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      remoteRevocation = response.status === 204;
    } catch { /* Local disconnect still removes the only stored copy of the credential. */ }
    await this.prisma.$transaction(async tx => {
      await tx.gitHubConnection.delete({ where: { organizationId: user.orgId } });
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'github.disconnected', targetType: 'github_connection', targetId: connection.id, metadata: { githubLogin: connection.githubLogin, remoteRevocation } } });
    });
    return { disconnected: true, remoteRevocation: remoteRevocation ? 'revoked' : 'not_confirmed' };
  }

  async availableRepositories(user: Principal) {
    this.assertManager(user);
    const connection = await this.connection(user.orgId);
    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&type=all', { headers: { ...API_HEADERS, Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new BadRequestException('GitHub could not list repositories. Reconnect the account or review its repository access.');
    const rows = await response.json() as JsonRecord[];
    if (!Array.isArray(rows)) throw new BadRequestException('GitHub returned an invalid repository list.');
    return rows.slice(0, 100).flatMap(repo => Number.isSafeInteger(repo.id) && typeof repo.full_name === 'string' && typeof repo.owner?.login === 'string' && typeof repo.name === 'string'
      ? [{ id: String(repo.id), fullName: repo.full_name.slice(0, 200), owner: repo.owner.login.slice(0, 100), name: repo.name.slice(0, 100), defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch.slice(0, 200) : null, isPrivate: repo.private === true }]
      : []);
  }

  async linkRepository(user: Principal, dto: LinkGitHubRepositoryDto) {
    this.assertManager(user);
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId: user.orgId, archivedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
    const connection = await this.connection(user.orgId);
    const repoResponse = await fetch(`https://api.github.com/repositories/${dto.repositoryId}`, { headers: { ...API_HEADERS, Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(15_000) });
    if (!repoResponse.ok) throw new BadRequestException('The selected repository is not accessible to the connected GitHub account.');
    const repo = await repoResponse.json() as JsonRecord;
    if (String(repo.id) !== dto.repositoryId || typeof repo.owner?.login !== 'string' || typeof repo.name !== 'string') throw new BadRequestException('GitHub returned invalid repository metadata.');
    const linked = await this.prisma.gitHubRepository.upsert({
      where: { organizationId_githubRepoId: { organizationId: user.orgId, githubRepoId: BigInt(repo.id) } },
      create: { organizationId: user.orgId, connectionId: connection.id, projectId: project.id, githubRepoId: BigInt(repo.id), owner: repo.owner.login.slice(0, 100), name: repo.name.slice(0, 100), fullName: repo.full_name.slice(0, 200), defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch.slice(0, 200) : null, isPrivate: repo.private === true },
      update: { connectionId: connection.id, projectId: project.id, owner: repo.owner.login.slice(0, 100), name: repo.name.slice(0, 100), fullName: repo.full_name.slice(0, 200), defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch.slice(0, 200) : null, isPrivate: repo.private === true },
      select: { id: true, fullName: true },
    });
    await this.prisma.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'github.repository.linked', targetType: 'github_repository', targetId: linked.id, metadata: { fullName: linked.fullName, projectId: project.id } } });
    return linked;
  }

  async unlinkRepository(user: Principal, repositoryId: string) {
    this.assertManager(user);
    const repository = await this.prisma.gitHubRepository.findFirst({ where: { id: repositoryId, organizationId: user.orgId }, select: { id: true, fullName: true } });
    if (!repository) throw new NotFoundException('Repository not found.');
    await this.prisma.$transaction(async tx => {
      await tx.gitHubRepository.delete({ where: { id: repository.id } });
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'github.repository.unlinked', targetType: 'github_repository', targetId: repository.id, metadata: { fullName: repository.fullName } } });
    });
    return { unlinked: true };
  }

  async configureWebhook(user: Principal, repositoryId: string) {
    this.assertManager(user);
    const webhookBaseUrl = this.config.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '');
    if (!webhookBaseUrl || (!webhookBaseUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(webhookBaseUrl))) throw new ServiceUnavailableException('Configure API_PUBLIC_URL with the public HTTPS API origin before setting up a GitHub webhook.');
    const repository = await this.prisma.gitHubRepository.findFirst({ where: { id: repositoryId, organizationId: user.orgId }, select: { id: true, fullName: true } });
    if (!repository) throw new NotFoundException('Repository not found.');
    const secret = randomBytes(32).toString('hex');
    await this.prisma.gitHubRepository.update({ where: { id: repository.id }, data: { webhookSecretCiphertext: encryptGithubSecret(secret, this.encryptionKey()) } });
    await this.prisma.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'github.webhook.secret_rotated', targetType: 'github_repository', targetId: repository.id, metadata: { fullName: repository.fullName } } });
    return { webhookUrl: `${webhookBaseUrl}/api/integrations/github/webhook`, secret, events: ['push', 'pull_request', 'issues'] };
  }

  async events(user: Principal) {
    return this.prisma.gitHubEvent.findMany({ where: { organizationId: user.orgId }, orderBy: { occurredAt: 'desc' }, take: 100, include: { repository: { select: { id: true, fullName: true, project: { select: { id: true, name: true } } } }, linkedTask: { select: { id: true, title: true, status: true } } } });
  }

  async handleWebhook(headers: { event?: string; delivery?: string; signature?: string }, rawBody: Buffer, payload: JsonRecord) {
    if (!rawBody?.length || rawBody.length > 1_000_000) throw new BadRequestException('Webhook body is missing or too large.');
    if (!headers.event || headers.event.length > 80 || !/^[a-z_]+$/.test(headers.event) || !headers.delivery || headers.delivery.length > 200) throw new BadRequestException('GitHub webhook headers are missing or invalid.');
    const githubRepoId = payload?.repository?.id;
    if (!(typeof githubRepoId === 'number' && Number.isSafeInteger(githubRepoId)) && !(typeof githubRepoId === 'string' && /^\d{1,20}$/.test(githubRepoId))) throw new NotFoundException('The webhook repository is not connected.');
    const candidates = await this.prisma.gitHubRepository.findMany({ where: { githubRepoId: BigInt(githubRepoId), webhookSecretCiphertext: { not: null } }, select: { id: true, organizationId: true, projectId: true, fullName: true, webhookSecretCiphertext: true } });
    const match = candidates.find(repository => repository.webhookSecretCiphertext && verifyGithubSignature(rawBody, headers.signature, decryptGithubSecret(repository.webhookSecretCiphertext, this.encryptionKey())));
    if (!match) throw new UnauthorizedException('Webhook signature is invalid or the repository is not connected.');

    const info = this.eventSummary(headers.event, payload);
    if (!info) return { accepted: true, ignored: true };
    const taskRef = taskReference(`${info.title ?? ''}\n${info.summary ?? ''}`);
    const linkedTask = taskRef ? await this.prisma.task.findFirst({ where: { id: taskRef, organizationId: match.organizationId, projectId: match.projectId }, select: { id: true } }) : null;
    try {
      const event = await this.prisma.$transaction(async tx => {
        const created = await tx.gitHubEvent.create({ data: { organizationId: match.organizationId, repositoryId: match.id, githubDeliveryId: headers.delivery!, eventType: headers.event!, action: info.action, number: info.number, title: info.title, url: info.url, summary: info.summary, branch: info.branch, commitSha: info.commitSha, linkedTaskId: linkedTask?.id, occurredAt: info.occurredAt } });
        await tx.auditEvent.create({ data: { organizationId: match.organizationId, actorType: 'SYSTEM', action: 'github.webhook.received', targetType: 'github_event', targetId: created.id, metadata: { repository: match.fullName, eventType: headers.event, action: info.action, linkedTaskId: linkedTask?.id ?? null } } });
        return created;
      });
      return { accepted: true, duplicate: false, eventId: event.id, linkedTaskId: linkedTask?.id ?? null };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { accepted: true, duplicate: true };
      throw error;
    }
  }

  private eventSummary(eventType: string, payload: JsonRecord) {
    const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : new Date();
    const short = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : null;
    if (eventType === 'pull_request' && payload.pull_request) {
      const pr = payload.pull_request;
      return { action: short(payload.action, 80), number: Number.isInteger(pr.number) ? pr.number : null, title: short(pr.title, 300), url: short(pr.html_url, 1000), summary: short(pr.body), branch: short(pr.head?.ref, 200), commitSha: short(pr.head?.sha, 100), occurredAt: date(pr.updated_at) };
    }
    if (eventType === 'issues' && payload.issue) {
      const issue = payload.issue;
      return { action: short(payload.action, 80), number: Number.isInteger(issue.number) ? issue.number : null, title: short(issue.title, 300), url: short(issue.html_url, 1000), summary: short(issue.body), branch: null, commitSha: null, occurredAt: date(issue.updated_at) };
    }
    if (eventType === 'push') {
      const commits = Array.isArray(payload.commits) ? payload.commits.slice(-5) : [];
      const message = commits.map((commit: JsonRecord) => short(commit.message, 300)).filter(Boolean).join('\n');
      return { action: 'push', number: null, title: short(payload.head_commit?.message, 300) ?? 'Repository update', url: short(payload.compare, 1000), summary: message || null, branch: short(payload.ref, 200)?.replace(/^refs\/heads\//, '') ?? null, commitSha: short(payload.after, 100), occurredAt: date(payload.head_commit?.timestamp) };
    }
    return null;
  }
}
