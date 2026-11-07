import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Principal } from '../common/auth.types';
import {
  decryptGoogleSecret,
  encryptGoogleSecret,
  GOOGLE_OAUTH_SCOPES,
  hashGoogleOAuthState,
  newGoogleOAuthState,
} from './google-security';

const MANAGERS: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN];

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private realtime: RealtimeGateway,
  ) {}

  private assertManager(user: Principal) {
    if (!MANAGERS.includes(user.role)) {
      throw new ForbiddenException('Workspace owners or admins must manage Google Workspace integration settings');
    }
  }

  private encryptionKey(): string | undefined {
    return this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY') || this.config.get<string>('GITHUB_TOKEN_ENCRYPTION_KEY');
  }

  oauthConfig() {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL');

    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Google Workspace.');
    }
    if (!callbackUrl) {
      throw new ServiceUnavailableException('Configure GOOGLE_CALLBACK_URL to connect Google Workspace.');
    }

    try {
      new URL(callbackUrl);
    } catch {
      throw new ServiceUnavailableException('GOOGLE_CALLBACK_URL must be a valid URL.');
    }

    const hostname = new URL(callbackUrl).hostname;
    if (!callbackUrl.startsWith('https://') && !['localhost', '127.0.0.1'].includes(hostname)) {
      throw new ServiceUnavailableException('GOOGLE_CALLBACK_URL must use HTTPS outside local development.');
    }

    return { clientId, clientSecret, callbackUrl };
  }

  async status(user: Principal) {
    const key = this.encryptionKey();
    const encryptionReady = Boolean(key && /^[\da-f]{64}$/i.test(key));
    const configured = Boolean(
      this.config.get('GOOGLE_CLIENT_ID') &&
      this.config.get('GOOGLE_CLIENT_SECRET') &&
      this.config.get('GOOGLE_CALLBACK_URL'),
    );

    const connection = await this.prisma.googleConnection.findUnique({
      where: { organizationId: user.orgId },
      include: {
        _count: {
          select: {
            calendarEvents: true,
            gmailMessages: true,
          },
        },
      },
    });

    return {
      configured,
      encryptionReady,
      connected: Boolean(connection && connection.status !== 'REVOKED'),
      connection: connection
        ? {
            id: connection.id,
            googleEmail: connection.googleEmail,
            scopes: connection.scopes,
            status: connection.status,
            lastCalendarSyncAt: connection.lastCalendarSyncAt,
            calendarSyncStatus: connection.calendarSyncStatus,
            calendarSyncError: connection.calendarSyncError,
            lastGmailSyncAt: connection.lastGmailSyncAt,
            gmailSyncStatus: connection.gmailSyncStatus,
            gmailSyncError: connection.gmailSyncError,
            syncedCalendarEventsCount: connection._count.calendarEvents,
            syncedGmailMessagesCount: connection._count.gmailMessages,
            createdAt: connection.createdAt,
          }
        : null,
    };
  }

  async beginConnection(user: Principal) {
    this.assertManager(user);
    const { clientId, callbackUrl } = this.oauthConfig();
    const key = this.encryptionKey();
    if (!key || !/^[\da-f]{64}$/i.test(key)) {
      throw new ServiceUnavailableException(
        'Configure GOOGLE_TOKEN_ENCRYPTION_KEY or GITHUB_TOKEN_ENCRYPTION_KEY as 64 hexadecimal characters before connecting Google Workspace.',
      );
    }

    const state = newGoogleOAuthState();
    const stateHash = hashGoogleOAuthState(state);

    // Prune stale or expired states
    await this.prisma.googleOAuthState.deleteMany({
      where: {
        organizationId: user.orgId,
        OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
      },
    });

    // 10 minutes expiry window for OAuth state
    await this.prisma.googleOAuthState.create({
      data: {
        stateHash,
        organizationId: user.orgId,
        userId: user.sub,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return { authorizationUrl: url.toString() };
  }

  async handleCallback(code: string, state: string) {
    if (!code || code.length > 2000 || !state || state.length > 200) {
      throw new BadRequestException('Google returned an invalid OAuth response.');
    }

    const { clientId, clientSecret, callbackUrl } = this.oauthConfig();
    const now = new Date();
    const stateHash = hashGoogleOAuthState(state);

    // Atomic claim of state token
    const claim = await this.prisma.googleOAuthState.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    if (!claim.count) {
      throw new UnauthorizedException('Google authorization state is invalid, expired, or already used.');
    }

    const stateRow = await this.prisma.googleOAuthState.findUnique({
      where: { stateHash },
    });

    if (!stateRow) {
      throw new UnauthorizedException('Google authorization state verification failed.');
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: stateRow.organizationId,
          userId: stateRow.userId,
        },
      },
    });

    if (!membership || !MANAGERS.includes(membership.role)) {
      throw new UnauthorizedException('Workspace membership or management role changed during Google authorization.');
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text().catch(() => '');
      this.logger.error(`Google token exchange failed: HTTP ${tokenResponse.status} ${errBody}`);
      throw new BadRequestException('Google could not exchange the authorization code. Please try again.');
    }

    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      throw new BadRequestException('Google returned an invalid access token response.');
    }

    // Fetch user profile info
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!profileResponse.ok) {
      throw new BadRequestException('Google could not verify the connected account profile.');
    }

    const profile = (await profileResponse.json()) as {
      id?: string;
      email?: string;
      verified_email?: boolean;
    };

    if (!profile.id || !profile.email) {
      throw new BadRequestException('Google returned an incomplete profile.');
    }

    const key = this.encryptionKey();
    const accessTokenCiphertext = encryptGoogleSecret(tokenBody.access_token, key);
    const refreshTokenCiphertext = tokenBody.refresh_token
      ? encryptGoogleSecret(tokenBody.refresh_token, key)
      : undefined;

    const tokenExpiresAt = new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000);
    const scopes = typeof tokenBody.scope === 'string'
      ? tokenBody.scope.split(' ').map(s => s.trim()).filter(Boolean)
      : GOOGLE_OAUTH_SCOPES;

    // Preserve existing refresh token if Google didn't reissue one on reconnect
    let finalRefreshTokenCiphertext = refreshTokenCiphertext;
    if (!finalRefreshTokenCiphertext) {
      const existing = await this.prisma.googleConnection.findUnique({
        where: { organizationId: stateRow.organizationId },
        select: { refreshTokenCiphertext: true },
      });
      if (existing?.refreshTokenCiphertext) {
        finalRefreshTokenCiphertext = existing.refreshTokenCiphertext;
      }
    }

    const connection = await this.prisma.googleConnection.upsert({
      where: { organizationId: stateRow.organizationId },
      create: {
        organizationId: stateRow.organizationId,
        connectedById: stateRow.userId,
        googleUserId: profile.id,
        googleEmail: profile.email.toLowerCase(),
        accessTokenCiphertext,
        refreshTokenCiphertext: finalRefreshTokenCiphertext,
        tokenExpiresAt,
        scopes,
        status: 'CONNECTED',
      },
      update: {
        connectedById: stateRow.userId,
        googleUserId: profile.id,
        googleEmail: profile.email.toLowerCase(),
        accessTokenCiphertext,
        ...(finalRefreshTokenCiphertext ? { refreshTokenCiphertext: finalRefreshTokenCiphertext } : {}),
        tokenExpiresAt,
        scopes,
        status: 'CONNECTED',
      },
    });

    await this.audit.append({
      organizationId: stateRow.organizationId,
      actorType: 'USER',
      actorId: stateRow.userId,
      action: 'google.connected',
      targetType: 'google_connection',
      targetId: connection.id,
      metadata: {
        googleEmail: connection.googleEmail,
        scopes: connection.scopes,
      },
    });

    this.realtime.broadcast(stateRow.organizationId, 'google.connection.updated', {
      connected: true,
      email: connection.googleEmail,
    });

    return stateRow.organizationId;
  }

  async disconnect(user: Principal) {
    this.assertManager(user);
    const stored = await this.prisma.googleConnection.findUnique({
      where: { organizationId: user.orgId },
    });

    if (!stored) {
      return { disconnected: true, remoteRevocation: 'not_confirmed' as const };
    }

    let remoteRevocation = false;
    try {
      const key = this.encryptionKey();
      const accessToken = decryptGoogleSecret(stored.accessTokenCiphertext, key);
      const revokeResp = await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
      remoteRevocation = revokeResp.ok;
    } catch {
      // Local removal proceeds regardless of upstream revoke failure
    }

    const revocationStatus = remoteRevocation ? 'revoked' : 'not_confirmed';

    await this.prisma.$transaction(async tx => {
      await tx.googleConnection.delete({
        where: { organizationId: user.orgId },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: user.orgId,
          actorType: 'USER',
          actorId: user.sub,
          action: 'google.disconnected',
          targetType: 'google_connection',
          targetId: stored.id,
          metadata: {
            googleEmail: stored.googleEmail,
            remoteRevocation: revocationStatus,
          },
        },
      });
    });

    this.realtime.broadcast(user.orgId, 'google.connection.updated', {
      connected: false,
    });

    return { disconnected: true, remoteRevocation: revocationStatus };
  }

  async getValidAccessToken(organizationId: string): Promise<string> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { organizationId },
    });

    if (!connection) {
      throw new NotFoundException('Google Workspace is not connected for this organization.');
    }

    if (connection.status === 'REVOKED') {
      throw new UnauthorizedException('Google permissions were revoked. Please reconnect your account.');
    }

    const key = this.encryptionKey();
    const now = new Date();
    const isExpiring = !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() - now.getTime() < 60_000;

    if (!isExpiring) {
      return decryptGoogleSecret(connection.accessTokenCiphertext, key);
    }

    // Refresh access token using refresh token
    if (!connection.refreshTokenCiphertext) {
      await this.prisma.googleConnection.update({
        where: { id: connection.id },
        data: { status: 'NEEDS_REAUTH' },
      });
      throw new UnauthorizedException('Google refresh token is missing. Please reconnect your account.');
    }

    const refreshToken = decryptGoogleSecret(connection.refreshTokenCiphertext, key);
    const { clientId, clientSecret } = this.oauthConfig();

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const statusText = await response.text().catch(() => '');
      this.logger.warn(`Google token refresh failed: HTTP ${response.status} ${statusText}`);

      if (response.status === 400 || response.status === 401) {
        await this.prisma.$transaction(async tx => {
          await tx.googleConnection.update({
            where: { id: connection.id },
            data: { status: 'REVOKED', calendarSyncError: 'Token refresh rejected by Google' },
          });
          await tx.auditEvent.create({
            data: {
              organizationId,
              actorType: 'SYSTEM',
              action: 'google.token.revoked',
              targetType: 'google_connection',
              targetId: connection.id,
              metadata: { reason: 'invalid_grant' },
            },
          });
        });
        throw new UnauthorizedException('Google authorization was revoked or expired. Please reconnect your account.');
      }
      throw new ServiceUnavailableException('Failed to refresh Google access token. Please retry.');
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
      refresh_token?: string;
    };

    if (!body.access_token) {
      throw new ServiceUnavailableException('Google did not return a valid refreshed access token.');
    }

    const newAccessTokenCiphertext = encryptGoogleSecret(body.access_token, key);
    const newExpiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
    const newRefreshTokenCiphertext = body.refresh_token
      ? encryptGoogleSecret(body.refresh_token, key)
      : connection.refreshTokenCiphertext;

    await this.prisma.googleConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenCiphertext: newAccessTokenCiphertext,
        refreshTokenCiphertext: newRefreshTokenCiphertext,
        tokenExpiresAt: newExpiresAt,
        status: 'CONNECTED',
      },
    });

    return body.access_token;
  }
}
