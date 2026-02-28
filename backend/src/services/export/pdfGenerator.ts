/**
 * PDF Report Generator (Sprint 5)
 * Generates a 5-page PDF from a ReportJSON using PDFKit.
 */
import PDFDocument from 'pdfkit';
import type { ReportJSON } from '@/types/audit';

// ── Colour palette ─────────────────────────────────────────────────────────────
const C = {
  brand:    '#4F46E5',
  healthy:  '#16A34A',
  atRisk:   '#D97706',
  broken:   '#DC2626',
  darkText: '#111827',
  midText:  '#374151',
  lightText:'#6B7280',
  mutedText:'#9CA3AF',
  bgLight:  '#F3F4F6',
  bgAlt:    '#FAFAFA',
  white:    '#FFFFFF',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high:     '#EA580C',
  medium:   '#D97706',
  low:      '#2563EB',
};

const PLATFORM_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads:   'Meta Ads',
  ga4:        'Google Analytics 4',
  gtm:        'Google Tag Manager',
  sgtm:       'Server-side GTM',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status === 'healthy' || status === 'pass') return C.healthy;
  if (status === 'at_risk' || status === 'warning' || status === 'partially_broken') return C.atRisk;
  return C.broken;
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generatePDF(report: ReportJSON): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Atlas Signal Health Report',
        Author: 'Atlas',
        CreationDate: new Date(report.generated_at),
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const LEFT = 50;
    const CONTENT_W = PAGE_W - 100;
    const BOTTOM_MARGIN = 65; // leave this many px at the bottom before adding a page

    // ── Layout helpers ─────────────────────────────────────────────────────

    function topBar() {
      doc.fillColor(C.brand).rect(0, 0, PAGE_W, 6).fill();
    }

    function pageHeader(section: string, pageLabel: string) {
      topBar();
      const savedY = doc.y;
      doc.fillColor(C.lightText).fontSize(8).font('Helvetica')
        .text(`ATLAS SIGNAL HEALTH REPORT  ·  ${section}`, LEFT, 18)
        .fillColor(C.mutedText).text(pageLabel, LEFT, 18, { align: 'right', width: CONTENT_W });
      doc.y = Math.max(doc.y, savedY, 42);
    }

    function sectionHeading(title: string) {
      doc.moveDown(0.4);
      doc.fillColor(C.brand).fontSize(12).font('Helvetica-Bold').text(title, LEFT);
      doc.moveDown(0.1);
      doc.fillColor(C.mutedText).rect(LEFT, doc.y, CONTENT_W, 0.5).fill();
      doc.moveDown(0.45);
    }

    // Draw a small coloured pill. Saves/restores doc.y so it doesn't disturb flow.
    // Returns the width of the pill (including 5px gap) for chaining x positions.
    function pill(text: string, color: string, x: number, y: number): number {
      const savedY = doc.y;
      const textW = doc.font('Helvetica-Bold').fontSize(7.5).widthOfString(text);
      const w = textW + 14;
      doc.fillColor(color).roundedRect(x, y, w, 14, 3).fill();
      doc.fillColor(C.white).text(text, x + 7, y + 3);
      doc.y = savedY;
      return w + 5;
    }

    function needsNewPage(estimatedH: number): boolean {
      return doc.y + estimatedH > PAGE_H - BOTTOM_MARGIN;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 1 — Executive Summary
    // ══════════════════════════════════════════════════════════════════════

    topBar();

    const genDate = new Date(report.generated_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    doc.fillColor(C.darkText).fontSize(22).font('Helvetica-Bold')
      .text('Signal Health Report', LEFT, 56);
    doc.fillColor(C.lightText).fontSize(10).font('Helvetica')
      .text(`${genDate}  ·  Audit ID: ${report.audit_id}`, LEFT);

    doc.moveDown(0.8);

    // Overall status banner
    const { overall_status, business_summary, scores } = report.executive_summary;
    const bannerY = doc.y;
    const bannerColor = statusColor(overall_status);
    doc.fillColor(bannerColor).rect(LEFT, bannerY, CONTENT_W, 44).fill();
    doc.fillColor(C.white).fontSize(13).font('Helvetica-Bold')
      .text(formatLabel(overall_status), LEFT + 14, bannerY + 8);
    const bannerSub = business_summary.length > 100
      ? business_summary.slice(0, 97) + '…'
      : business_summary;
    doc.fillColor(C.white).fontSize(8.5).font('Helvetica')
      .text(bannerSub, LEFT + 14, bannerY + 28, { width: CONTENT_W - 28 });
    doc.y = bannerY + 54;

    // 4 Score cards (2×2 grid)
    sectionHeading('Scores at a Glance');

    const cardW = (CONTENT_W - 10) / 2;
    const cardH = 58;
    const gridStartY = doc.y;

    const scoreCards = [
      {
        label: 'Conversion Signal Health',
        value: `${scores.conversion_signal_health}/100`,
        color: scores.conversion_signal_health >= 80 ? C.healthy
             : scores.conversion_signal_health >= 60 ? C.atRisk
             : C.broken,
      },
      {
        label: 'Attribution Risk',
        value: scores.attribution_risk_level,
        color: scores.attribution_risk_level === 'Low' ? C.healthy
             : scores.attribution_risk_level === 'Medium' ? C.atRisk
             : C.broken,
      },
      {
        label: 'Optimization Strength',
        value: scores.optimization_strength,
        color: scores.optimization_strength === 'Strong' ? C.healthy
             : scores.optimization_strength === 'Moderate' ? C.atRisk
             : C.broken,
      },
      {
        label: 'Data Consistency',
        value: scores.data_consistency_score,
        color: scores.data_consistency_score === 'High' ? C.healthy
             : scores.data_consistency_score === 'Medium' ? C.atRisk
             : C.broken,
      },
    ];

    scoreCards.forEach((card, i) => {
      const cx = LEFT + (i % 2) * (cardW + 10);
      const cy = gridStartY + Math.floor(i / 2) * (cardH + 8);
      doc.fillColor(C.bgLight).rect(cx, cy, cardW, cardH).fill();
      doc.fillColor(card.color).rect(cx, cy, 3, cardH).fill();
      doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica')
        .text(card.label, cx + 12, cy + 10, { width: cardW - 20 });
      doc.fillColor(C.darkText).fontSize(18).font('Helvetica-Bold')
        .text(card.value, cx + 12, cy + 28);
    });

    doc.y = gridStartY + 2 * (cardH + 8) + 6;

    // Business summary
    sectionHeading('Business Summary');
    doc.fillColor(C.midText).fontSize(10).font('Helvetica')
      .text(business_summary, LEFT, doc.y, { width: CONTENT_W });

    // Quick rule stats
    doc.moveDown(0.8);
    sectionHeading('Rule Overview');
    const allResults = report.technical_appendix.validation_results;
    const passed   = allResults.filter((r) => r.status === 'pass').length;
    const failed   = allResults.filter((r) => r.status === 'fail').length;
    const warnings = allResults.filter((r) => r.status === 'warning').length;

    doc.fillColor(C.midText).fontSize(10).font('Helvetica')
      .text(`${allResults.length} rules validated  ·  `, LEFT, doc.y, { continued: true })
      .fillColor(C.healthy).text(`${passed} passed  ·  `, { continued: true })
      .fillColor(C.broken).text(`${failed} failed  ·  `, { continued: true })
      .fillColor(C.atRisk).text(`${warnings} warnings`);

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 2 — Journey Breakdown
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Journey Breakdown', 'Page 2 / 5');
    sectionHeading('Funnel Stage Analysis');

    for (const stage of report.journey_stages) {
      const estH = 34 + Math.max(stage.issues.length, 1) * 15 + 10;
      if (needsNewPage(estH)) {
        doc.addPage();
        pageHeader('Journey Breakdown', 'Page 2 / 5');
        sectionHeading('Funnel Stage Analysis (continued)');
      }

      const stageY = doc.y;
      const sc = statusColor(stage.status);

      doc.fillColor(C.bgLight).rect(LEFT, stageY, CONTENT_W, 26).fill();
      doc.fillColor(sc).circle(LEFT + 14, stageY + 13, 4).fill();
      doc.fillColor(C.darkText).fontSize(11).font('Helvetica-Bold')
        .text(stage.stage, LEFT + 26, stageY + 7);

      const savedY = doc.y;
      doc.fillColor(sc).fontSize(9).font('Helvetica')
        .text(formatLabel(stage.status), LEFT, stageY + 9, { align: 'right', width: CONTENT_W });
      doc.y = Math.max(savedY, stageY + 32);

      if (stage.issues.length === 0) {
        doc.fillColor(C.healthy).fontSize(9).font('Helvetica')
          .text('All checks passed for this stage', LEFT + 26, doc.y);
      } else {
        stage.issues.forEach((issue) => {
          doc.fillColor(C.broken).fontSize(9).font('Helvetica')
            .text(`\u2022  ${issue}`, LEFT + 26, doc.y, { width: CONTENT_W - 32 });
          doc.moveDown(0.2);
        });
      }
      doc.moveDown(0.6);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 3 — Platform Impact
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Platform Impact', 'Page 3 / 5');
    sectionHeading('Platform Health Summary');

    for (const platform of report.platform_breakdown) {
      const hasFailedRules = platform.failed_rules.length > 0;
      const cardHeight = hasFailedRules ? 90 : 74;
      if (needsNewPage(cardHeight + 12)) {
        doc.addPage();
        pageHeader('Platform Impact', 'Page 3 / 5');
        sectionHeading('Platform Health Summary (continued)');
      }

      const platY = doc.y;
      const pc = statusColor(platform.status);
      const platName = PLATFORM_LABELS[platform.platform] ?? formatLabel(platform.platform);

      doc.fillColor(C.bgLight).rect(LEFT, platY, CONTENT_W, cardHeight).fill();
      doc.fillColor(pc).rect(LEFT, platY, 4, cardHeight).fill();
      doc.fillColor(C.darkText).fontSize(12).font('Helvetica-Bold')
        .text(platName, LEFT + 14, platY + 11);
      pill(formatLabel(platform.status), pc, LEFT + CONTENT_W - 82, platY + 11);
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(platform.risk_explanation, LEFT + 14, platY + 32, { width: CONTENT_W - 100 });

      if (hasFailedRules) {
        const ruleList = platform.failed_rules.slice(0, 4)
          .map((r) => r.replace(/_/g, ' ')).join('  ·  ');
        const overflow = platform.failed_rules.length > 4
          ? ` +${platform.failed_rules.length - 4} more` : '';
        doc.fillColor(C.broken).fontSize(8).font('Helvetica')
          .text(`Failed: ${ruleList}${overflow}`, LEFT + 14, platY + 68, { width: CONTENT_W - 28 });
      }

      doc.y = platY + cardHeight + 10;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 4 — Issues & Fixes
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Issues & Fixes', 'Page 4 / 5');
    const issueCount = report.issues.length;
    sectionHeading(`Action Items \u2014 ${issueCount} issue${issueCount === 1 ? '' : 's'} found`);

    if (issueCount === 0) {
      doc.fillColor(C.healthy).fontSize(11).font('Helvetica')
        .text('No issues found \u2014 all 26 checks passed.', LEFT, doc.y);
    }

    for (let i = 0; i < report.issues.length; i++) {
      const issue = report.issues[i];
      const sevColor = SEVERITY_COLORS[issue.severity] ?? C.lightText;
      const CARD_H = 94;

      if (needsNewPage(CARD_H + 14)) {
        doc.addPage();
        pageHeader('Issues & Fixes', 'Page 4 / 5');
        sectionHeading('Action Items (continued)');
      }

      const issY = doc.y;

      doc.strokeColor(C.bgLight).lineWidth(1).rect(LEFT, issY, CONTENT_W, CARD_H).stroke();
      doc.fillColor(sevColor).rect(LEFT, issY, 4, CARD_H).fill();

      // Issue number + rule name
      doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
        .text(`#${i + 1}  ${issue.rule_id.replace(/_/g, ' ')}`, LEFT + 14, issY + 8, { width: CONTENT_W - 20 });

      // Pills row
      let pillX = LEFT + 14;
      const pillY = issY + 23;
      pillX += pill(issue.severity.toUpperCase(), sevColor, pillX, pillY);
      pillX += pill(issue.recommended_owner, C.lightText, pillX, pillY);
      const effortColor = issue.estimated_effort === 'low' ? C.healthy
        : issue.estimated_effort === 'medium' ? C.atRisk : C.broken;
      pill(`Effort: ${issue.estimated_effort}`, effortColor, pillX, pillY);

      // Problem (truncate if too long to fit)
      const problem = issue.problem.length > 110
        ? issue.problem.slice(0, 107) + '…'
        : issue.problem;
      doc.fillColor(C.darkText).fontSize(9.5).font('Helvetica-Bold')
        .text(problem, LEFT + 14, issY + 44, { width: CONTENT_W - 28 });

      // Fix summary
      const fix = issue.fix_summary.length > 120
        ? issue.fix_summary.slice(0, 117) + '…'
        : issue.fix_summary;
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(`Fix: ${fix}`, LEFT + 14, issY + 66, { width: CONTENT_W - 28 });

      doc.y = issY + CARD_H + 10;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 5 — Technical Appendix
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Technical Appendix', 'Page 5 / 5');
    sectionHeading('All Validation Results');

    const COL_RULE_X     = LEFT;
    const COL_LAYER_X    = LEFT + 185;
    const COL_STATUS_X   = LEFT + 310;
    const COL_SEVERITY_X = LEFT + 367;
    const ROW_H = 18;

    function drawTableHeader() {
      const hY = doc.y;
      doc.fillColor(C.bgLight).rect(LEFT, hY, CONTENT_W, ROW_H).fill();
      doc.fillColor(C.midText).fontSize(8).font('Helvetica-Bold')
        .text('Rule', COL_RULE_X + 4, hY + 5)
        .text('Layer', COL_LAYER_X + 4, hY + 5)
        .text('Status', COL_STATUS_X + 4, hY + 5)
        .text('Severity', COL_SEVERITY_X + 4, hY + 5);
      doc.y = hY + ROW_H;
    }

    drawTableHeader();

    allResults.forEach((result, i) => {
      if (needsNewPage(ROW_H + 10)) {
        doc.addPage();
        pageHeader('Technical Appendix', 'Page 5 / 5');
        sectionHeading('Validation Results (continued)');
        drawTableHeader();
      }

      const rowY = doc.y;
      if (i % 2 === 0) doc.fillColor(C.bgAlt).rect(LEFT, rowY, CONTENT_W, ROW_H).fill();

      const sc   = statusColor(result.status);
      const sevc = SEVERITY_COLORS[result.severity] ?? C.lightText;

      doc.fillColor(C.midText).fontSize(7.5).font('Helvetica')
        .text(result.rule_id.replace(/_/g, ' '), COL_RULE_X + 4, rowY + 5, { width: 176 });
      doc.fillColor(C.lightText)
        .text(result.validation_layer.replace(/_/g, ' '), COL_LAYER_X + 4, rowY + 5, { width: 118 });
      doc.fillColor(sc).font('Helvetica-Bold')
        .text(result.status.toUpperCase(), COL_STATUS_X + 4, rowY + 5, { width: 54 });
      doc.fillColor(sevc)
        .text(result.severity.toUpperCase(), COL_SEVERITY_X + 4, rowY + 5, { width: 70 });

      doc.y = rowY + ROW_H;
    });

    // Footer
    doc.moveDown(1.5);
    doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
      .text(
        'Generated by Atlas Signal Health Platform  \u00b7  atlas.io',
        LEFT, doc.y, { align: 'center', width: CONTENT_W },
      );

    doc.end();
  });
}
