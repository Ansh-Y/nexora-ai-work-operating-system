import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { TasksModule } from '../tasks/tasks.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SearchModule } from '../search/search.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({ imports: [AuthModule, AuditModule, TasksModule, RealtimeModule, SearchModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
