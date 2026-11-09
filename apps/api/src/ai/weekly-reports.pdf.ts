import PDFDocument from 'pdfkit';
import { StructuredWeeklyReportData } from './weekly-reports.engine';

export class WeeklyReportPdfGenerator {
  /**
   * Generates a high-quality, professional PDF document from structured weekly report data.
   * Adheres strictly to NEXORA's Obsidian & Jade enterprise design system with consistent grid alignment,
   * balanced typography, robust table formatting, and intelligent page distribution.
   */
  static async generate(report: StructuredWeeklyReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Document Geometry
        const LEFT_MARGIN = 40;
        const RIGHT_MARGIN = 555;
        const CONTENT_WIDTH = 515; // 555 - 40
        const MAX_CONTENT_Y = 765;
        const FOOTER_Y = 786;

        const doc = new PDFDocument({
          size: 'A4', // 595.28 x 841.89 pt
          margins: { top: 38, bottom: 20, left: 40, right: 40 },
          info: {
            Title: `Weekly Report - ${report.projectName}`,
            Author: 'NEXORA AI Work Operating System',
            Subject: `Weekly Project Report for ${report.projectName}`,
            Keywords: 'NEXORA, Weekly Report, Project Intelligence, AI, Enterprise',
            CreationDate: new Date(report.generatedAt),
          },
          bufferPages: true,
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });
        doc.on('error', (err) => reject(err));

        // ----------------- OBSIDIAN & JADE PALETTE -----------------
        const colors = {
          obsidian: '#101B22',
          obsidianCard: '#15242C',
          obsidianBorder: '#28444E',
          jade: '#218F78',
          jadeBright: '#48C9B0',
          jadeLight: '#E8F6F3',
          jadeBorder: '#B2E2D8',
          ink: '#0F172A',
          inkDark: '#1E293B',
          inkSecondary: '#475569',
          inkMuted: '#64748B',
          inkDim: '#94A3B8',
          surface: '#FFFFFF',
          surfaceSubtle: '#F8FAFC',
          surfaceHeader: '#F1F5F9',
          borderSubtle: '#E2E8F0',
          alertRed: '#DC2626',
          alertRedWash: '#FEF2F2',
          alertRedBorder: '#FECACA',
          alertOrange: '#D97706',
          alertOrangeWash: '#FFFBEB',
          alertOrangeBorder: '#FDE68A',
        };

        const formatDateText = (d: Date | string | null | undefined): string => {
          if (!d) return '—';
          try {
            return new Date(d).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
          } catch {
            return String(d);
          }
        };

        const normalizeGrammar = (text: string): string => {
          return text
            .replace(/\b1 high-priority task\(s\) have no owner\b/gi, '1 high-priority task has no owner')
            .replace(/\b1 high-priority task\(s\) currently blocked\b/gi, '1 high-priority task currently blocked')
            .replace(/\b1 overdue task\(s\)\b/gi, '1 overdue task')
            .replace(/\b(\d+) high-priority task\(s\) have no owner\b/gi, '$1 high-priority tasks have no owner')
            .replace(/\b(\d+) high-priority task\(s\) currently blocked\b/gi, '$1 high-priority tasks currently blocked')
            .replace(/\b(\d+) task\(s\)\b/gi, '$1 tasks')
            .replace(/\b1 tasks\b/gi, '1 task')
            .replace(/\b1 high or urgent priority tasks currently remain unassigned\b/gi, '1 high-priority task currently remains unassigned');
        };

        // Draw Continuation Header when adding a page
        const drawContinuationHeader = (subtitle: string) => {
          doc.rect(LEFT_MARGIN, 38, CONTENT_WIDTH, 30).fill(colors.obsidian);
          doc.rect(LEFT_MARGIN, 67, CONTENT_WIDTH, 1.5).fill(colors.jade);

          doc.fillColor(colors.jadeBright)
            .fontSize(7.5)
            .font('Helvetica-Bold')
            .text('NEXORA AI WORK OPERATING SYSTEM', 52, 43, { characterSpacing: 1 });

          doc.fillColor(colors.surface)
            .fontSize(9.5)
            .font('Helvetica-Bold')
            .text(`${report.projectName.toUpperCase()} — ${subtitle.toUpperCase()}`, 52, 53, {
              width: 380,
            });

          doc.y = 78;
        };

        // Page break helper with continuation header
        const ensureSpace = (neededHeight: number, continuationSubtitle?: string) => {
          if (doc.y + neededHeight > MAX_CONTENT_Y) {
            doc.addPage();
            drawContinuationHeader(continuationSubtitle || 'REPORT CONTINUATION');
          }
        };

        // Section header drawer
        const drawSectionHeader = (title: string, sectionNumber: string, yPos: number): number => {
          doc.fillColor(colors.jade)
            .fontSize(9.5)
            .font('Helvetica-Bold')
            .text(`${sectionNumber}. ${title.toUpperCase()}`, LEFT_MARGIN, yPos);

          const lineY = yPos + 12;
          doc.strokeColor(colors.borderSubtle)
            .lineWidth(0.75)
            .moveTo(LEFT_MARGIN, lineY)
            .lineTo(RIGHT_MARGIN, lineY)
            .stroke();

          return lineY + 6;
        };

        // =========================================================================
        // 1. PAGE 1: HEADER BANNER
        // =========================================================================
        const bannerY = 38;
        const bannerHeight = 64;

        doc.rect(LEFT_MARGIN, bannerY, CONTENT_WIDTH, bannerHeight).fill(colors.obsidian);
        doc.rect(LEFT_MARGIN, bannerY + bannerHeight - 2, CONTENT_WIDTH, 2).fill(colors.jade);

        // Eyebrow
        doc.fillColor(colors.jadeBright)
          .fontSize(7.5)
          .font('Helvetica-Bold')
          .text('NEXORA WORK INTELLIGENCE', 52, bannerY + 10, { characterSpacing: 1.2 });

        // Report Title (constrained width: 340pt to avoid ANY truncation)
        doc.fillColor(colors.surface)
          .fontSize(13.5)
          .font('Helvetica-Bold')
          .text('WEEKLY PROJECT INTELLIGENCE REPORT', 52, bannerY + 22, { width: 340 });

        // Reporting Period
        const periodStartFmt = formatDateText(report.periodStart);
        const periodEndFmt = formatDateText(report.periodEnd);
        doc.fillColor(colors.inkDim)
          .fontSize(8)
          .font('Helvetica')
          .text(`Reporting Period: ${periodStartFmt} – ${periodEndFmt}`, 52, bannerY + 44);

        // Health Score Card on Right
        const healthX = 415;
        const healthY = bannerY + 8;
        const healthW = 125;
        const healthH = 48;

        doc.roundedRect(healthX, healthY, healthW, healthH, 4).fill(colors.obsidianCard);
        doc.strokeColor(colors.obsidianBorder).lineWidth(0.75).stroke();

        doc.fillColor(colors.jadeBright)
          .fontSize(6.5)
          .font('Helvetica-Bold')
          .text('HEALTH SCORE', healthX + 9, healthY + 7);

        doc.fillColor(colors.surface)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(`${report.metrics.healthScore}/100`, healthX + 9, healthY + 19);

        const healthUpper = (report.metrics.healthClassification || 'UNKNOWN').toUpperCase();
        const healthColor =
          healthUpper.includes('CRITICAL') || healthUpper.includes('AT_RISK')
            ? colors.alertRed
            : healthUpper.includes('MEDIUM') || healthUpper.includes('WARNING')
            ? colors.alertOrange
            : colors.jadeBright;

        doc.fillColor(healthColor)
          .fontSize(7.5)
          .font('Helvetica-Bold')
          .text(healthUpper.replace(/_/g, ' '), healthX + 64, healthY + 23, { width: 52, align: 'right' });

        doc.y = bannerY + bannerHeight + 8;

        // =========================================================================
        // 2. PROJECT INFO
        // =========================================================================
        doc.fillColor(colors.obsidian)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(report.projectName, LEFT_MARGIN, doc.y);

        if (report.projectDescription) {
          doc.fillColor(colors.inkMuted)
            .fontSize(8)
            .font('Helvetica')
            .text(report.projectDescription, LEFT_MARGIN, doc.y + 2, {
              width: CONTENT_WIDTH,
              lineGap: 1.5,
            });
          doc.y += 4;
        } else {
          doc.y += 2;
        }

        // =========================================================================
        // 3. KPI CARDS (6 Balanced Cards across 515pt)
        // =========================================================================
        const kpiY = doc.y + 3;
        const boxWidth = 79;
        const boxGap = 8.2;
        const boxHeight = 40;

        const kpis = [
          { label: 'TOTAL TASKS', value: report.metrics.totalTasks, color: colors.obsidian },
          { label: 'COMPLETED', value: report.metrics.completedThisPeriod, color: colors.jade },
          { label: 'PENDING', value: report.metrics.pendingTasks, color: colors.inkDark },
          { label: 'OVERDUE', value: report.metrics.overdueTasks, color: report.metrics.overdueTasks > 0 ? colors.alertRed : colors.jade },
          { label: 'BLOCKED', value: report.metrics.blockedTasks, color: report.metrics.blockedTasks > 0 ? colors.alertRed : colors.inkDark },
          { label: 'COMPLETION', value: `${report.metrics.completionRate}%`, color: colors.jade },
        ];

        kpis.forEach((kpi, idx) => {
          const x = LEFT_MARGIN + idx * (boxWidth + boxGap);
          doc.roundedRect(x, kpiY, boxWidth, boxHeight, 3.5).fill(colors.surfaceSubtle);
          doc.strokeColor(colors.borderSubtle).lineWidth(0.75).stroke();

          doc.fillColor(colors.inkMuted)
            .fontSize(6.5)
            .font('Helvetica-Bold')
            .text(kpi.label, x, kpiY + 6, { width: boxWidth, align: 'center' });

          doc.fillColor(kpi.color)
            .fontSize(12.5)
            .font('Helvetica-Bold')
            .text(String(kpi.value), x, kpiY + 18, { width: boxWidth, align: 'center' });
        });

        doc.y = kpiY + boxHeight + 10;

        // =========================================================================
        // 4. SECTION 1: EXECUTIVE SUMMARY
        // =========================================================================
        const execSummaryY = drawSectionHeader('Executive Summary', '1', doc.y);
        const summaryText = report.executiveSummary || 'No executive summary recorded for this reporting period.';
        const summaryTextHeight = doc.heightOfString(summaryText, {
          width: CONTENT_WIDTH - 24,
          lineGap: 2,
        });
        const summaryBoxHeight = summaryTextHeight + 12;

        doc.roundedRect(LEFT_MARGIN, execSummaryY, CONTENT_WIDTH, summaryBoxHeight, 3.5).fill(colors.surfaceSubtle);
        doc.strokeColor(colors.borderSubtle).lineWidth(0.75).stroke();
        doc.rect(LEFT_MARGIN, execSummaryY, 3, summaryBoxHeight).fill(colors.jade);

        doc.fillColor(colors.inkDark)
          .fontSize(8)
          .font('Helvetica')
          .text(summaryText, LEFT_MARGIN + 12, execSummaryY + 6, {
            width: CONTENT_WIDTH - 24,
            lineGap: 2,
          });

        doc.y = execSummaryY + summaryBoxHeight + 10;

        // =========================================================================
        // 5. SECTION 2: PROGRESS & MILESTONES
        // =========================================================================
        ensureSpace(60, 'PROGRESS & MILESTONES');
        const progressY = drawSectionHeader('Progress & Milestone Highlights', '2', doc.y);

        const colWidth = (CONTENT_WIDTH - 15) / 2; // 250pt
        const colLeftX = LEFT_MARGIN;
        const colRightX = LEFT_MARGIN + colWidth + 15;

        // Left Col: Completed Tasks
        doc.fillColor(colors.obsidian).fontSize(8).font('Helvetica-Bold')
          .text(`Completed During Period (${report.progressOverview.completedTasks.length}):`, colLeftX, progressY);

        let leftY = progressY + 11;
        if (report.progressOverview.completedTasks.length === 0) {
          doc.fillColor(colors.inkMuted).fontSize(7.5).font('Helvetica-Oblique')
            .text('• No tasks were marked completed during this reporting window.', colLeftX, leftY, { width: colWidth });
          leftY += 10;
        } else {
          doc.fontSize(7.5).font('Helvetica');
          report.progressOverview.completedTasks.slice(0, 3).forEach((task) => {
            const dateStr = formatDateText(task.completedAt);
            doc.fillColor(colors.jade).text('• ', colLeftX, leftY, { continued: true })
              .fillColor(colors.inkMuted).text(`[${dateStr}] `, { continued: true })
              .fillColor(colors.inkDark).text(task.title, { width: colWidth - 10 });
            leftY = doc.y + 1.5;
          });
          if (report.progressOverview.completedTasks.length > 3) {
            doc.fillColor(colors.inkMuted).fontSize(7).text(`...and ${report.progressOverview.completedTasks.length - 3} more completed tasks.`, colLeftX, leftY);
            leftY += 9;
          }
        }

        // Right Col: Milestones
        doc.fillColor(colors.obsidian).fontSize(8).font('Helvetica-Bold')
          .text(`Upcoming Milestones (${report.progressOverview.upcomingMilestones.length}):`, colRightX, progressY);

        let rightY = progressY + 11;
        if (report.progressOverview.upcomingMilestones.length === 0) {
          doc.fillColor(colors.inkMuted).fontSize(7.5).font('Helvetica-Oblique')
            .text('• No pending milestones currently scheduled for this project.', colRightX, rightY, { width: colWidth });
          rightY += 10;
        } else {
          doc.fontSize(7.5).font('Helvetica');
          report.progressOverview.upcomingMilestones.slice(0, 3).forEach((ms) => {
            const dateStr = ms.targetDate ? formatDateText(ms.targetDate) : 'No target date';
            doc.fillColor(colors.jade).text('• ', colRightX, rightY, { continued: true })
              .fillColor(colors.inkDark).text(ms.title, { continued: true })
              .fillColor(colors.inkMuted).text(` (Target: ${dateStr})`, { width: colWidth - 10 });
            rightY = doc.y + 1.5;
          });
        }

        doc.y = Math.max(leftY, rightY) + 9;

        // =========================================================================
        // 6. SECTION 3: BLOCKERS & RISK INTELLIGENCE
        // =========================================================================
        ensureSpace(70, 'BLOCKERS & RISK INTELLIGENCE');
        const blockersHeaderY = drawSectionHeader('Blockers & Risk Intelligence', '3', doc.y);
        doc.y = blockersHeaderY;

        const hasBlockers = report.blockersAndRisks.blockedTasks.length > 0;
        const hasOverdue = report.blockersAndRisks.overdueTasks.length > 0;
        const hasRisks = report.blockersAndRisks.projectRisks.length > 0;

        if (!hasBlockers && !hasOverdue && !hasRisks) {
          doc.roundedRect(LEFT_MARGIN, doc.y, CONTENT_WIDTH, 20, 3.5).fill(colors.jadeLight);
          doc.strokeColor(colors.jadeBorder).lineWidth(0.75).stroke();
          doc.fillColor(colors.jade).fontSize(8).font('Helvetica-Bold')
            .text('STATUS CLEAN: Zero active blockers, overdue items, or unresolved risk alerts detected.', LEFT_MARGIN + 10, doc.y + 5.5);
          doc.y += 26;
        } else {
          // Blocked Tasks
          if (hasBlockers) {
            doc.fillColor(colors.alertRed).fontSize(8).font('Helvetica-Bold')
              .text(`Blocked Tasks (${report.blockersAndRisks.blockedTasks.length}):`, LEFT_MARGIN, doc.y);
            doc.y += 2.5;

            report.blockersAndRisks.blockedTasks.slice(0, 3).forEach((b) => {
              const depText =
                b.blockedByTitles && b.blockedByTitles.length > 0
                  ? `Waiting on: ${b.blockedByTitles.join(', ')}`
                  : 'Flagged as blocked without upstream dependencies linked';

              doc.fillColor(colors.alertRed).fontSize(7.5).font('Helvetica-Bold').text('  • ', LEFT_MARGIN, doc.y, { continued: true })
                .fillColor(colors.inkDark).text(`${b.title} `, { continued: true })
                .fillColor(colors.inkMuted).font('Helvetica').text(`— ${depText}`);
              doc.y += 1.5;
            });
            doc.y += 2;
          }

          // Overdue Tasks
          if (hasOverdue) {
            doc.fillColor(colors.alertOrange).fontSize(8).font('Helvetica-Bold')
              .text(`Overdue Tasks (${report.blockersAndRisks.overdueTasks.length}):`, LEFT_MARGIN, doc.y);
            doc.y += 2.5;

            report.blockersAndRisks.overdueTasks.slice(0, 3).forEach((t) => {
              const dueStr = formatDateText(t.dueDate);
              doc.fillColor(colors.alertOrange).fontSize(7.5).font('Helvetica-Bold').text('  • ', LEFT_MARGIN, doc.y, { continued: true })
                .text(`[${t.priority}] `, { continued: true })
                .fillColor(colors.inkDark).text(`${t.title} `, { continued: true })
                .fillColor(colors.inkMuted).font('Helvetica').text(`— Scheduled due date: ${dueStr}`);
              doc.y += 1.5;
            });
            doc.y += 2;
          }

          // Project Risks
          if (hasRisks) {
            doc.fillColor(colors.obsidian).fontSize(8).font('Helvetica-Bold')
              .text(`Identified Project Risks (${report.blockersAndRisks.projectRisks.length}):`, LEFT_MARGIN, doc.y);
            doc.y += 2.5;

            report.blockersAndRisks.projectRisks.slice(0, 3).forEach((r) => {
              const sevColor = r.severity === 'CRITICAL' ? colors.alertRed : (r.severity === 'HIGH' ? colors.alertOrange : colors.inkSecondary);
              const cleanTitle = normalizeGrammar(r.title);
              doc.fillColor(sevColor).fontSize(7.5).font('Helvetica-Bold').text('  • ', LEFT_MARGIN, doc.y, { continued: true })
                .text(`[${r.severity}] `, { continued: true })
                .fillColor(colors.inkDark).text(`${cleanTitle}: `, { continued: true })
                .fillColor(colors.inkMuted).font('Helvetica').text(r.action);
              doc.y += 1.5;
            });
          }

          doc.y += 8;
        }

        // =========================================================================
        // 7. SECTION 4: TEAM WORKLOAD & CAPACITY TABLE
        // =========================================================================
        const colMemberX = LEFT_MARGIN + 10;
        const colRoleX = LEFT_MARGIN + 175;
        const colActiveX = LEFT_MARGIN + 275;
        const colCompX = LEFT_MARGIN + 345;
        const colOverdueX = LEFT_MARGIN + 435;

        ensureSpace(60, 'TEAM WORKLOAD & CAPACITY');
        const workloadHeaderY = drawSectionHeader('Team Workload & Capacity', '4', doc.y);
        doc.y = workloadHeaderY;

        const members = report.teamWorkload.members || [];
        if (members.length === 0) {
          doc.fillColor(colors.inkMuted).fontSize(7.5).font('Helvetica-Oblique')
            .text('No project members currently registered in team roster.', LEFT_MARGIN, doc.y);
          doc.y += 10;
        } else {
          // Table Header
          const tableHeaderY = doc.y;
          doc.rect(LEFT_MARGIN, tableHeaderY, CONTENT_WIDTH, 16).fill(colors.surfaceHeader);
          doc.strokeColor(colors.borderSubtle).lineWidth(0.75).stroke();

          doc.fillColor(colors.inkSecondary).fontSize(6.5).font('Helvetica-Bold');
          doc.text('TEAM MEMBER', colMemberX, tableHeaderY + 4.5, { width: 160, align: 'left' });
          doc.text('ROLE', colRoleX, tableHeaderY + 4.5, { width: 90, align: 'left' });
          doc.text('ACTIVE TASKS', colActiveX, tableHeaderY + 4.5, { width: 65, align: 'center' });
          doc.text('COMPLETED', colCompX, tableHeaderY + 4.5, { width: 85, align: 'center' });
          doc.text('OVERDUE', colOverdueX, tableHeaderY + 4.5, { width: 65, align: 'center' });

          let rowY = tableHeaderY + 16;
          members.slice(0, 8).forEach((m, idx) => {
            if (rowY > MAX_CONTENT_Y - 18) {
              doc.addPage();
              drawContinuationHeader('TEAM WORKLOAD (CONT.)');
              rowY = doc.y;
            }

            const rowBg = idx % 2 === 1 ? colors.surfaceSubtle : colors.surface;
            doc.rect(LEFT_MARGIN, rowY, CONTENT_WIDTH, 16).fill(rowBg);
            doc.strokeColor(colors.borderSubtle).lineWidth(0.5).moveTo(LEFT_MARGIN, rowY + 16).lineTo(RIGHT_MARGIN, rowY + 16).stroke();

            doc.fillColor(colors.inkDark).fontSize(7.5).font('Helvetica-Bold')
              .text(m.name, colMemberX, rowY + 4, { width: 160, align: 'left' });

            doc.fillColor(colors.inkMuted).fontSize(7).font('Helvetica')
              .text(m.role, colRoleX, rowY + 4, { width: 90, align: 'left' });

            doc.fillColor(colors.inkDark).fontSize(7.5).font('Helvetica-Bold')
              .text(String(m.activeCount), colActiveX, rowY + 4, { width: 65, align: 'center' });

            doc.fillColor(colors.jade).fontSize(7.5).font('Helvetica-Bold')
              .text(String(m.completedThisPeriod), colCompX, rowY + 4, { width: 85, align: 'center' });

            doc.fillColor(m.overdueCount > 0 ? colors.alertRed : colors.inkMuted).fontSize(7.5).font('Helvetica-Bold')
              .text(String(m.overdueCount), colOverdueX, rowY + 4, { width: 65, align: 'center' });

            rowY += 16;
          });

          doc.y = rowY + 4;
        }

        // Unassigned high-priority tasks notice
        if (report.teamWorkload.unassignedHighPriorityCount > 0) {
          const uCount = report.teamWorkload.unassignedHighPriorityCount;
          const uNotice = uCount === 1
            ? '1 high-priority task currently remains unassigned. Use AI Smart Assignment to balance workload.'
            : `${uCount} high-priority tasks currently remain unassigned. Use AI Smart Assignment to balance workload.`;

          const alertY = doc.y;
          doc.roundedRect(LEFT_MARGIN, alertY, CONTENT_WIDTH, 17, 3).fill(colors.alertOrangeWash);
          doc.strokeColor(colors.alertOrangeBorder).lineWidth(0.75).stroke();
          doc.fillColor(colors.alertOrange).fontSize(7).font('Helvetica-Bold')
            .text(`NOTICE:  ${uNotice}`, LEFT_MARGIN + 10, alertY + 4.5, { width: CONTENT_WIDTH - 20 });
          doc.y = alertY + 22;
        } else {
          doc.y += 4;
        }

        // =========================================================================
        // 8. SECTION 5: MEETING INSIGHTS & DECISIONS
        // =========================================================================
        ensureSpace(35, 'MEETING INSIGHTS');
        const meetingHeaderY = drawSectionHeader('Meeting Insights & Decisions', '5', doc.y);
        doc.y = meetingHeaderY;

        const mStats = `Meetings Tracked: ${report.meetingInsights.totalMeetings}  •  Decisions Formulated: ${report.meetingInsights.decisionsCount}  •  Open Action Items: ${report.meetingInsights.openActionItemsCount}`;
        doc.fillColor(colors.inkSecondary).fontSize(7.5).font('Helvetica').text(mStats, LEFT_MARGIN, doc.y);
        doc.y += 8;

        if (report.meetingInsights.decisions && report.meetingInsights.decisions.length > 0) {
          doc.fillColor(colors.obsidian).fontSize(7.5).font('Helvetica-Bold').text('Key Recorded Decisions:');
          doc.y += 1.5;
          report.meetingInsights.decisions.slice(0, 3).forEach((d) => {
            doc.fillColor(colors.jade).fontSize(7).font('Helvetica-Bold').text('  • ', LEFT_MARGIN, doc.y, { continued: true })
              .text(`[${d.meetingTitle}] `, { continued: true })
              .fillColor(colors.inkDark).font('Helvetica').text(d.title);
            doc.y += 1;
          });
        }
        doc.y += 8;

        // =========================================================================
        // 9. SECTION 6: AI STRATEGIC RECOMMENDATIONS
        // =========================================================================
        const recs = report.recommendations || [];
        const recsCount = recs.length;
        const estimatedRecsHeight = 18 + recsCount * 36;

        // Intelligent Page-Break Protection:
        // Only break to Page 2 if the recommendations genuinely cannot fit on Page 1.
        // If it fits within MAX_CONTENT_Y (765), keep it on Page 1 to avoid orphan pages!
        if (doc.y + estimatedRecsHeight > MAX_CONTENT_Y && doc.y > 660) {
          doc.addPage();
          drawContinuationHeader('STRATEGIC RECOMMENDATIONS & NEXT STEPS');
        }

        const recsHeaderY = drawSectionHeader('AI Strategic Recommendations for Next Week', '6', doc.y);
        doc.y = recsHeaderY;

        if (recs.length === 0) {
          doc.fillColor(colors.inkMuted).fontSize(7.5).font('Helvetica-Oblique')
            .text('No critical recommendations generated. Workflow execution is performing within target parameters.', LEFT_MARGIN, doc.y);
        } else {
          recs.forEach((rec) => {
            const cleanRationale = normalizeGrammar(rec.rationale);
            const rationaleHeight = doc.heightOfString(cleanRationale, {
              width: CONTENT_WIDTH - 24,
              lineGap: 1.5,
            });
            const cardHeight = Math.max(30, 14 + rationaleHeight + 6);

            // Card page break check
            if (doc.y + cardHeight > MAX_CONTENT_Y) {
              doc.addPage();
              drawContinuationHeader('STRATEGIC RECOMMENDATIONS (CONT.)');
              doc.y += 4;
            }

            const cardY = doc.y;
            doc.roundedRect(LEFT_MARGIN, cardY, CONTENT_WIDTH, cardHeight, 3.5).fill(colors.surfaceSubtle);
            doc.strokeColor(colors.borderSubtle).lineWidth(0.75).stroke();

            const pColor = rec.priority === 'URGENT' ? colors.alertRed : (rec.priority === 'HIGH' ? colors.alertOrange : colors.jade);
            doc.rect(LEFT_MARGIN, cardY, 3, cardHeight).fill(pColor);

            // Top Row: Priority Badge + Category Tag + Title
            doc.fillColor(pColor).fontSize(7).font('Helvetica-Bold')
              .text(`[${rec.priority}]`, LEFT_MARGIN + 9, cardY + 4.5, { continued: true })
              .fillColor(colors.inkSecondary).text(` ${rec.category}  `, { continued: true })
              .fillColor(colors.obsidian).text(rec.title, { width: CONTENT_WIDTH - 28 });

            // Second Row: Rationale
            doc.fillColor(colors.inkMuted).fontSize(7).font('Helvetica')
              .text(cleanRationale, LEFT_MARGIN + 9, cardY + 15, {
                width: CONTENT_WIDTH - 18,
                lineGap: 1.5,
              });

            doc.y = cardY + cardHeight + 4;
          });
        }

        // =========================================================================
        // 10. FOOTER & PAGE NUMBERING
        // =========================================================================
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.strokeColor(colors.borderSubtle).lineWidth(0.5).moveTo(LEFT_MARGIN, FOOTER_Y).lineTo(RIGHT_MARGIN, FOOTER_Y).stroke();
          doc.fillColor(colors.inkDim)
            .fontSize(7)
            .font('Helvetica')
            .text(
              'Generated by NEXORA AI Work Operating System • Confidential & Proprietary',
              LEFT_MARGIN,
              FOOTER_Y + 5,
              { width: 350, lineBreak: false },
            );
          doc.text(
            `Page ${i + 1} of ${range.count}`,
            RIGHT_MARGIN - 100,
            FOOTER_Y + 5,
            { width: 100, align: 'right', lineBreak: false },
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
