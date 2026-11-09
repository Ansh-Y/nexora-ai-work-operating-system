import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectHealthController } from './project-health.controller';
import { ProjectHealthService } from './project-health.service';
import { ProjectHealthQueueService } from './project-health-queue.service';

@Module({
  imports: [PrismaModule, AuditModule, RealtimeModule, AuthModule, NotificationsModule],
  controllers: [ProjectHealthController],
  providers: [ProjectHealthService, ProjectHealthQueueService],
  exports: [ProjectHealthService, ProjectHealthQueueService],
})
export class ProjectHealthModule {}
