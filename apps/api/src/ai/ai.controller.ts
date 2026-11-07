import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { AskDto, PlanDto } from './ai.dto';
import { AiService } from './ai.service';

@ApiTags('AI workspace') @ApiBearerAuth() @Controller('ai') @UseGuards(AuthGuard)
export class AiController {
  constructor(private service: AiService) {}
  @Post('ask') ask(@CurrentUser() user: Principal, @Body() dto: AskDto) { return this.service.ask(user, dto); }
  @Get('intelligence') intelligence(@CurrentUser() user: Principal) { return this.service.intelligence(user); }
  @Post('plan') plan(@CurrentUser() user: Principal, @Body() dto: PlanDto) { return this.service.proposePlan(user, dto); }
  @Post('proposals/:id/approve') approve(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.approve(user, id); }
  @Post('proposals/:id/reject') reject(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.reject(user, id); }
  @Get('projects/:id/blockers') blockers(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.blockers(user, id); }
  @Get('projects/:id/weekly-report') report(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.weeklyReport(user, id); }
  @Get('projects/:id/duplicates') duplicates(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.duplicates(user, id); }
  @Get('proposals') proposals(@CurrentUser() user: Principal) { return this.service.listProposals(user); }
}
