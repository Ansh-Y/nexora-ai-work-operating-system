import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { TasksModule } from '../tasks/tasks.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SearchModule } from '../search/search.module';
import { ProjectHealthModule } from '../project-health/project-health.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { WorkflowAutomationController } from './workflow-automation.controller';
import { WorkflowAutomationService } from './workflow-automation.service';
import { WeeklyReportsController } from './weekly-reports.controller';
import { WeeklyReportsService } from './weekly-reports.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    forwardRef(() => TasksModule),
    RealtimeModule,
    SearchModule,
    ProjectHealthModule,
    NotificationsModule,
  ],
  controllers: [AiController, WorkflowAutomationController, WeeklyReportsController],
  providers: [AiService, WorkflowAutomationService, WeeklyReportsService],
  exports: [AiService, WorkflowAutomationService, WeeklyReportsService],
})
export class AiModule {}

