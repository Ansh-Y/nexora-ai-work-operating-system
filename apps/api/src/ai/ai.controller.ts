import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { ApprovePlanDto, AskDto, AssistantChatDto, ApplyTaskAssignmentDto, PlanDto } from './ai.dto';
import { AiService } from './ai.service';

@ApiTags('AI workspace') @ApiBearerAuth() @Controller('ai') @UseGuards(AuthGuard)
export class AiController {
  constructor(private service: AiService) {}
  @Post('ask') ask(@CurrentUser() user: Principal, @Body() dto: AskDto) { return this.service.ask(user, dto); }
  @Get('intelligence') intelligence(@CurrentUser() user: Principal) { return this.service.intelligence(user); }
  @Post('plan') plan(@CurrentUser() user: Principal, @Body() dto: PlanDto) { return this.service.proposePlan(user, dto); }
  @Post('proposals/:id/approve') approve(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto?: ApprovePlanDto) { return this.service.approve(user, id, dto); }
  @Post('proposals/:id/reject') reject(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.reject(user, id); }
  @Get('projects/:id/blockers') blockers(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.blockers(user, id); }
  @Get('projects/:id/weekly-report') report(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.weeklyReport(user, id); }
  @Get('projects/:id/duplicates') duplicates(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.duplicates(user, id); }
  @Get('proposals') proposals(@CurrentUser() user: Principal) { return this.service.listProposals(user); }

  @ApiOperation({ summary: 'Contextual conversation with AI Project Assistant' })
  @ApiResponse({ status: 200, description: 'Evidence-based answer with structured citations and follow-up prompts' })
  @Post('assistant/chat')
  assistantChat(@CurrentUser() user: Principal, @Body() dto: AssistantChatDto) {
    return this.service.assistantChat(user, dto);
  }

  @ApiOperation({ summary: 'Get workspace and project context for AI Project Assistant' })
  @ApiResponse({ status: 200, description: 'Workspace project context, health summary, and suggested starter questions' })
  @Get('assistant/context')
  assistantContext(@CurrentUser() user: Principal, @Query('projectId') projectId?: string) {
    return this.service.getAssistantContext(user, projectId);
  }

  @ApiOperation({ summary: 'Get smart assignee recommendations for a task based on capacity, schedules, and skills' })
  @ApiResponse({ status: 200, description: 'Top 3 grounded assignee recommendations with transparent rationales and workload concerns' })
  @Get('tasks/:taskId/recommend-assignee')
  recommendAssignee(@CurrentUser() user: Principal, @Param('taskId') taskId: string) {
    return this.service.recommendTaskAssignee(user, taskId);
  }

  @ApiOperation({ summary: 'Apply an approved task assignment recommendation (human in the loop)' })
  @ApiResponse({ status: 200, description: 'Persisted task assignment with audit record, notifications, and realtime updates' })
  @Post('tasks/:taskId/apply-assignment')
  @HttpCode(200)
  applyAssignment(@CurrentUser() user: Principal, @Param('taskId') taskId: string, @Body() dto: ApplyTaskAssignmentDto) {
    return this.service.applyTaskAssignment(user, taskId, dto.assigneeId);
  }
}

