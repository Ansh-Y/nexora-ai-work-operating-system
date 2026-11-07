import { Injectable } from '@nestjs/common';
import { Principal } from '../common/auth.types';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GmailIntelligenceService } from './gmail-intelligence.service';
import { GoogleSyncService } from './google-sync.service';
import {
  AssociateCalendarEventDto,
  GoogleCalendarQueryDto,
  ProposeTaskFromEmailDto,
  SyncGmailDto,
  SyncGoogleCalendarDto,
} from './google.dto';

@Injectable()
export class GoogleService {
  constructor(
    private oauth: GoogleOAuthService,
    private calendar: GoogleCalendarService,
    private gmail: GmailIntelligenceService,
    private sync: GoogleSyncService,
  ) {}

  status(user: Principal) {
    return this.oauth.status(user);
  }

  beginConnection(user: Principal) {
    return this.oauth.beginConnection(user);
  }

  handleCallback(code: string, state: string) {
    return this.oauth.handleCallback(code, state);
  }

  disconnect(user: Principal) {
    return this.oauth.disconnect(user);
  }

  syncCalendar(user: Principal, dto?: SyncGoogleCalendarDto) {
    return this.calendar.syncCalendar(user, user.orgId, dto?.force ?? false);
  }

  getCalendarEvents(user: Principal, query: GoogleCalendarQueryDto) {
    return this.calendar.getEvents(user, query);
  }

  associateCalendarEvent(user: Principal, eventId: string, dto: AssociateCalendarEventDto) {
    return this.calendar.associateEventWithProject(user, eventId, dto);
  }

  getCalendarSuggestions(user: Principal) {
    return this.calendar.getSuggestedAssociations(user);
  }

  dismissCalendarSuggestion(user: Principal, eventId: string) {
    return this.calendar.dismissSuggestion(user, eventId);
  }

  syncGmail(user: Principal, dto?: SyncGmailDto) {
    return this.gmail.syncRecentEmails(user, user.orgId, dto?.maxMessages ?? 20);
  }

  getGmailMessages(user: Principal, projectId?: string) {
    return this.gmail.getMessages(user, projectId);
  }

  proposeTaskFromEmail(user: Principal, messageId: string, dto?: ProposeTaskFromEmailDto) {
    return this.gmail.proposeTaskFromEmail(user, messageId, dto?.projectId);
  }
}
