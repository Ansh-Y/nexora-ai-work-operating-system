import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { ProjectHealthService } from './project-health.service';
import {
  DismissRiskDto,
  HealthHistoryQueryDto,
  ProjectRisksQueryDto,
  ProposeRiskActionDto,
  RecalculateHealthDto,
} from './project-health.dto';

@ApiTags('Project Health & Risk')
@Controller('health/projects')
export class ProjectHealthController {
  constructor(private service: ProjectHealthService) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get workspace project health overview' })
  @ApiResponse({ status: 200, description: 'Workspace health metrics, project cards, and recent high-severity risks' })
  @Get('overview')
  overview(@CurrentUser() user: Principal) {
    return this.service.getWorkspaceOverview(user);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed project health score, dimension breakdowns, forecast, and active risks' })
  @ApiResponse({ status: 200, description: 'Comprehensive project health details' })
  @Get(':projectId')
  projectHealth(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getProjectHealth(user, projectId);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get historical health snapshots and score trends for a project' })
  @ApiResponse({ status: 200, description: 'Historical health snapshots in chronological order' })
  @Get(':projectId/history')
  history(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: HealthHistoryQueryDto,
  ) {
    return this.service.getHealthHistory(user, projectId, query);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get risks for a project with optional severity and status filters' })
  @ApiResponse({ status: 200, description: 'List of detected project risks' })
  @Get(':projectId/risks')
  risks(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ProjectRisksQueryDto,
  ) {
    return this.service.getProjectRisks(user, projectId, query);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dismiss a detected risk with an audit-logged reason' })
  @ApiResponse({ status: 200, description: 'Risk marked as dismissed' })
  @Post(':projectId/risks/:riskId/dismiss')
  dismissRisk(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('riskId', ParseUUIDPipe) riskId: string,
    @Body() dto: DismissRiskDto,
  ) {
    return this.service.dismissRisk(user, projectId, riskId, dto);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually trigger health recalculation for a project' })
  @ApiResponse({ status: 200, description: 'Fresh health calculation result' })
  @Post(':projectId/recalculate')
  recalculate(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RecalculateHealthDto,
  ) {
    return this.service.recalculateProject(user, projectId, dto?.force ?? false);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an AI plan proposal from a risk recommendation for manager approval' })
  @ApiResponse({ status: 201, description: 'AiProposal created' })
  @Post(':projectId/recommendations/:riskId/propose')
  proposeRecommendation(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('riskId', ParseUUIDPipe) riskId: string,
    @Body() dto: ProposeRiskActionDto,
  ) {
    return this.service.proposeActionFromRecommendation(user, projectId, riskId, dto);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate an executive AI health explanation with deterministic fallback' })
  @ApiResponse({ status: 200, description: 'Executive project health narrative' })
  @Post(':projectId/explain')
  explain(
    @CurrentUser() user: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.explainHealthWithAI(user, projectId);
  }
}
