import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({ imports: [AuthModule, AuditModule, RealtimeModule], controllers: [ProjectsController, MilestonesController], providers: [ProjectsService, MilestonesService] })
export class ProjectsModule {}
