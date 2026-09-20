/**
 * Campaign Signal Validator — PDF Report Generator
 *
 * A lean 1-2 page report (verdict, score, reasons, remediation, methodology
 * footer) — deliberately not styled to match the Audit Engine's 5-page report
 * (services/export/pdfGenerator.ts). Enough to justify the standalone $650
 * purchase without a large design/build pass; can grow later if needed.
 */

import PDFDocument from 'pdfkit';
import type { EventVerdict } from './eventVerdict';
import { buildChainCopy } from '@/services/attribution/chainCopy';
import { lintChainCopy } from '@/services/attribution/chainCopyLint';
import logger from '@/utils/logger';

const C = {
  brand: '#4F46E5',
  strong: '#16A34A',
  moderate: '#D97706',
  weak: '#DC2626',
  darkText: '#111827',
  midText: '#374151',
  lightText: '#6B7280',
};

const SEVERITY_COLORS: Record<string, string> = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#2563EB',
};

const RATING_COLORS: Record<string, string> = {
  strong: C.strong,
  moderate: C.moderate,
  weak: C.weak,
};

export function generateSignalValidatorPdf(params: {
  url: string;
  verdict: EventVerdict;
  generatedAt: Date;
}): Promise<Buffer> {
  const { url, verdict, generatedAt } = params;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Atlas Campaign Signal Validator Report',
        Author: 'Atlas',
        CreationDate: generatedAt,
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width;
    const LEFT = 50;
    const CONTENT_W = PAGE_W - 100;

    // ── Header ─────────────────────────────────────────────────────────────
    doc.fillColor(C.brand).rect(0, 0, PAGE_W, 6).fill();
    doc.moveDown(2);
    doc.fillColor(C.darkText).fontSize(20).font('Helvetica-Bold')
      .text('Campaign Signal Validator', LEFT, 40);
    doc.fillColor(C.lightText).fontSize(10).font('Helvetica')
      .text(url, LEFT, 66)
      .text(`Generated ${generatedAt.toISOString().slice(0, 10)}`, LEFT, 80);

    doc.moveDown(3);

    // ── Verdict banner ────────────────────────────────────────────────────
    const bannerY = doc.y;
    const ratingColor = RATING_COLORS[verdict.rating] ?? C.midText;
    doc.fillColor(ratingColor).roundedRect(LEFT, bannerY, CONTENT_W, 70, 6).fill();
    doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
      .text(`Signal strength: ${verdict.rating.toUpperCase()}  (${verdict.score}/100)`, LEFT + 16, bannerY + 14);
    doc.fontSize(10).font('Helvetica')
      .text(`AI Max / automated-bidding risk: ${verdict.ai_max_risk.toUpperCase()}`, LEFT + 16, bannerY + 38);
    doc.text(verdict.summary, LEFT + 16, bannerY + 52, { width: CONTENT_W - 32 });

    doc.y = bannerY + 90;
    doc.moveDown(1);

    // ── Reasons ────────────────────────────────────────────────────────────
    doc.fillColor(C.darkText).fontSize(13).font('Helvetica-Bold').text('Findings', LEFT, doc.y);
    doc.moveDown(0.5);

    if (verdict.reasons.length === 0) {
      doc.fillColor(C.midText).fontSize(10).font('Helvetica')
        .text('No issues found — the primary conversion signal looks strong.', LEFT, doc.y);
    } else {
      for (const reason of verdict.reasons) {
        ensureSpace(doc, 60);
        const y = doc.y;
        doc.fillColor(SEVERITY_COLORS[reason.severity] ?? C.midText)
          .circle(LEFT + 4, y + 6, 4).fill();
        doc.fillColor(C.darkText).fontSize(11).font('Helvetica-Bold')
          .text(reason.headline, LEFT + 16, y, { width: CONTENT_W - 16 });
        doc.fillColor(C.midText).fontSize(9.5).font('Helvetica')
          .text(reason.detail, LEFT + 16, doc.y + 2, { width: CONTENT_W - 16 });
        doc.moveDown(0.8);
      }
    }

    // ── Remediation ────────────────────────────────────────────────────────
    if (verdict.remediation.length > 0) {
      ensureSpace(doc, 40);
      doc.moveDown(0.5);
      doc.fillColor(C.darkText).fontSize(13).font('Helvetica-Bold').text('Recommended next steps', LEFT, doc.y);
      doc.moveDown(0.5);
      for (const step of verdict.remediation) {
        ensureSpace(doc, 30);
        doc.fillColor(C.midText).fontSize(9.5).font('Helvetica')
          .text(`•  ${step}`, LEFT, doc.y, { width: CONTENT_W });
        doc.moveDown(0.4);
      }
    }

    // ── Attribution chain (Attribution Chain Check PRD §7/§8) — lead-gen only,
    // omitted entirely (not an empty heading) when this run has no chain
    // result, per Implementation Rule 12: never fabricate a section for
    // data that doesn't exist. Non-throwing lint check, matching the Audit
    // Engine PDF export's own convention (outputLint.ts is a hard gate on
    // the web report, a logged-not-blocking check on the PDF path) — a
    // lint violation here should never stop a paid customer's PDF from
    // generating.
    if (verdict.attribution_chain) {
      const copy = buildChainCopy(verdict.attribution_chain);
      const lintTexts = [copy.headline, copy.body, copy.remedy?.typical_cause, copy.remedy?.shape_of_work, copy.unverified_note].filter((s): s is string => !!s);
      const violations = lintChainCopy(lintTexts);
      if (violations.length > 0) {
        logger.warn({ violations }, '[signalValidator] Attribution chain copy failed the banned-token lint — rendering anyway');
      }

      ensureSpace(doc, 90);
      doc.moveDown(1);
      doc.fillColor(C.darkText).fontSize(13).font('Helvetica-Bold').text('Attribution chain (lead-gen)', LEFT, doc.y);
      doc.moveDown(0.4);
      doc.fillColor(C.darkText).fontSize(11).font('Helvetica-Bold').text(copy.headline, LEFT, doc.y, { width: CONTENT_W });
      doc.fillColor(C.midText).fontSize(9.5).font('Helvetica').text(copy.body, LEFT, doc.y + 4, { width: CONTENT_W });

      if (copy.remedy) {
        doc.moveDown(0.5);
        doc.fillColor(C.darkText).fontSize(10).font('Helvetica-Bold').text(copy.remedy.label, LEFT, doc.y, { width: CONTENT_W });
        doc.fillColor(C.midText).fontSize(9.5).font('Helvetica')
          .text(`Typical cause: ${copy.remedy.typical_cause}`, LEFT, doc.y + 2, { width: CONTENT_W })
          .text(copy.remedy.shape_of_work, LEFT, doc.y + 2, { width: CONTENT_W });
      }

      if (copy.unverified_note) {
        doc.moveDown(0.5);
        doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica').text(copy.unverified_note, LEFT, doc.y, { width: CONTENT_W });
      }
    }

    // ── Methodology footer ────────────────────────────────────────────────
    ensureSpace(doc, 70);
    doc.moveDown(1.5);
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + CONTENT_W, doc.y).strokeColor('#E5E7EB').stroke();
    doc.moveDown(0.5);
    doc.fillColor(C.lightText).fontSize(8).font('Helvetica')
      .text(
        'Methodology: this diagnostic evaluates the primary conversion signal from a lightweight ' +
        'site scan and (when available) Journey Builder stage data — it does not read live ' +
        'platform-configured conversion actions. Treat it as a pre-flight check, not a substitute ' +
        'for verifying the exact conversion action Google Ads/Meta is optimising against.',
        LEFT, doc.y, { width: CONTENT_W },
      );
    doc.text('Atlas — atlas.vimi.digital', LEFT, doc.y + 10);

    doc.end();
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottomMargin = 65;
  if (doc.y + needed > doc.page.height - bottomMargin) {
    doc.addPage();
  }
}
