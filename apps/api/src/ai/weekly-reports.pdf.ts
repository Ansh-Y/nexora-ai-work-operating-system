import PDFDocument from 'pdfkit';
import { StructuredWeeklyReportData } from './weekly-reports.engine';

export class WeeklyReportPdfGenerator {
  /**
   * Generates a high-quality, professional PDF document from structured weekly report data.
   */
  static async generate(report: StructuredWeeklyReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Weekly Report - ${report.projectName}`,
            Author: 'NEXORA AI Work Operating System',
            Subject: `Weekly Project Report for ${report.projectName}`,
            Keywords: 'NEXORA, Weekly Report, Project Intelligence, AI',
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

        const primaryColor = '#101B22'; // Obsidian dark
        const jadeColor = '#218F78'; // Jade accent
        const jadeLight = '#E6F7F3';
        const slateDark = '#1E293B';
        const slateMuted = '#64748B';
        const slateLight = '#F1F5F9';
        const alertRed = '#DC2626';
        const alertOrange = '#EA580C';

        // ----------------- HEADER BANNER -----------------
        doc.rect(40, 40, 515, 65).fill(primaryColor);

        // Header Title
        doc.fillColor('#48C9B0')
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('NEXORA AI WORK OPERATING SYSTEM', 55, 52, { characterSpacing: 1 });

        doc.fillColor('#FFFFFF')
          .fontSize(18)
          .font('Helvetica-Bold')
          .text('WEEKLY PROJECT INTELLIGENCE REPORT', 55, 68);

        // Period & Health Badge on Right of Banner
        const periodStartFmt = new Date(report.periodStart).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        const periodEndFmt = new Date(report.periodEnd).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        doc.fillColor('#94A3B8')
          .fontSize(9)
          .font('Helvetica')
          .text(`Reporting Period: ${periodStartFmt} – ${periodEndFmt}`, 55, 88);

        // Health Score Pill in Banner
        doc.roundedRect(420, 52, 120, 42, 4).fill('#1A2E35');
        doc.fillColor('#48C9B0')
          .fontSize(8)
          .font('Helvetica-Bold')
          .text('HEALTH SCORE', 430, 58);
        doc.fillColor('#FFFFFF')
          .fontSize(15)
          .font('Helvetica-Bold')
          .text(`${report.metrics.healthScore}/100`, 430, 70);
        doc.fillColor('#48C9B0')
          .fontSize(8)
          .font('Helvetica')
          .text(report.metrics.healthClassification.toUpperCase(), 485, 75);

        doc.y = 120;

        // ----------------- PROJECT INFO -----------------
        doc.fillColor(primaryColor)
          .fontSize(16)
          .font('Helvetica-Bold')
          .text(report.projectName, 40, doc.y);

        if (report.projectDescription) {
          doc.fillColor(slateMuted)
            .fontSize(9)
            .font('Helvetica')
            .text(report.projectDescription, 40, doc.y + 4, { width: 515 });
          doc.moveDown(0.6);
        } else {
          doc.moveDown(0.3);
        }

        // ----------------- KPI SUMMARY METRICS GRID -----------------
        const kpiY = doc.y + 6;
        const boxWidth = 80;
        const boxHeight = 44;
        const boxGap = 7;

        const kpis = [
          { label: 'Total Tasks', value: report.metrics.totalTasks, color: primaryColor },
          { label: 'Completed Period', value: report.metrics.completedThisPeriod, color: jadeColor },
          { label: 'Pending Tasks', value: report.metrics.pendingTasks, color: slateDark },
          { label: 'Overdue', value: report.metrics.overdueTasks, color: report.metrics.overdueTasks > 0 ? alertRed : jadeColor },
          { label: 'Blocked', value: report.metrics.blockedTasks, color: report.metrics.blockedTasks > 0 ? alertOrange : slateDark },
          { label: 'Completion Rate', value: `${report.metrics.completionRate}%`, color: jadeColor },
        ];

        kpis.forEach((kpi, idx) => {
          const x = 40 + idx * (boxWidth + boxGap);
          doc.roundedRect(x, kpiY, boxWidth, boxHeight, 4).fill(slateLight);
          doc.fillColor(slateMuted)
            .fontSize(7.5)
            .font('Helvetica')
            .text(kpi.label, x + 5, kpiY + 7, { width: boxWidth - 10, align: 'center' });
          doc.fillColor(kpi.color)
            .fontSize(13)
            .font('Helvetica-Bold')
            .text(String(kpi.value), x + 5, kpiY + 22, { width: boxWidth - 10, align: 'center' });
        });

        doc.y = kpiY + boxHeight + 14;

        // Helper section drawer
        const drawSectionHeader = (title: string, iconNumber: string) => {
          if (doc.y > 680) {
            doc.addPage();
            doc.y = 40;
          }
          doc.fillColor(jadeColor)
            .fontSize(11)
            .font('Helvetica-Bold')
            .text(`${iconNumber}. ${title.toUpperCase()}`, 40, doc.y);
          doc.strokeColor(jadeLight).lineWidth(1).moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
          doc.y += 8;
        };

        // ----------------- SECTION 1: EXECUTIVE SUMMARY -----------------
        drawSectionHeader('Executive Summary', '1');
        const summaryBoxY = doc.y;
        doc.roundedRect(40, summaryBoxY, 515, 6), // reserve
        doc.fillColor(slateDark)
          .fontSize(9)
          .font('Helvetica')
          .text(report.executiveSummary, 45, summaryBoxY + 4, {
            width: 505,
            lineGap: 3,
          });
        doc.moveDown(1);

        // ----------------- SECTION 2: PROGRESS & MILESTONES -----------------
        drawSectionHeader('Progress & Milestone Highlights', '2');
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Tasks Completed During Period:');
        doc.font('Helvetica').fontSize(8.5);

        if (report.progressOverview.completedTasks.length === 0) {
          doc.fillColor(slateMuted).text('  • No tasks were marked completed during this reporting window.');
        } else {
          report.progressOverview.completedTasks.slice(0, 6).forEach((task) => {
            const dateStr = new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            doc.fillColor(jadeColor).text(`  ✓ [${dateStr}] `, { continued: true })
              .fillColor(slateDark).text(task.title);
          });
          if (report.progressOverview.completedTasks.length > 6) {
            doc.fillColor(slateMuted).text(`  ...and ${report.progressOverview.completedTasks.length - 6} additional completed tasks.`);
          }
        }

        doc.moveDown(0.4);
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Upcoming Milestones:');
        doc.font('Helvetica').fontSize(8.5);

        if (report.progressOverview.upcomingMilestones.length === 0) {
          doc.fillColor(slateMuted).text('  • No pending milestones currently scheduled for this project.');
        } else {
          report.progressOverview.upcomingMilestones.slice(0, 4).forEach((ms) => {
            const dateStr = ms.targetDate ? new Date(ms.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No target date';
            doc.fillColor(primaryColor).text(`  ◆ ${ms.title} `, { continued: true })
              .fillColor(slateMuted).text(`(Target: ${dateStr})`);
          });
        }
        doc.moveDown(1);

        // ----------------- SECTION 3: BLOCKERS & PROJECT RISKS -----------------
        drawSectionHeader('Blockers & Risk Intelligence', '3');

        if (report.blockersAndRisks.blockedTasks.length === 0 &&
            report.blockersAndRisks.overdueTasks.length === 0 &&
            report.blockersAndRisks.projectRisks.length === 0) {
          doc.fillColor(jadeColor).fontSize(9).font('Helvetica').text('✓ Zero active blockers, overdue tasks, or unresolved risk alerts detected.');
        } else {
          if (report.blockersAndRisks.blockedTasks.length > 0) {
            doc.fillColor(alertRed).fontSize(8.5).font('Helvetica-Bold').text('Blocked Tasks:');
            report.blockersAndRisks.blockedTasks.slice(0, 4).forEach((b) => {
              doc.fillColor(slateDark).font('Helvetica').fontSize(8)
                .text(`  • ${b.title} — Waiting on: ${b.blockedByTitles.join(', ')}`);
            });
            doc.moveDown(0.3);
          }

          if (report.blockersAndRisks.overdueTasks.length > 0) {
            doc.fillColor(alertOrange).fontSize(8.5).font('Helvetica-Bold').text('Overdue Tasks:');
            report.blockersAndRisks.overdueTasks.slice(0, 4).forEach((t) => {
              const dueStr = new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              doc.fillColor(slateDark).font('Helvetica').fontSize(8)
                .text(`  • [${t.priority}] ${t.title} — Was due on ${dueStr}`);
            });
            doc.moveDown(0.3);
          }

          if (report.blockersAndRisks.projectRisks.length > 0) {
            doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('Identified Project Risks:');
            report.blockersAndRisks.projectRisks.slice(0, 3).forEach((r) => {
              doc.fillColor(slateDark).font('Helvetica').fontSize(8)
                .text(`  • [${r.severity}] ${r.title}: ${r.action}`);
            });
          }
        }
        doc.moveDown(1);

        // ----------------- SECTION 4: TEAM WORKLOAD DISTRIBUTION -----------------
        drawSectionHeader('Team Workload & Capacity', '4');

        if (report.teamWorkload.members.length === 0) {
          doc.fillColor(slateMuted).fontSize(8.5).font('Helvetica').text('No project members currently registered in team roster.');
        } else {
          // Table header
          const tableY = doc.y;
          doc.rect(40, tableY, 515, 18).fill(slateLight);
          doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold');
          doc.text('Team Member', 50, tableY + 5);
          doc.text('Role', 180, tableY + 5);
          doc.text('Active Tasks', 300, tableY + 5);
          doc.text('Completed Period', 380, tableY + 5);
          doc.text('Overdue', 475, tableY + 5);

          let rowY = tableY + 20;
          doc.font('Helvetica').fontSize(8);

          report.teamWorkload.members.slice(0, 10).forEach((member, i) => {
            if (rowY > 730) {
              doc.addPage();
              rowY = 50;
            }
            if (i % 2 === 1) {
              doc.rect(40, rowY - 2, 515, 16).fill('#F8FAFC');
            }
            doc.fillColor(slateDark).text(member.name, 50, rowY);
            doc.fillColor(slateMuted).text(member.role, 180, rowY);
            doc.fillColor(primaryColor).text(String(member.activeCount), 320, rowY);
            doc.fillColor(jadeColor).text(String(member.completedThisPeriod), 405, rowY);
            doc.fillColor(member.overdueCount > 0 ? alertRed : slateDark).text(String(member.overdueCount), 490, rowY);
            rowY += 16;
          });

          doc.y = rowY + 4;
        }

        if (report.teamWorkload.unassignedHighPriorityCount > 0) {
          doc.fillColor(alertOrange)
            .fontSize(8)
            .font('Helvetica-Bold')
            .text(`⚠ Notice: ${report.teamWorkload.unassignedHighPriorityCount} high or urgent priority tasks currently remain unassigned.`, 45, doc.y);
          doc.moveDown(0.5);
        }

        doc.moveDown(0.8);

        // ----------------- SECTION 5: MEETING INSIGHTS -----------------
        drawSectionHeader('Meeting Insights & Decisions', '5');
        doc.fillColor(slateDark).fontSize(8.5).font('Helvetica');
        doc.text(`Total Meetings Tracked: ${report.meetingInsights.totalMeetings} | Decisions Formulated: ${report.meetingInsights.decisionsCount} | Open Action Items: ${report.meetingInsights.openActionItemsCount}`);

        if (report.meetingInsights.decisions.length > 0) {
          doc.moveDown(0.3);
          doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('Key Recorded Decisions:');
          report.meetingInsights.decisions.slice(0, 4).forEach((d) => {
            doc.fillColor(slateDark).fontSize(8).font('Helvetica')
              .text(`  • [${d.meetingTitle}] ${d.title}`);
          });
        }
        doc.moveDown(1);

        // ----------------- SECTION 6: AI RECOMMENDATIONS -----------------
        drawSectionHeader('AI Strategic Recommendations for Next Week', '6');

        if (report.recommendations.length === 0) {
          doc.fillColor(slateMuted).fontSize(8.5).font('Helvetica')
            .text('No critical recommendations generated. Workflow execution is performing within target parameters.');
        } else {
          report.recommendations.forEach((rec, idx) => {
            if (doc.y > 700) {
              doc.addPage();
              doc.y = 50;
            }
            const recY = doc.y;
            doc.roundedRect(40, recY, 515, 34, 4).fill(slateLight);

            // Badge
            const badgeColor = rec.priority === 'URGENT' ? alertRed : (rec.priority === 'HIGH' ? alertOrange : jadeColor);
            doc.fillColor(badgeColor).fontSize(7.5).font('Helvetica-Bold')
              .text(`[${rec.priority}] ${rec.category}`, 48, recY + 5);

            doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
              .text(rec.title, 140, recY + 5, { width: 400 });

            doc.fillColor(slateMuted).fontSize(7.5).font('Helvetica')
              .text(rec.rationale, 48, recY + 18, { width: 495, lineGap: 1 });

            doc.y = recY + 40;
          });
        }

        // ----------------- FOOTER / PAGE NUMBERS -----------------
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(40, 785).lineTo(555, 785).stroke();
          doc.fillColor(slateMuted)
            .fontSize(7.5)
            .font('Helvetica')
            .text(
              `Generated by NEXORA AI Work Operating System • Confidential & Proprietary`,
              40,
              792,
              { width: 350 },
            );
          doc.text(
            `Page ${i + 1} of ${range.count}`,
            455,
            792,
            { width: 100, align: 'right' },
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
