import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { GoogleService } from './google.service';
import {
  AssociateCalendarEventDto,
  GoogleCalendarQueryDto,
  ProposeTaskFromEmailDto,
  SyncGmailDto,
  SyncGoogleCalendarDto,
} from './google.dto';

@ApiTags('Google Workspace')
@Controller('integrations/google')
export class GoogleController {
  constructor(private service: GoogleService) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('status')
  status(@CurrentUser() user: Principal) {
    return this.service.status(user);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('connect')
  connect(@CurrentUser() user: Principal) {
    return this.service.beginConnection(user);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() response: Response,
  ) {
    try {
      if (code && state) {
        await this.service.handleCallback(code, state);
      }
      const target = new URL('/', process.env.WEB_ORIGIN || 'http://localhost:3000');
      target.searchParams.set('google', code && state ? 'connected' : 'cancelled');
      return response.redirect(302, target.toString());
    } catch {
      const target = new URL('/', process.env.WEB_ORIGIN || 'http://localhost:3000');
      target.searchParams.set('google', 'error');
      return response.redirect(302, target.toString());
    }
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('disconnect')
  disconnect(@CurrentUser() user: Principal) {
    return this.service.disconnect(user);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('calendar/sync')
  syncCalendar(@CurrentUser() user: Principal, @Body() dto: SyncGoogleCalendarDto) {
    return this.service.syncCalendar(user, dto);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('calendar/events')
  getCalendarEvents(@CurrentUser() user: Principal, @Query() query: GoogleCalendarQueryDto) {
    return this.service.getCalendarEvents(user, query);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('calendar/suggestions')
  getCalendarSuggestions(@CurrentUser() user: Principal) {
    return this.service.getCalendarSuggestions(user);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('calendar/events/:id/associate')
  associateCalendarEvent(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssociateCalendarEventDto,
  ) {
    return this.service.associateCalendarEvent(user, id, dto);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Delete('calendar/events/:id/suggestion')
  dismissCalendarSuggestion(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.dismissCalendarSuggestion(user, id);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('gmail/sync')
  syncGmail(@CurrentUser() user: Principal, @Body() dto: SyncGmailDto) {
    return this.service.syncGmail(user, dto);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('gmail/messages')
  getGmailMessages(
    @CurrentUser() user: Principal,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.getGmailMessages(user, projectId);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('gmail/messages/:id/propose-task')
  proposeTaskFromEmail(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeTaskFromEmailDto,
  ) {
    return this.service.proposeTaskFromEmail(user, id, dto);
  }
}
