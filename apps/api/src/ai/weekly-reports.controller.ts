import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { GenerateWeeklyReportDto, ListWeeklyReportsQueryDto } from './weekly-reports.dto';
import { WeeklyReportsService } from './weekly-reports.service';

@ApiTags('Weekly Reports')
@ApiBearerAuth()
@Controller('ai/reports')
@UseGuards(AuthGuard)
export class WeeklyReportsController {
  constructor(private reportsService: WeeklyReportsService) {}

  @ApiOperation({ summary: 'Generate a new AI weekly project intelligence report' })
  @ApiResponse({ status: 201, description: 'Weekly report generated successfully' })
  @Post('generate')
  @HttpCode(201)
  async generate(@CurrentUser() user: Principal, @Body() dto: GenerateWeeklyReportDto) {
    return this.reportsService.generateReport(user, dto);
  }

  @ApiOperation({ summary: 'List historical weekly reports for the workspace or project' })
  @ApiResponse({ status: 200, description: 'List of historical weekly reports' })
  @Get()
  async list(@CurrentUser() user: Principal, @Query() query: ListWeeklyReportsQueryDto) {
    return this.reportsService.listReports(user, query.projectId);
  }

  @ApiOperation({ summary: 'Get full details of a specific weekly report' })
  @ApiResponse({ status: 200, description: 'Weekly report data and intelligence sections' })
  @Get(':id')
  async get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.reportsService.getReport(user, id);
  }

  @ApiOperation({ summary: 'Export weekly report as a styled professional PDF' })
  @ApiResponse({ status: 200, description: 'Binary PDF document stream' })
  @Get(':id/pdf')
  async exportPdf(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { buffer, filename } = await this.reportsService.exportPdf(user, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Content-Length', buffer.length);
    return new StreamableFile(buffer);
  }

  @ApiOperation({ summary: 'Delete a weekly report' })
  @ApiResponse({ status: 200, description: 'Weekly report deleted successfully' })
  @Delete(':id')
  async delete(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.reportsService.deleteReport(user, id);
  }
}
