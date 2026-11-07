import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { CalendarQueryDto } from './calendar.dto';
import { CalendarService } from './calendar.service';

@ApiTags('Calendar') @ApiBearerAuth() @Controller('calendar') @UseGuards(AuthGuard)
export class CalendarController {
  constructor(private service: CalendarService) {}
  @Get('events') events(@CurrentUser() user: Principal, @Query() query: CalendarQueryDto) { return this.service.events(user, query); }
}
