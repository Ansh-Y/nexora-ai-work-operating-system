import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { GitHubService } from './github.service';
import { LinkGitHubRepositoryDto } from './github.dto';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('GitHub')
@Controller('integrations/github')
export class GitHubController {
  constructor(private service: GitHubService) {}

  @UseGuards(AuthGuard) @ApiBearerAuth() @Get()
  status(@CurrentUser() user: Principal) { return this.service.status(user); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Post('connect')
  connect(@CurrentUser() user: Principal) { return this.service.beginConnection(user); }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() response: Response) {
    try {
      if (code && state) await this.service.callback(code, state);
      const target = new URL('/', process.env.WEB_ORIGIN || 'http://localhost:3000');
      target.searchParams.set('github', code && state ? 'connected' : 'cancelled');
      return response.redirect(302, target.toString());
    } catch {
      const target = new URL('/', process.env.WEB_ORIGIN || 'http://localhost:3000');
      target.searchParams.set('github', 'error');
      return response.redirect(302, target.toString());
    }
  }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Post('disconnect')
  disconnect(@CurrentUser() user: Principal) { return this.service.disconnect(user); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Get('repositories/available')
  availableRepositories(@CurrentUser() user: Principal) { return this.service.availableRepositories(user); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Post('repositories')
  linkRepository(@CurrentUser() user: Principal, @Body() dto: LinkGitHubRepositoryDto) { return this.service.linkRepository(user, dto); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Delete('repositories/:id')
  unlinkRepository(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.service.unlinkRepository(user, id); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Post('repositories/:id/webhook')
  configureWebhook(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.service.configureWebhook(user, id); }

  @UseGuards(AuthGuard) @ApiBearerAuth() @Get('events')
  events(@CurrentUser() user: Principal) { return this.service.events(user); }

  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest,
    @Headers('x-github-event') event: string,
    @Headers('x-github-delivery') delivery: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: Record<string, any>,
  ) {
    if (!request.rawBody) throw new Error('Raw webhook body is unavailable; configure rawBody support.');
    return this.service.handleWebhook({ event, delivery, signature }, request.rawBody, body);
  }
}
