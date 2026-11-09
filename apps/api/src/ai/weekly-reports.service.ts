import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationCategory, NotificationPriority, NotificationType, OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Principal } from '../common/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateWeeklyReportDto } from './weekly-reports.dto';
import {
  CalculatedReportMetrics,
  RawProjectData,
  StructuredWeeklyReportData,
  WeeklyReportActionRecommendation,
  WeeklyReportEngine,
} from './weekly-reports.engine';
import { WeeklyReportPdfGenerator } from './weekly-reports.pdf';

@Injectable()
export class WeeklyReportsService {
  private readonly logger = new Logger(WeeklyReportsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
    private realtime: RealtimeGateway,
    @Optional()
    private notifications?: NotificationsService,
  ) {}

  /**
   * Generates a new comprehensive weekly project report.
   */
  async generateReport(user: Principal, dto: GenerateWeeklyReportDto) {
    const { projectId, periodStart: startInput, periodEnd: endInput, customInstructions } = dto;

    const { periodStart, periodEnd } = WeeklyReportEngine.resolvePeriod(startInput, endInput);

    if (periodStart >= periodEnd) {
      throw new BadRequestException('Reporting period start date must be strictly before end date');
    }

    // Verify project exists in user workspace
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: user.orgId, archivedAt: null },
      select: { id: true, name: true, description: true, ownerId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found in this workspace');
    }

    // Fetch workspace raw data
    const rawData = await this.gatherRawProjectData(user.orgId, project, periodStart, periodEnd);

    // Build base structured deterministic report
    let reportData = WeeklyReportEngine.buildStructuredReport(
      rawData,
      periodStart,
      periodEnd,
      customInstructions,
    );

    // If AI provider is available, enrich executive summary and recommendations
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const enriched = await this.synthesizeWithLLM(
          apiKey,
          rawData,
          reportData.metrics,
          reportData.teamWorkload.members,
          customInstructions,
        );
        if (enriched.executiveSummary) {
          reportData.executiveSummary = enriched.executiveSummary;
        }
        if (enriched.recommendations && enriched.recommendations.length > 0) {
          reportData.recommendations = enriched.recommendations;
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI weekly report synthesis failed, using deterministic fallback: ${err.message}`);
      }
    }

    const title = `Weekly Report — ${project.name} (${periodStart.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} – ${periodEnd.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })})`;

    // Persist report in database
    const reportRecord = await this.prisma.projectWeeklyReport.create({
      data: {
        organizationId: user.orgId,
        projectId: project.id,
        creatorId: user.sub,
        title,
        periodStart,
        periodEnd,
        status: 'COMPLETED',
        executiveSummary: reportData.executiveSummary,
        metrics: reportData.metrics as any,
        progressOverview: reportData.progressOverview as any,
        blockersAndRisks: reportData.blockersAndRisks as any,
        teamWorkload: reportData.teamWorkload as any,
        meetingInsights: reportData.meetingInsights as any,
        recommendations: reportData.recommendations as any,
      },
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    // Record audit event and realtime broadcast
    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'weekly_report.generated',
      targetType: 'project_weekly_report',
      targetId: reportRecord.id,
      metadata: {
        projectId: project.id,
        title: reportRecord.title,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });

    this.realtime.broadcast(user.orgId, 'weekly_report.generated', {
      reportId: reportRecord.id,
      projectId: project.id,
      title: reportRecord.title,
    });

    if (this.notifications && project.ownerId) {
      const startStr = periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      this.notifications
        .notifyUsers(
          user.orgId,
          [project.ownerId],
          NotificationType.WEEKLY_REPORT,
          `Weekly Report Ready: ${project.name}`,
          `Intelligence report for period ${startStr} – ${endStr} has been compiled.`,
          `weekly_report:${reportRecord.id}`,
          {
            category: NotificationCategory.AI,
            priority: NotificationPriority.MEDIUM,
            actionUrl: `/reports?id=${reportRecord.id}`,
            metadata: {
              reportId: reportRecord.id,
              projectId: project.id,
              projectName: project.name,
              title: reportRecord.title,
            },
          },
        )
        .catch(err => this.logger.warn(`Weekly report notification error: ${err.message}`));
    }

    return reportRecord;
  }

  /**
   * Lists historical weekly reports for the workspace.
   */
  async listReports(user: Principal, projectId?: string) {
    const where: any = { organizationId: user.orgId };
    if (projectId) {
      where.projectId = projectId;
    }

    return this.prisma.projectWeeklyReport.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Retrieves full details of a specific weekly report.
   */
  async getReport(user: Principal, reportId: string) {
    const report = await this.prisma.projectWeeklyReport.findFirst({
      where: { id: reportId, organizationId: user.orgId },
      include: {
        project: { select: { id: true, name: true, description: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (!report) {
      throw new NotFoundException('Weekly report not found');
    }

    return report;
  }

  /**
   * Exports a weekly report as a binary PDF document.
   */
  async exportPdf(user: Principal, reportId: string): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getReport(user, reportId);

    const structuredData: StructuredWeeklyReportData = {
      projectId: report.projectId,
      projectName: report.project.name,
      projectDescription: report.project.description || undefined,
      periodStart: report.periodStart.toISOString(),
      periodEnd: report.periodEnd.toISOString(),
      generatedAt: report.createdAt.toISOString(),
      metrics: report.metrics as any,
      executiveSummary: report.executiveSummary,
      progressOverview: report.progressOverview as any,
      blockersAndRisks: report.blockersAndRisks as any,
      teamWorkload: report.teamWorkload as any,
      meetingInsights: report.meetingInsights as any,
      recommendations: report.recommendations as any,
    };

    const buffer = await WeeklyReportPdfGenerator.generate(structuredData);
    const sanitizedProject = report.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dateStr = report.periodEnd.toISOString().split('T')[0];
    const filename = `nexora-report-${sanitizedProject}-${dateStr}.pdf`;

    return { buffer, filename };
  }

  /**
   * Deletes a weekly report.
   */
  async deleteReport(user: Principal, reportId: string) {
    const report = await this.prisma.projectWeeklyReport.findFirst({
      where: { id: reportId, organizationId: user.orgId },
    });

    if (!report) {
      throw new NotFoundException('Weekly report not found');
    }

    // Permission check: Creator or Owner/Admin/PM can delete
    const canDelete =
      report.creatorId === user.sub ||
      user.role === OrganizationRole.OWNER ||
      user.role === OrganizationRole.ADMIN ||
      user.role === OrganizationRole.PROJECT_MANAGER;

    if (!canDelete) {
      throw new ForbiddenException('You do not have permission to delete this report');
    }

    await this.prisma.projectWeeklyReport.delete({
      where: { id: reportId },
    });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'weekly_report.deleted',
      targetType: 'project_weekly_report',
      targetId: reportId,
      metadata: {
        projectId: report.projectId,
        title: report.title,
      },
    });

    return { success: true, id: reportId };
  }

  // ==========================================
  // RAW DATA HARVESTING
  // ==========================================
  private async gatherRawProjectData(
    orgId: string,
    project: { id: string; name: string; description: string | null },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<RawProjectData> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId: project.id, organizationId: orgId },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        blockedBy: {
          include: {
            blockingTask: { select: { id: true, title: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const milestones = await this.prisma.milestone.findMany({
      where: { projectId: project.id, organizationId: orgId },
      orderBy: { targetDate: 'asc' },
    });

    const latestSnapshot = await this.prisma.projectHealthSnapshot.findFirst({
      where: { projectId: project.id, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });

    const activeRisks = await this.prisma.projectRisk.findMany({
      where: { projectId: project.id, organizationId: orgId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    const meetings = await this.prisma.meeting.findMany({
      where: {
        projectId: project.id,
        organizationId: orgId,
        archivedAt: null,
        startsAt: { gte: periodStart, lte: periodEnd },
      },
      include: {
        decisionsEvidence: { select: { id: true, title: true, evidence: true } },
        actionItemsReview: { select: { id: true, title: true, status: true, assigneeId: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: orgId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const parsedMeetings = meetings.map((m) => {
      const decisions =
        m.decisionsEvidence && m.decisionsEvidence.length > 0
          ? m.decisionsEvidence
          : Array.isArray(m.decisions)
          ? m.decisions
          : [];
      const actionItems =
        m.actionItemsReview && m.actionItemsReview.length > 0
          ? m.actionItemsReview
          : Array.isArray(m.actionItems)
          ? m.actionItems
          : [];
      return {
        id: m.id,
        title: m.title,
        startsAt: m.startsAt || new Date(),
        decisions: decisions.map((d: any) => ({
          id: d.id || '',
          title: d.title || String(d),
          evidence: d.evidence,
        })),
        actionItems: actionItems.map((a: any) => ({
          id: a.id || '',
          title: a.title || String(a),
          status: a.status || 'PENDING',
          assigneeId: a.assigneeId,
        })),
      };
    });

    const roster = memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      tasks,
      milestones,
      healthSnapshot: latestSnapshot
        ? {
            score: latestSnapshot.score ?? 70,
            classification: latestSnapshot.classification,
            explanation: latestSnapshot.explanation,
          }
        : null,
      activeRisks: activeRisks.map((r) => ({
        id: r.id,
        title: r.title,
        severity: r.severity,
        recommendedAction: r.recommendedAction,
      })),
      meetings: parsedMeetings,
      roster,
    };
  }

  // ==========================================
  // LLM SYNTHESIS ENHANCEMENT
  // ==========================================
  private async synthesizeWithLLM(
    apiKey: string,
    rawData: RawProjectData,
    metrics: CalculatedReportMetrics,
    workload: any[],
    customInstructions?: string,
  ): Promise<{ executiveSummary?: string; recommendations?: WeeklyReportActionRecommendation[] }> {
    const model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

    const promptPayload = {
      project: { name: rawData.name, description: rawData.description },
      metrics,
      workload,
      activeRisks: rawData.activeRisks,
      meetingsCount: rawData.meetings?.length || 0,
      customInstructions: customInstructions || 'Provide standard executive intelligence report synthesis.',
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        max_completion_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are an elite AI Technical Project Director for NEXORA AI Work Operating System.
Generate a grounded, professional executive summary and strategic recommendations for the weekly project report.
CRITICAL GROUNDING RULES:
1. ONLY reference numbers, metrics, tasks, and members provided in the context. Never invent new metrics, completion rates, or dates.
2. Structure your JSON response exactly:
{
  "executiveSummary": "A crisp, authoritative 2-3 paragraph executive summary covering current velocity, milestone outlook, health score, blockers, and team distribution.",
  "recommendations": [
    {
      "id": "rec-1",
      "title": "Action title",
      "category": "DELIVERY" | "RISK" | "CAPACITY" | "ALIGNMENT",
      "priority": "URGENT" | "HIGH" | "MEDIUM",
      "rationale": "Grounded reason why this action is required."
    }
  ]
}`,
          },
          {
            role: 'user',
            content: JSON.stringify(promptPayload),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) return {};

    const parsed = JSON.parse(content);
    return {
      executiveSummary: typeof parsed.executiveSummary === 'string' ? parsed.executiveSummary : undefined,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : undefined,
    };
  }
}
