import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkflowRunStatus } from '@prisma/client';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import {
  ApproveWorkflowRunDto,
  CreateWorkflowRuleDto,
  RejectWorkflowRunDto,
  SimulateWorkflowEventDto,
  UpdateWorkflowRuleDto,
} from './workflow-automation.dto';
import { WorkflowAutomationService } from './workflow-automation.service';

@ApiTags('AI Workflow Automation')
@ApiBearerAuth()
@Controller('ai/automations')
@UseGuards(AuthGuard)
export class WorkflowAutomationController {
  constructor(private service: WorkflowAutomationService) {}

  @ApiOperation({ summary: 'Get automation dashboard metrics and stats' })
  @ApiResponse({ status: 200, description: 'Summary statistics of rules and executions' })
  @Get('stats')
  getStats(@CurrentUser() user: Principal) {
    return this.service.getDashboardStats(user);
  }

  @ApiOperation({ summary: 'List all workflow automation rules for this organization' })
  @ApiResponse({ status: 200, description: 'List of rules' })
  @Get('rules')
  listRules(@CurrentUser() user: Principal) {
    return this.service.listRules(user);
  }

  @ApiOperation({ summary: 'Create a new workflow automation rule' })
  @ApiResponse({ status: 201, description: 'Rule created successfully' })
  @Post('rules')
  createRule(@CurrentUser() user: Principal, @Body() dto: CreateWorkflowRuleDto) {
    return this.service.createRule(user, dto);
  }

  @ApiOperation({ summary: 'Get a specific workflow rule by ID' })
  @ApiResponse({ status: 200, description: 'Rule details' })
  @Get('rules/:id')
  getRule(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.getRule(user, id);
  }

  @ApiOperation({ summary: 'Update or toggle a workflow automation rule' })
  @ApiResponse({ status: 200, description: 'Updated rule' })
  @Patch('rules/:id')
  updateRule(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowRuleDto,
  ) {
    return this.service.updateRule(user, id, dto);
  }

  @ApiOperation({ summary: 'Delete a workflow automation rule' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @Delete('rules/:id')
  deleteRule(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.deleteRule(user, id);
  }

  @ApiOperation({ summary: 'List automation runs (approvals and execution history)' })
  @ApiResponse({ status: 200, description: 'List of automation runs' })
  @Get('runs')
  listRuns(
    @CurrentUser() user: Principal,
    @Query('status') status?: WorkflowRunStatus,
  ) {
    return this.service.listRuns(user, status);
  }

  @ApiOperation({ summary: 'Get a specific automation run details' })
  @ApiResponse({ status: 200, description: 'Run details' })
  @Get('runs/:id')
  getRun(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.getRun(user, id);
  }

  @ApiOperation({ summary: 'Approve and execute a pending automation action' })
  @ApiResponse({ status: 200, description: 'Run approved and executed' })
  @Post('runs/:id/approve')
  @HttpCode(200)
  approveRun(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto?: ApproveWorkflowRunDto,
  ) {
    return this.service.approveRun(user, id, dto);
  }

  @ApiOperation({ summary: 'Reject a pending automation action' })
  @ApiResponse({ status: 200, description: 'Run rejected' })
  @Post('runs/:id/reject')
  @HttpCode(200)
  rejectRun(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto?: RejectWorkflowRunDto,
  ) {
    return this.service.rejectRun(user, id, dto);
  }

  @ApiOperation({ summary: 'Retry a failed automation execution' })
  @ApiResponse({ status: 200, description: 'Run retried' })
  @Post('runs/:id/retry')
  @HttpCode(200)
  retryRun(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.retryRun(user, id);
  }

  @ApiOperation({ summary: 'Simulate or trigger an automation event for testing' })
  @ApiResponse({ status: 200, description: 'Matched and generated runs' })
  @Post('simulate-trigger')
  @HttpCode(200)
  simulateTrigger(@CurrentUser() user: Principal, @Body() dto: SimulateWorkflowEventDto) {
    return this.service.simulateTrigger(user, dto);
  }

  @ApiOperation({ summary: 'Scan workspace for overdue tasks and approaching milestones to trigger matching automations' })
  @ApiResponse({ status: 200, description: 'Matched and generated runs' })
  @Post('scan-deadlines')
  @HttpCode(200)
  async scanDeadlines(@CurrentUser() user: Principal) {
    const [overdueRuns, milestoneRuns] = await Promise.all([
      this.service.scanOverdueTasks(user.orgId),
      this.service.scanApproachingMilestones(user.orgId),
    ]);
    return {
      message: 'Workspace deadline sweep complete',
      overdueRunsCount: overdueRuns.length,
      milestoneRunsCount: milestoneRuns.length,
      runs: [...overdueRuns, ...milestoneRuns],
    };
  }
}
