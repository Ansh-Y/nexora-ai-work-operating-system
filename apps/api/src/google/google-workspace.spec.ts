import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OrganizationRole, Priority } from '@prisma/client';
import { Principal } from '../common/auth.types';
import {
  decryptGoogleSecret,
  encryptGoogleSecret,
  GOOGLE_OAUTH_SCOPES,
  hashGoogleOAuthState,
  newGoogleOAuthState,
} from './google-security';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GmailIntelligenceService } from './gmail-intelligence.service';

const testKey = randomBytes(32).toString('hex');

const mockUser: Principal = {
  sub: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  role: OrganizationRole.ADMIN,
  name: 'Admin User',
  email: 'admin@nexora.internal',
};

const mockMemberUser: Principal = {
  sub: '33333333-3333-3333-3333-333333333333',
  orgId: '22222222-2222-2222-2222-222222222222',
  role: OrganizationRole.TEAM_MEMBER,
  name: 'Member User',
  email: 'member@nexora.internal',
};

const mockTenant2User: Principal = {
  sub: '44444444-4444-4444-4444-444444444444',
  orgId: '55555555-5555-5555-5555-555555555555',
  role: OrganizationRole.ADMIN,
  name: 'Tenant 2 Admin',
  email: 'admin@otherorg.internal',
};

describe('Google Workspace Integration & Security', () => {
  describe('Security & Encryption Helpers', () => {
    it('encrypts secrets using AES-256-GCM and successfully decrypts with valid key', () => {
      const plaintext = 'ya29.a0AfH6SMD_google_access_token';
      const ciphertext = encryptGoogleSecret(plaintext, testKey);

      expect(ciphertext).not.toContain(plaintext);
      expect(ciphertext.startsWith('v1.')).toBe(true);

      const decrypted = decryptGoogleSecret(ciphertext, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it('rejects tampered ciphertexts and invalid auth tags', () => {
      const plaintext = '1//04_refresh_token';
      const ciphertext = encryptGoogleSecret(plaintext, testKey);
      const parts = ciphertext.split('.');

      // Alter ciphertext payload
      const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.badpayload`;
      expect(() => decryptGoogleSecret(tampered, testKey)).toThrow();

      // Alter auth tag
      const badTag = `${parts[0]}.${parts[1]}.${randomBytes(16).toString('base64url')}.${parts[3]}`;
      expect(() => decryptGoogleSecret(badTag, testKey)).toThrow();
    });

    it('generates high-entropy OAuth state strings and deterministic SHA-256 hashes', () => {
      const state1 = newGoogleOAuthState();
      const state2 = newGoogleOAuthState();

      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThanOrEqual(40);

      const hash1 = hashGoogleOAuthState(state1);
      const hash2 = hashGoogleOAuthState(state1);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashGoogleOAuthState(state2));
    });
  });

  describe('Google OAuth 2.0 Service', () => {
    let oauthService: GoogleOAuthService;
    let mockPrisma: any;
    let mockConfig: any;
    let mockAudit: any;
    let mockRealtime: any;

    beforeEach(() => {
      mockPrisma = {
        googleOAuthState: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn(),
          findUnique: vi.fn(),
        },
        googleConnection: {
          findUnique: vi.fn(),
          upsert: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
          delete: vi.fn(),
        },
        membership: {
          findUnique: vi.fn(),
        },
        auditEvent: {
          create: vi.fn(),
        },
        $transaction: vi.fn(callback => callback(mockPrisma)),
      };

      mockConfig = {
        get: vi.fn((key: string) => {
          if (key === 'GOOGLE_CLIENT_ID') return 'google-client-id-123';
          if (key === 'GOOGLE_CLIENT_SECRET') return 'google-client-secret-xyz';
          if (key === 'GOOGLE_CALLBACK_URL') return 'http://localhost:4000/api/integrations/google/callback';
          if (key === 'GOOGLE_TOKEN_ENCRYPTION_KEY') return testKey;
          return null;
        }),
      };

      mockAudit = {
        append: vi.fn().mockResolvedValue({}),
      };

      mockRealtime = {
        broadcast: vi.fn(),
      };

      oauthService = new GoogleOAuthService(mockPrisma, mockConfig, mockAudit, mockRealtime);
    });

    it('enforces RBAC: non-manager cannot initiate OAuth or disconnect', async () => {
      await expect(oauthService.beginConnection(mockMemberUser)).rejects.toThrow(ForbiddenException);
      await expect(oauthService.disconnect(mockMemberUser)).rejects.toThrow(ForbiddenException);
    });

    it('generates valid Google authorization URL with CSRF state and offline consent', async () => {
      const result = await oauthService.beginConnection(mockUser);
      expect(result.authorizationUrl).toBeDefined();

      const parsed = new URL(result.authorizationUrl);
      expect(parsed.origin).toBe('https://accounts.google.com');
      expect(parsed.searchParams.get('client_id')).toBe('google-client-id-123');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/integrations/google/callback');
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('state')).toBeTruthy();
      expect(parsed.searchParams.get('scope')).toContain('calendar.events');
      expect(parsed.searchParams.get('scope')).toContain('gmail.readonly');

      expect(mockPrisma.googleOAuthState.create).toHaveBeenCalled();
    });

    it('rejects callback if OAuth state is invalid or already consumed (single-use CSRF protection)', async () => {
      // Simulate state already consumed
      mockPrisma.googleOAuthState.updateMany.mockResolvedValue({ count: 0 });

      await expect(oauthService.handleCallback('valid-code', 'bad-or-consumed-state')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('handles successful OAuth callback, encrypts tokens, and upserts connection', async () => {
      mockPrisma.googleOAuthState.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.googleOAuthState.findUnique.mockResolvedValue({
        stateHash: 'mock-hash',
        organizationId: mockUser.orgId,
        userId: mockUser.sub,
      });
      mockPrisma.membership.findUnique.mockResolvedValue({
        organizationId: mockUser.orgId,
        userId: mockUser.sub,
        role: OrganizationRole.ADMIN,
      });

      // Mock Google fetch responses
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'new-google-access-token',
              refresh_token: 'new-google-refresh-token',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPES.join(' '),
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-999',
              email: 'lead@nexora.internal',
              verified_email: true,
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      });

      mockPrisma.googleConnection.upsert.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        googleEmail: 'lead@nexora.internal',
        scopes: GOOGLE_OAUTH_SCOPES,
      });

      const orgId = await oauthService.handleCallback('valid-auth-code', 'valid-state');
      expect(orgId).toBe(mockUser.orgId);
      expect(mockPrisma.googleConnection.upsert).toHaveBeenCalled();
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'google.connected',
          targetType: 'google_connection',
        }),
      );

      fetchSpy.mockRestore();
    });

    it('automatically refreshes expiring access tokens using refresh token', async () => {
      const encryptedAccess = encryptGoogleSecret('old-access-token', testKey);
      const encryptedRefresh = encryptGoogleSecret('valid-refresh-token', testKey);

      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        accessTokenCiphertext: encryptedAccess,
        refreshTokenCiphertext: encryptedRefresh,
        tokenExpiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
        status: 'CONNECTED',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-refreshed-access-token',
            expires_in: 3600,
          }),
          { status: 200 },
        );
      });

      const token = await oauthService.getValidAccessToken(mockUser.orgId);
      expect(token).toBe('fresh-refreshed-access-token');
      expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({
            status: 'CONNECTED',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('handles revoked permissions (HTTP 400 invalid_grant) and transitions status to REVOKED', async () => {
      const encryptedAccess = encryptGoogleSecret('old-access-token', testKey);
      const encryptedRefresh = encryptGoogleSecret('revoked-refresh-token', testKey);

      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        accessTokenCiphertext: encryptedAccess,
        refreshTokenCiphertext: encryptedRefresh,
        tokenExpiresAt: new Date(Date.now() - 5000),
        status: 'CONNECTED',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
          { status: 400 },
        );
      });

      await expect(oauthService.getValidAccessToken(mockUser.orgId)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({
            status: 'REVOKED',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('handles upstream revocation endpoint failure gracefully (local disconnect succeeds, audit records not_confirmed)', async () => {
      const encryptedAccess = encryptGoogleSecret('valid-access-token', testKey);
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        googleEmail: 'lead@nexora.internal',
        accessTokenCiphertext: encryptedAccess,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response('Upstream server error', { status: 500 });
      });

      const result = await oauthService.disconnect(mockUser);
      expect(result.disconnected).toBe(true);
      expect(result.remoteRevocation).toBe('not_confirmed');

      // Local connection still deleted
      expect(mockPrisma.googleConnection.delete).toHaveBeenCalledWith({
        where: { organizationId: mockUser.orgId },
      });

      // Audit event records not_confirmed
      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'google.disconnected',
            metadata: expect.objectContaining({
              remoteRevocation: 'not_confirmed',
            }),
          }),
        }),
      );

      fetchSpy.mockRestore();
    });
  });

  describe('Google Calendar Service & Incremental Sync', () => {
    let calendarService: GoogleCalendarService;
    let mockPrisma: any;
    let mockOAuth: any;
    let mockAudit: any;
    let mockRealtime: any;

    beforeEach(() => {
      mockPrisma = {
        googleConnection: {
          findUnique: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
        project: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'proj-1', name: 'Product Launch', description: 'Launch preparations' },
          ]),
          findFirst: vi.fn(),
        },
        googleCalendarEvent: {
          upsert: vi.fn(),
          updateMany: vi.fn(),
          update: vi.fn(),
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        meeting: {
          create: vi.fn(),
        },
        auditEvent: {
          create: vi.fn(),
        },
        $transaction: vi.fn(callback => callback(mockPrisma)),
      };

      mockOAuth = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-access-token'),
      };

      mockAudit = {
        append: vi.fn(),
      };

      mockRealtime = {
        broadcast: vi.fn(),
      };

      calendarService = new GoogleCalendarService(mockPrisma, mockOAuth, mockAudit, mockRealtime);
    });

    it('performs full calendar sync, parses all-day and timed events, and suggests matching projects', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-timed-1',
                summary: 'Product Launch sync with design',
                start: { dateTime: '2026-11-10T10:00:00Z' },
                end: { dateTime: '2026-11-10T11:00:00Z' },
                status: 'confirmed',
                attendees: [{ email: 'engineer@nexora.internal' }],
              },
              {
                id: 'evt-allday-2',
                summary: 'Company Holiday',
                start: { date: '2026-11-20' },
                end: { date: '2026-11-20' },
                status: 'confirmed',
              },
            ],
            nextSyncToken: 'next-sync-token-xyz',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(result.syncedCount).toBe(2);
      expect(result.fullSync).toBe(true);

      // Verify Product Launch project association suggestion
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-timed-1',
            suggestedProjectId: 'proj-1',
            isAllDay: false,
          }),
        }),
      );

      // Verify all-day event
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-allday-2',
            isAllDay: true,
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('handles 410 Gone (expired sync token) by resetting sync token and recovering with full sync', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: 'stale-sync-token-123',
      });

      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        callCount++;
        const urlStr = String(url);
        if (urlStr.includes('syncToken=stale-sync-token-123')) {
          return new Response('Sync token is no longer valid', { status: 410 });
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-recovered-1',
                summary: 'Recovered Team Sync',
                start: { dateTime: '2026-11-12T14:00:00Z' },
                end: { dateTime: '2026-11-12T15:00:00Z' },
                status: 'confirmed',
              },
            ],
            nextSyncToken: 'brand-new-sync-token',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, false);
      expect(result.syncedCount).toBe(1);
      expect(result.fullSync).toBe(true);
      expect(callCount).toBe(2);
      expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            calendarSyncToken: null,
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('associates event with project and creates a tracked meeting when requested', async () => {
      mockPrisma.googleCalendarEvent.findFirst.mockResolvedValue({
        id: 'cal-event-uuid',
        organizationId: mockUser.orgId,
        summary: 'Sprint Review',
        startsAt: new Date('2026-11-15T15:00:00Z'),
        endsAt: new Date('2026-11-15T16:00:00Z'),
      });

      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        name: 'Product Launch',
      });

      mockPrisma.meeting.create.mockResolvedValue({
        id: 'meeting-uuid',
      });

      mockPrisma.googleCalendarEvent.update.mockResolvedValue({
        id: 'cal-event-uuid',
        projectId: 'proj-1',
      });

      await calendarService.associateEventWithProject(mockUser, 'cal-event-uuid', {
        projectId: 'proj-1',
        createMeeting: true,
      });

      expect(mockPrisma.meeting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockUser.orgId,
          projectId: 'proj-1',
          title: 'Sprint Review',
          durationMinutes: 60,
        }),
      });

      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'google.calendar.event_associated',
          metadata: expect.objectContaining({
            projectId: 'proj-1',
            meetingId: 'meeting-uuid',
          }),
        }),
      );
    });

    it('adheres to Google exclusive all-day end dates and preserves date metadata without day shifting', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-single-day',
                summary: 'Quarterly Planning Day',
                start: { date: '2026-11-10' },
                end: { date: '2026-11-11' },
                status: 'confirmed',
              },
              {
                id: 'evt-multi-day',
                summary: 'Design Sprint',
                start: { date: '2026-11-10' },
                end: { date: '2026-11-13' },
                status: 'confirmed',
              },
            ],
            nextSyncToken: 'token-all-day-test',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(result.syncedCount).toBe(2);

      // Verify single-day event: starts at 2026-11-10 00:00:00 UTC and ends at 2026-11-10 23:59:59.999 UTC
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-single-day',
            startsAt: new Date('2026-11-10T00:00:00.000Z'),
            endsAt: new Date('2026-11-10T23:59:59.999Z'),
            isAllDay: true,
            metadata: {
              originalStartDate: '2026-11-10',
              originalEndDate: '2026-11-10',
              timeZone: null,
              isAllDay: true,
            },
          }),
        }),
      );

      // Verify multi-day event: starts at 2026-11-10 00:00:00 UTC and ends at 2026-11-12 23:59:59.999 UTC
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-multi-day',
            startsAt: new Date('2026-11-10T00:00:00.000Z'),
            endsAt: new Date('2026-11-12T23:59:59.999Z'),
            isAllDay: true,
            metadata: {
              originalStartDate: '2026-11-10',
              originalEndDate: '2026-11-12',
              timeZone: null,
              isAllDay: true,
            },
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('correctly parses timed events with positive and negative timezone offsets and preserves timezone in metadata', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-tokyo',
                summary: 'Asia Standup',
                start: { dateTime: '2026-11-10T09:00:00+09:00', timeZone: 'Asia/Tokyo' },
                end: { dateTime: '2026-11-10T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
                status: 'confirmed',
              },
              {
                id: 'evt-sf',
                summary: 'US Pacific Review',
                start: { dateTime: '2026-11-10T16:00:00-08:00', timeZone: 'America/Los_Angeles' },
                end: { dateTime: '2026-11-10T17:00:00-08:00', timeZone: 'America/Los_Angeles' },
                status: 'confirmed',
              },
            ],
            nextSyncToken: 'token-tz-test',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(result.syncedCount).toBe(2);

      // Tokyo +09:00 (09:00 Tokyo -> 00:00 UTC)
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-tokyo',
            startsAt: new Date('2026-11-10T00:00:00.000Z'),
            endsAt: new Date('2026-11-10T01:00:00.000Z'),
            isAllDay: false,
            metadata: {
              originalStartDate: null,
              originalEndDate: null,
              timeZone: 'Asia/Tokyo',
              isAllDay: false,
            },
          }),
        }),
      );

      // SF -08:00 (16:00 SF on Nov 10 -> 00:00 UTC on Nov 11)
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-sf',
            startsAt: new Date('2026-11-11T00:00:00.000Z'),
            endsAt: new Date('2026-11-11T01:00:00.000Z'),
            isAllDay: false,
            metadata: {
              originalStartDate: null,
              originalEndDate: null,
              timeZone: 'America/Los_Angeles',
              isAllDay: false,
            },
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('handles events spanning daylight saving time boundaries with correct UTC offsets', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'evt-dst-transition',
                summary: 'US DST Fall-Back Meeting',
                start: { dateTime: '2026-11-01T01:30:00-04:00', timeZone: 'America/New_York' },
                end: { dateTime: '2026-11-01T02:30:00-05:00', timeZone: 'America/New_York' },
                status: 'confirmed',
              },
            ],
            nextSyncToken: 'token-dst-test',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(result.syncedCount).toBe(1);

      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            googleEventId: 'evt-dst-transition',
            startsAt: new Date('2026-11-01T05:30:00.000Z'),
            endsAt: new Date('2026-11-01T07:30:00.000Z'),
            metadata: {
              originalStartDate: null,
              originalEndDate: null,
              timeZone: 'America/New_York',
              isAllDay: false,
            },
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('fetches all pages via pageToken and only commits nextSyncToken after final page succeeds', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: 'sync-tok-123',
      });

      const urlsRequested: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        urlsRequested.push(u);
        if (u.includes('pageToken=token-page-2')) {
          return new Response(
            JSON.stringify({
              items: [
                { id: 'evt-page-2', summary: 'Page 2 Event', start: { dateTime: '2026-11-15T10:00:00Z' } },
              ],
              nextSyncToken: 'final-sync-token-from-page-2',
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              { id: 'evt-page-1a', summary: 'Page 1 Event A', start: { dateTime: '2026-11-14T09:00:00Z' } },
              { id: 'evt-page-1b', summary: 'Page 1 Event B', start: { dateTime: '2026-11-14T11:00:00Z' } },
            ],
            nextPageToken: 'token-page-2',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, false);
      expect(result.syncedCount).toBe(3);
      expect(urlsRequested).toHaveLength(2);

      // Verify page 1 had syncToken
      expect(urlsRequested[0]).toContain('syncToken=sync-tok-123');
      expect(urlsRequested[0]).not.toContain('pageToken=');

      // Verify page 2 had pageToken and DID NOT pass syncToken (Google API parameter mutual exclusion)
      expect(urlsRequested[1]).toContain('pageToken=token-page-2');
      expect(urlsRequested[1]).not.toContain('syncToken=');

      // Verify final sync token committed
      expect(mockPrisma.googleConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            calendarSyncToken: 'final-sync-token-from-page-2',
            calendarSyncStatus: 'SUCCESS',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('does not advance calendarSyncToken if a subsequent page fails', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: 'original-saved-token',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes('pageToken=token-page-2')) {
          return new Response('Internal Google Server Error', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            items: [
              { id: 'evt-page-1', summary: 'First Page Event', start: { dateTime: '2026-11-14T09:00:00Z' } },
            ],
            nextPageToken: 'token-page-2',
          }),
          { status: 200 },
        );
      });

      await expect(calendarService.syncCalendar(mockUser, mockUser.orgId, false)).rejects.toThrow();

      // Transaction was NOT committed: calendarSyncStatus SUCCESS was never written
      expect(mockPrisma.googleConnection.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            calendarSyncStatus: 'SUCCESS',
          }),
        }),
      );

      // Failure recorded
      expect(mockPrisma.googleConnection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            calendarSyncStatus: 'FAILED',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('idempotently updates events without duplication on sync retry', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: 'original-token',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'evt-existing', summary: 'Updated Title', start: { dateTime: '2026-11-15T10:00:00Z' } },
            ],
            nextSyncToken: 'successful-retry-sync-token',
          }),
          { status: 200 },
        );
      });

      const result = await calendarService.syncCalendar(mockUser, mockUser.orgId, false);
      expect(result.syncedCount).toBe(1);

      // Upsert ensures idempotency by targeting unique constraint [organizationId, googleEventId]
      expect(mockPrisma.googleCalendarEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_googleEventId: {
              organizationId: mockUser.orgId,
              googleEventId: 'evt-existing',
            },
          },
          create: expect.objectContaining({ summary: 'Updated Title' }),
          update: expect.objectContaining({ summary: 'Updated Title' }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('skips concurrent duplicate sync jobs for the same organization', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      let resolveFetch!: (res: Response) => void;
      const fetchPromise = new Promise<Response>(resolve => {
        resolveFetch = resolve;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return fetchPromise;
      });

      // Start first sync (runs asynchronously)
      const firstSyncPromise = calendarService.syncCalendar(mockUser, mockUser.orgId, true);

      // Trigger concurrent second sync immediately
      const secondSyncResult = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(secondSyncResult.syncedCount).toBe(0);
      expect(secondSyncResult.message).toContain('already in progress');

      // Complete first sync
      resolveFetch(
        new Response(
          JSON.stringify({
            items: [{ id: 'evt-1', summary: 'First Event', start: { dateTime: '2026-11-16T10:00:00Z' } }],
            nextSyncToken: 'token-after-lock',
          }),
          { status: 200 },
        ),
      );

      const firstSyncResult = await firstSyncPromise;
      expect(firstSyncResult.syncedCount).toBe(1);

      fetchSpy.mockRestore();
    });

    it('always releases the concurrency lock when a sync throws an error', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
        calendarSyncToken: null,
      });

      let syncRuns = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        if (syncRuns === 0) {
          return new Response('Fatal Google Calendar Error', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            items: [{ id: 'evt-ok', summary: 'Recovered Event', start: { dateTime: '2026-11-17T10:00:00Z' } }],
            nextSyncToken: 'token-after-exception',
          }),
          { status: 200 },
        );
      });

      // First call throws ServiceUnavailableException
      await expect(calendarService.syncCalendar(mockUser, mockUser.orgId, true)).rejects.toThrow();

      // Second call must NOT be blocked by stale lock
      syncRuns = 1;
      const secondResult = await calendarService.syncCalendar(mockUser, mockUser.orgId, true);
      expect(secondResult.syncedCount).toBe(1);

      fetchSpy.mockRestore();
    });
  });

  describe('Gmail Intelligence & Task Proposals', () => {
    let gmailService: GmailIntelligenceService;
    let mockPrisma: any;
    let mockOAuth: any;
    let mockConfig: any;
    let mockAudit: any;
    let mockRealtime: any;

    beforeEach(() => {
      mockPrisma = {
        googleConnection: {
          findUnique: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
        project: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'proj-1', name: 'Alpha Redesign', description: 'Web app overhaul' },
          ]),
          findFirst: vi.fn(),
        },
        gmailMessage: {
          upsert: vi.fn(),
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        aiProposal: {
          create: vi.fn(),
        },
        auditEvent: {
          create: vi.fn(),
        },
        $transaction: vi.fn(callback => callback(mockPrisma)),
      };

      mockOAuth = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-access-token'),
      };

      mockConfig = {
        get: vi.fn((key: string) => {
          if (key === 'OPENAI_API_KEY') return null; // heuristic mode
          return null;
        }),
      };

      mockAudit = {
        append: vi.fn(),
      };

      mockRealtime = {
        broadcast: vi.fn(),
      };

      gmailService = new GmailIntelligenceService(mockPrisma, mockOAuth, mockConfig, mockAudit, mockRealtime);
    });

    it('synchronizes recent email headers and snippet without leaking full plaintext bodies', async () => {
      mockPrisma.googleConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        organizationId: mockUser.orgId,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/messages?')) {
          return new Response(
            JSON.stringify({
              messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes('msg-1')) {
          return new Response(
            JSON.stringify({
              id: 'msg-1',
              snippet: 'Please complete the Alpha Redesign mockups by Thursday.',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Alpha Redesign Mockup Update' },
                  { name: 'From', value: 'client@partner.com' },
                  { name: 'Date', value: 'Tue, 07 Nov 2026 12:00:00 GMT' },
                ],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            id: 'msg-2',
            snippet: 'Quarterly all-hands announcement',
            payload: {
              headers: [
                { name: 'Subject', value: 'All Hands Meeting' },
                { name: 'From', value: 'hr@nexora.internal' },
              ],
            },
          }),
          { status: 200 },
        );
      });

      const result = await gmailService.syncRecentEmails(mockUser, mockUser.orgId, 10);
      expect(result.syncedCount).toBe(2);

      // Verify Alpha Redesign was detected
      expect(mockPrisma.gmailMessage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            gmailMessageId: 'msg-1',
            subject: 'Alpha Redesign Mockup Update',
            suggestedProjectId: 'proj-1',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('proposes task from email as a human-in-the-loop AiProposal', async () => {
      mockPrisma.gmailMessage.findFirst.mockResolvedValue({
        id: 'msg-uuid-1',
        gmailMessageId: 'google-msg-1',
        organizationId: mockUser.orgId,
        subject: 'Alpha Redesign: Final signoff needed ASAP',
        from: 'client@partner.com',
        snippet: 'We need the final signoff on mockups urgently.',
        date: new Date('2026-11-07T12:00:00Z'),
        projectId: 'proj-1',
      });

      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        name: 'Alpha Redesign',
      });

      mockPrisma.aiProposal.create.mockImplementation((args: any) => ({
        id: 'proposal-uuid',
        ...args.data,
        status: 'PENDING',
      }));

      const proposal = await gmailService.proposeTaskFromEmail(mockUser, 'msg-uuid-1', 'proj-1');
      expect(proposal.proposalId).toBe('proposal-uuid');
      expect(proposal.status).toBe('PENDING');
      expect(proposal.proposedTask.priority).toBe(Priority.HIGH); // urgent detected
      expect(proposal.proposedTask.title).toContain('Follow up: Alpha Redesign');

      expect(mockPrisma.aiProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockUser.orgId,
          creatorId: mockUser.sub,
          kind: 'PROJECT_PLAN',
        }),
      });
    });
  });

  describe('Tenant Isolation Verification', () => {
    it('prevents cross-tenant access to calendar events and Gmail messages', async () => {
      const mockPrisma = {
        googleCalendarEvent: {
          findFirst: vi.fn().mockResolvedValue(null), // Tenant 2 querying Tenant 1 event returns null
        },
        gmailMessage: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const calendarService = new GoogleCalendarService(mockPrisma as any, {} as any, {} as any, {} as any);
      const gmailService = new GmailIntelligenceService(mockPrisma as any, {} as any, {} as any, {} as any, {} as any);

      await expect(
        calendarService.associateEventWithProject(mockTenant2User, 'tenant-1-event-id', {
          projectId: 'some-project',
        }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        gmailService.proposeTaskFromEmail(mockTenant2User, 'tenant-1-message-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
