import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GitHubController } from './github.controller';
import { GitHubService } from './github.service';

@Module({ imports: [AuthModule, RealtimeModule], controllers: [GitHubController], providers: [GitHubService], exports: [GitHubService] })
export class GitHubModule {}
