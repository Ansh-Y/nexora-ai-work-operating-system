import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GmailIntelligenceService } from './gmail-intelligence.service';
import { GoogleSyncService } from './google-sync.service';

@Module({
  imports: [AuthModule, PrismaModule, AuditModule, RealtimeModule],
  controllers: [GoogleController],
  providers: [
    GoogleOAuthService,
    GoogleCalendarService,
    GmailIntelligenceService,
    GoogleSyncService,
    GoogleService,
  ],
  exports: [GoogleService, GoogleCalendarService, GmailIntelligenceService],
})
export class GoogleModule {}
