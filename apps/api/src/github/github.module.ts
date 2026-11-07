import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GitHubController } from './github.controller';
import { GitHubService } from './github.service';

@Module({ imports: [AuthModule], controllers: [GitHubController], providers: [GitHubService] })
export class GitHubModule {}
