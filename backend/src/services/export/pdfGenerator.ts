/**
 * PDF Report Generator (Sprint 5; rewritten for the Signal Health Report:
 * Evidence Integrity & Presentation PRD — see docs/atlas-sprint-plan-
 * signal-health-report-fixes.md for the earlier sprint plan this PRD
 * folds Sprint 6 into).
 * Generates a PDF from a ReportJSON using PDFKit — page count now varies
 * with content instead of being a fixed 5 (see real page numbering below).
 */
import PDFDocument from 'pdfkit';
import type { ReportJSON, ValidationResult, ReportIssue, StepCoverage, StepUrlSource, ScoreCoverage } from '@/types/audit';

/** Per-step provenance label for the Scan Coverage section — see StepUrlSource's docstring in types/audit.ts. */
const STEP_SOURCE_LABELS: Record<StepUrlSource, string> = {
  user_supplied: 'user-supplied URL',
  sitemap: 'found via sitemap',
  nav_link: 'found via page link',
  heuristic: 'found via path guess',
  fallback_landing: 'not found — used the landing page',
};

function stepCoverageLine(step: StepCoverage): string {
  const sourceLabel = STEP_SOURCE_LABELS[step.source] ?? step.source;
  const navSuffix = step.navigation_success ? '' : ' — navigation failed';
  // Platform Attribution & Determinism PRD B-W3 — a step that navigated
  // "successfully" but never settled (or whose waitFor timed out) still
  // needs to say so; navigation_success alone can't distinguish it.
  const degradedSuffix = step.navigation_success && step.degraded ? ' — did not fully settle' : '';
  return `${step.step.replace(/_/g, ' ')} — ${sourceLabel}${navSuffix}${degradedSuffix}`;
}

/**
 * Rule Overview stats for page 1 (and the row set for the Technical Appendix
 * table) — excludes 'skipped' results (funnel-inapplicable rules, rules
 * requiring a GTM container connection this scan doesn't have, or results
 * suppressed by the fallback_landing cross-reference before this report was
 * built — see coverageSuppression.ts) so the headline "N checks" matches
 * what the appendix actually lists, rather than the full rule library size.
 */
export function computeRuleOverviewStats(validationResults: ValidationResult[]): {
  validated: ValidationResult[];
  passed: number;
  failed: number;
  warnings: number;
} {
  const validated = validationResults.filter((r) => r.status !== 'skipped');
  return {
    validated,
    passed: validated.filter((r) => r.status === 'pass').length,
    failed: validated.filter((r) => r.status === 'fail').length,
    warnings: validated.filter((r) => r.status === 'warning').length,
  };
}

/** "1 warning" / "0 warnings" / "2 warnings" — the Rule Overview headline's warning count needs the same singular/plural agreement its "passed"/"failed" neighbours never needed (they're rarely 1 in practice, but count-dependent nouns should agree regardless). */
export function formatWarningsLabel(warnings: number): string {
  return `${warnings} warning${warnings === 1 ? '' : 's'}`;
}

/**
 * Total issue count + critical subset, computed once from report.issues (PRD
 * §3.5/W4 — "reconcile the counts") so every section that needs to state
 * "N issues, M of them critical" reads the same two numbers instead of each
 * recomputing its own, potentially different, subset.
 */
export function computeIssueTotals(issues: ReportIssue[]): { total: number; critical: number } {
  return { total: issues.length, critical: issues.filter((i) => i.severity === 'critical').length };
}

// ── Evidence ordering & display (PRD §3.1/W1) ──────────────────────────────────

/** The identifying prefix of an evidence line — text before the first ':' or '(' — e.g. "ttclid" from "ttclid: 1d (needs 7d)" or "ttclid (1d, needs 7d)". */
function evidenceKey(item: string): string {
  const colonIdx = item.indexOf(':');
  const parenIdx = item.indexOf('(');
  const candidates = [colonIdx, parenIdx].filter((i) => i > 0);
  const cut = candidates.length > 0 ? Math.min(...candidates) : item.length;
  return item.slice(0, cut).trim();
}

/**
 * Orders evidence so items the rule's own failure message (technical_details
 * .found) calls out by name come first — e.g. found = "4 cookie(s) shorter
 * than their attribution window: ttclid (1d, needs 7d), ..." puts the
 * ttclid evidence line ahead of gclid/fbclid/msclkid's, so a capped list
 * never hides the exact item the claim is about (PRD's Item #11 example).
 * A no-op (stable original order) when found doesn't name any evidence key
 * — e.g. "0/5 UTM parameters captured" names no specific parameter, so all
 * five evidence lines are equally "the reason," and the fix for that case
 * is the cap + overflow line below, not reordering.
 */
export function orderEvidenceByRelevance(found: string, evidence: string[]): string[] {
  const referenced: string[] = [];
  const rest: string[] = [];
  for (const item of evidence) {
    const key = evidenceKey(item);
    if (key.length >= 2 && found.includes(key)) referenced.push(item);
    else rest.push(item);
  }
  return [...referenced, ...rest];
}

/** Evidence lines never omitted silently past this count — the rest are named in an explicit "+N more" line instead. */
export const EVIDENCE_CAP = 6;

/**
 * The exact set of evidence lines a card renders, plus how many were left
 * out — the single function both the height-measurement pass and the
 * drawing pass call, so they can never disagree about what's shown (PRD
 * §3.1/W1: "never omit silently"). Ordering runs first (orderEvidenceByRelevance)
 * so a capped list keeps the item the failure message names, then each
 * shown line is passed through smartTruncateEvidence for the one genuinely
 * unbounded case (an embedded URL).
 */
export function selectDisplayedEvidence(found: string, evidence: string[]): { shown: string[]; hiddenCount: number } {
  const ordered = orderEvidenceByRelevance(found, evidence);
  const shown = ordered.slice(0, EVIDENCE_CAP).map((e) => smartTruncateEvidence(e));
  return { shown, hiddenCount: ordered.length - shown.length };
}

/**
 * Truncates only the genuinely unbounded case — a URL — keeping its
 * informative end (the query string / path tail) rather than its first N
 * characters, which for a URL is almost always just the scheme and host.
 * Any other long string is left alone; the caller lets PDFKit wrap it
 * instead of cutting it (PRD §3.1's line-601 fix).
 */
export function smartTruncateEvidence(text: string, maxLen = 180): string {
  if (text.length <= maxLen) return text;
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!urlMatch) return text;
  const url = urlMatch[0];
  const prefix = text.slice(0, text.indexOf(url));
  const KEEP_TAIL = 90;
  if (url.length <= KEEP_TAIL + 24) return text;
  const truncatedUrl = `${url.slice(0, 24)}…${url.slice(-KEEP_TAIL)}`;
  return `${prefix}${truncatedUrl}`;
}

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
  partial:  '#7C7C8A',
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

const TAG_PLATFORM_LABELS: Record<string, string> = {
  ga4:              'Google Analytics 4',
  meta_pixel:       'Meta Pixel',
  google_ads:       'Google Ads',
  linkedin_insight: 'LinkedIn Insight Tag',
  tiktok_pixel:     'TikTok Pixel',
  microsoft_uet:    'Microsoft UET',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status === 'healthy' || status === 'pass') return C.healthy;
  if (status === 'at_risk' || status === 'warning' || status === 'partially_broken') return C.atRisk;
  if (status === 'not_run' || status === 'skipped' || status === 'not_included') return '#9CA3AF';
  return C.broken;
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Banner sub-text needs to stay short — it's a fixed-role teaser, the full
// business_summary already renders unabridged in the Business Summary
// section below it — but a hard character-count slice can cut a narrative
// sentence mid-word (PRD §3.2/W2's ~99). Prefer the first full sentence;
// only fall back to a hard slice — at a ceiling well above any authored
// sentence length, not 100 — if that one sentence is itself pathological.
function bannerHeadline(text: string, maxLen = 280): string {
  const firstSentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return firstSentence.length > maxLen ? firstSentence.slice(0, maxLen - 1) + '…' : firstSentence;
}

// ── Score card presentation (PRD §3.6/W5) ──────────────────────────────────────

/** Whether a score's constituent layers were only partly exercised this run — the case where a confident qualitative label would overclaim. */
export function isPartialCoverage(coverage: ScoreCoverage | undefined): boolean {
  if (!coverage) return false;
  return coverage.layers_total > 0 && coverage.layers_tested < coverage.layers_total;
}

function coverageSuffix(coverage: ScoreCoverage | undefined): string {
  if (!coverage || coverage.layers_total <= 1) return '';
  return ` (${coverage.layers_tested} of ${coverage.layers_total} layers scanned)`;
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generatePDF(report: ReportJSON): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
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

    // ── Real page numbering (PRD §3.3/W6) ──────────────────────────────────
    // pageHeader() defers the "Page N / TOTAL" fraction until every page has
    // been laid out — it can't know TOTAL while still generating content,
    // and hardcoding "Page 2 / 5" (the original bug) goes stale the moment
    // any section grows past its assumed page count. The section-name half
    // of the header is drawn immediately (it doesn't depend on total page
    // count); the numeric half is recorded by absolute page index and
    // filled in during a post-pass right before doc.end(). The IHC page's
    // literal 'IHC' badge is a deliberate exception (not a numbered
    // sequential page — see pageHeader's pageLabelOverride) and is left as-is.
    const numberedPageIndices: number[] = [];

    // ── Layout helpers ─────────────────────────────────────────────────────

    function topBar() {
      doc.fillColor(C.brand).rect(0, 0, PAGE_W, 6).fill();
    }

    function pageHeader(section: string, pageLabelOverride?: string) {
      topBar();
      const savedY = doc.y;
      doc.fillColor(C.lightText).fontSize(8).font('Helvetica')
        .text(`ATLAS SIGNAL HEALTH REPORT  ·  ${section}`, LEFT, 18);
      if (pageLabelOverride) {
        doc.fillColor(C.mutedText).text(pageLabelOverride, LEFT, 18, { align: 'right', width: CONTENT_W });
      } else {
        const { start, count } = doc.bufferedPageRange();
        numberedPageIndices.push(start + count - 1);
      }
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
    doc.fillColor(C.midText).fontSize(11).font('Helvetica-Bold')
      .text(report.website_url, LEFT);
    doc.fillColor(C.lightText).fontSize(10).font('Helvetica')
      .text(`${genDate}  ·  Audit ID: ${report.audit_id}`, LEFT);

    doc.moveDown(0.8);

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 1 (cont.) — How to read this report (Report Honesty PRD Part C) —
    // moved to the front of the report so a reader sees Atlas's own caveats
    // about scan methodology before any score or finding, not after. Static
    // copy: never templated per-audit.
    // ══════════════════════════════════════════════════════════════════════

    sectionHeading('How to read this report');

    const HOW_TO_READ_PARAGRAPHS = [
      'This is a first-pass technical scan. It was run from outside your systems, without access to your ad accounts, and without a conversation with whoever built your measurement setup. Three things follow from that.',
      'We observed one crawl, from one location, at one moment. A tag that fires conditionally, or a page that behaves differently for signed-in users or in another region, may not appear here as it does for your customers.',
      "We can see what your site does, not what it reports. Match rates, conversion values, attribution windows and platform-side configuration all sit inside your ad accounts, which we have not seen.",
      'We cannot tell deliberate from accidental. A second container may be a migration in progress. An undeclared tag may be a channel we were not told about. A missing tag may mean that platform runs through a different property entirely. Where that distinction matters, we have raised it as a question rather than a finding.',
      'Findings without a confirmation marker were observed consistently and are unlikely to be artefacts of the scan. Findings marked Needs confirmation rest on a single observation or a page we could not fully verify, and should be checked before anyone acts on them.',
    ];
    for (const paragraph of HOW_TO_READ_PARAGRAPHS) {
      doc.fillColor(C.midText).fontSize(10).font('Helvetica')
        .text(paragraph, LEFT, doc.y, { width: CONTENT_W });
      doc.moveDown(0.6);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE 2 — Executive Summary
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Executive Summary');

    // Overall status banner — height is measured, not fixed, so a longer
    // (but still capped) sub-text never gets clipped by a too-short box.
    const { overall_status, business_summary, scores } = report.executive_summary;
    const bannerY = doc.y;
    const bannerColor = statusColor(overall_status);
    const bannerSub = bannerHeadline(business_summary);
    const bannerSubH = doc.fontSize(8.5).font('Helvetica').heightOfString(bannerSub, { width: CONTENT_W - 28 });
    const bannerH = Math.max(44, 28 + bannerSubH + 10);
    doc.fillColor(bannerColor).rect(LEFT, bannerY, CONTENT_W, bannerH).fill();
    doc.fillColor(C.white).fontSize(13).font('Helvetica-Bold')
      .text(formatLabel(overall_status), LEFT + 14, bannerY + 8);
    doc.fillColor(C.white).fontSize(8.5).font('Helvetica')
      .text(bannerSub, LEFT + 14, bannerY + 28, { width: CONTENT_W - 28 });
    doc.y = bannerY + bannerH + 10;

    // 4 Score cards (2×2 grid)
    sectionHeading('Scores at a Glance');

    const cardW = (CONTENT_W - 10) / 2;
    const cardH = 78;
    const gridStartY = doc.y;

    // Any declared platform rated Broken gates the qualitative wording below
    // (PRD §3.6/W5 — "nothing renders as Strong or Low risk while a
    // declared platform is Broken") — computed once here from
    // platform_breakdown, which scoring.ts itself never sees.
    const anyPlatformBroken = report.platform_breakdown.some((p) => p.status === 'broken');

    const optimizationPartial = isPartialCoverage(scores.optimization_strength_coverage);
    const attributionPartial = isPartialCoverage(scores.attribution_risk_coverage);
    const consistencyPartial = isPartialCoverage(scores.data_consistency_coverage);

    // Optimization Strength display value — never "Strong" on partial
    // layer coverage or while a platform is Broken; the underlying
    // categorical score is left untouched (still available to any other
    // consumer), only this card's rendered text/color is capped.
    const optimizationCapped = optimizationPartial || (anyPlatformBroken && scores.optimization_strength === 'Strong');
    const optimizationDisplay = optimizationCapped && scores.optimization_strength === 'Strong'
      ? 'Moderate*' : scores.optimization_strength;
    const optimizationColor = optimizationPartial ? C.partial
      : optimizationDisplay.startsWith('Strong') ? C.healthy
      : optimizationDisplay.startsWith('Moderate') ? C.atRisk : C.broken;

    // Attribution Risk display value — never "Low" (claiming low risk)
    // while a platform is Broken.
    const attributionCapped = anyPlatformBroken && scores.attribution_risk_level === 'Low';
    const attributionDisplay = attributionCapped ? 'Medium*' : scores.attribution_risk_level;
    const attributionColor = attributionPartial ? C.partial
      : attributionDisplay.startsWith('Low') ? C.healthy
      : attributionDisplay.startsWith('Medium') ? C.atRisk : C.broken;

    const consistencyColor = consistencyPartial ? C.partial
      : scores.data_consistency_score === 'High' ? C.healthy
      : scores.data_consistency_score === 'Medium' ? C.atRisk : C.broken;

    const conversionCoverage = scores.conversion_signal_health_coverage;
    const conversionDescription = conversionCoverage && conversionCoverage.layers_total > 0
      ? `Overall signal quality across ${conversionCoverage.layers_tested} of ${conversionCoverage.layers_total} layers scanned (100 = fully healthy)`
      : 'Overall signal quality (100 = fully healthy)';

    const scoreCards = [
      {
        label: 'Conversion Signal Health',
        value: `${scores.conversion_signal_health}/100`,
        description: conversionDescription,
        color: scores.conversion_signal_health >= 80 ? C.healthy
             : scores.conversion_signal_health >= 60 ? C.atRisk
             : C.broken,
      },
      {
        label: `Attribution Risk${attributionPartial ? ' (partial)' : ''} — Click ID & Storage`,
        value: attributionDisplay,
        description: (attributionCapped
          ? 'A declared platform is Broken — risk cannot be "Low" while that holds.'
          : attributionDisplay === 'Low'
          ? 'Ad attribution is well-configured — low is best'
          : attributionDisplay === 'Medium'
          ? 'Some attribution gaps present — low is best'
          : 'Significant attribution gaps — low is best') + coverageSuffix(scores.attribution_risk_coverage),
        color: attributionColor,
      },
      {
        label: `Optimization Strength${optimizationPartial ? ' (partial)' : ''} — Parameters & Identity`,
        value: optimizationDisplay,
        description: (optimizationPartial
          ? 'Not enough of this score\'s layers ran to give a confident rating.'
          : optimizationCapped
          ? 'A declared platform is Broken — capped below "Strong" until that\'s fixed.'
          : optimizationDisplay === 'Strong'
          ? 'Sufficient signals for smart bidding — strong is best'
          : optimizationDisplay === 'Moderate'
          ? 'Partial signals available — strong is best'
          : 'Insufficient signals for smart bidding — strong is best') + coverageSuffix(scores.optimization_strength_coverage),
        color: optimizationColor,
      },
      {
        label: `Data Consistency${consistencyPartial ? ' (partial)' : ''} — Hygiene & Integrity`,
        value: scores.data_consistency_score,
        description: (consistencyPartial
          ? 'Not enough of this score\'s layer ran to give a confident rating.'
          : scores.data_consistency_score === 'High'
          ? 'Data is consistent across platforms — high is best'
          : scores.data_consistency_score === 'Medium'
          ? 'Some data inconsistencies detected — high is best'
          : 'Significant data inconsistencies detected — high is best') + coverageSuffix(scores.data_consistency_coverage),
        color: consistencyColor,
      },
    ];

    scoreCards.forEach((card, i) => {
      const cx = LEFT + (i % 2) * (cardW + 10);
      const cy = gridStartY + Math.floor(i / 2) * (cardH + 8);
      doc.fillColor(C.bgLight).rect(cx, cy, cardW, cardH).fill();
      doc.fillColor(card.color).rect(cx, cy, 3, cardH).fill();
      doc.fillColor(C.lightText).fontSize(8).font('Helvetica')
        .text(card.label, cx + 12, cy + 8, { width: cardW - 20 });
      doc.fillColor(C.darkText).fontSize(17).font('Helvetica-Bold')
        .text(card.value, cx + 12, cy + 27);
      doc.fillColor(C.mutedText).fontSize(7.2).font('Helvetica')
        .text(card.description, cx + 12, cy + 52, { width: cardW - 24 });
    });

    doc.y = gridStartY + 2 * (cardH + 8) + 6;

    if (optimizationCapped || attributionCapped || optimizationPartial || attributionPartial || consistencyPartial) {
      doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica')
        .text('* Capped or marked partial — see each card\'s description for why a confident label isn\'t shown.', LEFT, doc.y, { width: CONTENT_W });
      doc.moveDown(0.3);
    }

    // Scan Coverage — omitted entirely when the report has no coverage data
    // (Journey-Builder mode, an audit predating this field) rather than
    // rendering a fabricated "0 pages" state, per CLAUDE.md rule 12.
    const coverage = report.executive_summary.coverage;
    if (coverage) {
      sectionHeading('Scan Coverage');
      doc.fillColor(C.midText).fontSize(10).font('Helvetica')
        .text(
          `This scan examined ${coverage.pages_distinct} of ${coverage.pages_requested} requested page${coverage.pages_requested !== 1 ? 's' : ''}.`,
          LEFT, doc.y, { width: CONTENT_W },
        );

      // Report Correctness Programme PRD Part D2 — "not applicable" (this
      // site's own declared configuration means the layer has nothing to
      // check) rendered visibly distinct from "not scanned" (in scope, but
      // this run's crawl didn't get there) — a site with no cross-domain
      // journey isn't deficient for L4 not running, and must not read like
      // the layers this run genuinely failed to cover.
      const notScannedLayers = coverage.layers_not_tested.filter((l) => l.state === 'not_scanned');
      const notApplicableLayers = coverage.layers_not_tested.filter((l) => l.state === 'not_applicable');

      if (notScannedLayers.length > 0) {
        doc.moveDown(0.3);
        doc.fillColor(C.atRisk).fontSize(9).font('Helvetica-Bold')
          .text(
            `${notScannedLayers.map((l) => l.label).join(', ')} could not be scanned this run — ${coverage.rules_not_tested} check${coverage.rules_not_tested !== 1 ? 's' : ''} skipped rather than scored as failing.`,
            LEFT, doc.y, { width: CONTENT_W },
          );
      }

      if (notApplicableLayers.length > 0) {
        doc.moveDown(0.3);
        doc.fillColor(C.lightText).fontSize(9).font('Helvetica')
          .text(
            `Not applicable to this site: ${notApplicableLayers.map((l) => l.label).join(', ')}.`,
            LEFT, doc.y, { width: CONTENT_W },
          );
      }

      // Partial run (Platform Attribution & Determinism PRD B-W3) — surfaced
      // the same way layers_not_tested already is: a scan whose navigation
      // didn't fully settle on one or more steps shouldn't have its
      // absence-implying verdicts read as confidently as a clean run's (see
      // "Could Not Be Assessed" below for the results this actually moved).
      if (coverage.partial) {
        doc.moveDown(0.3);
        doc.fillColor(C.atRisk).fontSize(9).font('Helvetica-Bold')
          .text(
            `This scan didn't fully settle on ${coverage.degraded_steps.length} step${coverage.degraded_steps.length !== 1 ? 's' : ''} (${coverage.degraded_steps.join(', ')}) — treat any "not observed" result tied to those steps as inconclusive, not a confirmed pass or fail.`,
            LEFT, doc.y, { width: CONTENT_W },
          );
      }

      doc.moveDown(0.35);
      for (const step of coverage.steps) {
        doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica')
          .text(`• ${stepCoverageLine(step)}`, LEFT + 4, doc.y, { width: CONTENT_W - 8 });
      }
    }

    // Could not be assessed (PRD §5/W3 — "suppress, do not annotate") —
    // findings whose evidence named a step the scan substituted the
    // landing page for. Never counted in issues, scores, or breakdowns;
    // listed here so the report stays honest about what it skipped rather
    // than silently dropping it with no trace.
    if (report.could_not_be_assessed && report.could_not_be_assessed.length > 0) {
      sectionHeading('Could Not Be Assessed');
      // Report Correctness Programme PRD Part B4 — generic preamble, since
      // this section now has two distinct exclusion causes (a page the
      // scan couldn't reach and substituted the landing page for, or a step
      // whose navigation didn't fully settle before the check ran); each
      // item below already states its own specific reason. Also fixes the
      // "used the landing page for instead" typo.
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(
          'These checks are excluded from every count and score above — each one names its own reason below, rather than being reported as a finding.',
          LEFT, doc.y, { width: CONTENT_W },
        );
      doc.moveDown(0.3);
      for (const item of report.could_not_be_assessed) {
        doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica')
          .text(`• ${item.rule_id.replace(/_/g, ' ')} — ${item.reason}`, LEFT + 4, doc.y, { width: CONTENT_W - 8 });
        doc.moveDown(0.15);
      }
    }

    // Business summary
    sectionHeading('Business Summary');
    doc.fillColor(C.midText).fontSize(10).font('Helvetica')
      .text(business_summary, LEFT, doc.y, { width: CONTENT_W });

    // Quick rule stats
    doc.moveDown(0.8);
    sectionHeading('Rule Overview');
    const allResults = report.technical_appendix.validation_results;
    const { validated: validatedResults, passed, failed, warnings } = computeRuleOverviewStats(allResults);
    const issueTotals = computeIssueTotals(report.issues);

    doc.fillColor(C.midText).fontSize(10).font('Helvetica')
      .text(`${validatedResults.length} checks  ·  `, LEFT, doc.y, { continued: true })
      .fillColor(C.healthy).text(`${passed} passed  ·  `, { continued: true })
      .fillColor(C.broken).text(`${failed} failed  ·  `, { continued: true })
      .fillColor(C.atRisk).text(formatWarningsLabel(warnings));

    // Reconciliation line (PRD §3.5/W4 — "reconcile the counts"): states
    // the relationship between this section's failed+warning total and the
    // Action Items pages' issue count, instead of leaving two numbers that
    // describe the same underlying set unlinked on the page.
    if (issueTotals.total > 0) {
      doc.moveDown(0.15);
      doc.fillColor(C.mutedText).fontSize(8.5).font('Helvetica')
        .text(
          `→ ${issueTotals.total} of these are listed as action items on the pages that follow (${issueTotals.critical} critical).`,
          LEFT, doc.y, { width: CONTENT_W },
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE — Open Questions (Report Honesty PRD §B3) — its own page right
    // after Executive Summary, so a reader who never reaches the appendix
    // still sees Atlas asking rather than pronouncing. Omitted entirely (no
    // page added) when this run raised nothing to ask.
    // ══════════════════════════════════════════════════════════════════════

    if (report.open_questions && report.open_questions.length > 0) {
      doc.addPage();
      pageHeader('Open Questions');
      sectionHeading('Open Questions');
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(
          'These are configurations whose intent only you can confirm — not defects, but worth a quick answer before anyone acts on the findings below.',
          LEFT, doc.y, { width: CONTENT_W },
        );
      doc.moveDown(0.3);
      for (const question of report.open_questions) {
        doc.fillColor(C.darkText).fontSize(9.5).font('Helvetica')
          .text(`•  ${question}`, LEFT + 4, doc.y, { width: CONTENT_W - 8 });
        doc.moveDown(0.2);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE — Platform Impact
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Platform Impact');
    sectionHeading('Platform Health Summary');

    for (const platform of report.platform_breakdown) {
      const isNotIncluded = platform.status === 'not_included';
      const hasFailedRules = platform.failed_rules.length > 0;
      const cardHeight = hasFailedRules ? 90 : 74;
      if (needsNewPage(cardHeight + 12)) {
        doc.addPage();
        pageHeader('Platform Impact');
        sectionHeading('Platform Health Summary (continued)');
      }

      const platY = doc.y;
      const pc = statusColor(platform.status);
      const platName = PLATFORM_LABELS[platform.platform] ?? formatLabel(platform.platform);
      const pillLabel = isNotIncluded ? 'Not Included' : formatLabel(platform.status);

      doc.fillColor(C.bgLight).rect(LEFT, platY, CONTENT_W, cardHeight).fill();
      doc.fillColor(pc).rect(LEFT, platY, 4, cardHeight).fill();
      doc.fillColor(isNotIncluded ? C.lightText : C.darkText).fontSize(12).font('Helvetica-Bold')
        .text(platName, LEFT + 14, platY + 11);
      pill(pillLabel, pc, LEFT + CONTENT_W - 100, platY + 11);
      doc.fillColor(isNotIncluded ? C.mutedText : C.midText).fontSize(9).font('Helvetica')
        .text(platform.risk_explanation, LEFT + 14, platY + 32, { width: CONTENT_W - 110 });

      if (hasFailedRules) {
        // Report Correctness Programme PRD Part B1 — always the rule name,
        // never getIssueHeadline()'s v1-dict lookup (a same-named entry
        // gives one rule a full prose sentence here while its siblings with
        // no entry get their raw rule_id, producing a mixed "Failed: X ·
        // <sentence> · Y" line). Same rule_id → readable-label formatting
        // the Technical Appendix table already uses, so a reader can find
        // the full impact sentence for any of these in Issues & Fixes.
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

    // ── Configuration Health section (tag_configuration + implementation_drift) ─

    const configIssues = report.issues.filter(
      (iss) => iss.validation_layer === 'tag_configuration' || iss.validation_layer === 'implementation_drift',
    );

    // Measures the natural (unwrapped-then-wrapped) height of a problem +
    // "Fix: ..." pair at their real font sizes — PRD §3.2/W2: height is the
    // only constraint now that neither string is truncated, so the card
    // has to know its own real size before it's drawn.
    function measureProblemFixHeight(problem: string, fix: string, width: number): { problemH: number; fixH: number } {
      doc.font('Helvetica-Bold').fontSize(9.5);
      const problemH = doc.heightOfString(problem, { width });
      doc.font('Helvetica').fontSize(9);
      const fixH = doc.heightOfString(`Fix: ${fix}`, { width });
      return { problemH, fixH };
    }

    // Report Correctness Programme PRD Part B2 — the unconditional
    // structure every action item now follows: rule name as heading
    // (issue.problem — see v2Heading() in interpretation/engine.ts),
    // impact sentence beneath (issue.why_it_matters), then "Fix: ...".
    // Omitted only when why_it_matters is empty or identical to problem
    // (nothing distinct left to add on its own line).
    function measureWhyItMattersHeight(problem: string, whyItMatters: string, width: number): number {
      if (!whyItMatters || whyItMatters === problem) return 0;
      doc.font('Helvetica-Oblique').fontSize(8.5);
      return doc.heightOfString(whyItMatters, { width });
    }

    function drawWhyItMatters(problem: string, whyItMatters: string, x: number, y: number, width: number): void {
      if (!whyItMatters || whyItMatters === problem) return;
      doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica-Oblique')
        .text(whyItMatters, x, y, { width });
    }

    if (configIssues.length > 0) {
      doc.addPage();
      pageHeader('Configuration Health', 'IHC');

      const tagConfigIssues = configIssues.filter((iss) => iss.validation_layer === 'tag_configuration');
      const driftIssues     = configIssues.filter((iss) => iss.validation_layer === 'implementation_drift');

      const critCount = configIssues.filter((i) => i.severity === 'critical').length;
      const highCount  = configIssues.filter((i) => i.severity === 'high').length;
      const medCount   = configIssues.filter((i) => i.severity === 'medium').length;

      sectionHeading(`Configuration Health — ${configIssues.length} finding${configIssues.length !== 1 ? 's' : ''}`);

      const summaryY = doc.y;
      const barW = CONTENT_W / 3 - 6;
      const summaryCells = [
        { label: 'Critical', count: critCount, color: SEVERITY_COLORS['critical'] },
        { label: 'High',     count: highCount,  color: SEVERITY_COLORS['high'] },
        { label: 'Medium',   count: medCount,   color: SEVERITY_COLORS['medium'] },
      ];
      summaryCells.forEach((cell, i) => {
        const cx = LEFT + i * (barW + 9);
        doc.fillColor(C.bgLight).rect(cx, summaryY, barW, 40).fill();
        doc.fillColor(cell.color).rect(cx, summaryY, 3, 40).fill();
        doc.fillColor(cell.color).fontSize(18).font('Helvetica-Bold').text(String(cell.count), cx + 12, summaryY + 5);
        doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica').text(cell.label, cx + 12, summaryY + 27);
      });
      doc.y = summaryY + 52;

      const renderConfigSection = (issues: typeof configIssues, sectionTitle: string) => {
        if (issues.length === 0) return;
        sectionHeading(sectionTitle);
        issues.forEach((issue) => {
          const sevColor = SEVERITY_COLORS[issue.severity] ?? C.lightText;
          const TEXT_W = CONTENT_W - 28;
          const { problemH, fixH } = measureProblemFixHeight(issue.problem, issue.fix_summary, TEXT_W);
          const whyH = measureWhyItMattersHeight(issue.problem, issue.why_it_matters, TEXT_W);
          const CARD_H = 28 + problemH + (whyH > 0 ? 4 + whyH : 0) + 6 + fixH + 14;
          if (needsNewPage(CARD_H + 14)) {
            doc.addPage();
            pageHeader('Configuration Health', 'IHC');
            sectionHeading(`${sectionTitle} (continued)`);
          }
          const issY = doc.y;
          doc.strokeColor(C.bgLight).lineWidth(1).rect(LEFT, issY, CONTENT_W, CARD_H).stroke();
          doc.fillColor(sevColor).rect(LEFT, issY, 4, CARD_H).fill();
          // No raw rule_id caption here — this page is marketer-facing. The
          // rule_id is still available in the Technical Appendix table.
          let pillX = LEFT + 14;
          const pillY = issY + 8;
          pillX += pill(issue.severity.toUpperCase(), sevColor, pillX, pillY);
          pillX += pill(issue.recommended_owner, C.lightText, pillX, pillY);
          const effortColor = issue.estimated_effort === 'low' ? C.healthy
            : issue.estimated_effort === 'medium' ? C.atRisk : C.broken;
          pill(`Effort: ${issue.estimated_effort}`, effortColor, pillX, pillY);
          doc.fillColor(C.darkText).fontSize(9.5).font('Helvetica-Bold')
            .text(issue.problem, LEFT + 14, issY + 28, { width: TEXT_W });
          drawWhyItMatters(issue.problem, issue.why_it_matters, LEFT + 14, issY + 28 + problemH + 4, TEXT_W);
          const fixY = issY + 28 + problemH + (whyH > 0 ? 4 + whyH : 0) + 6;
          doc.fillColor(C.midText).fontSize(9).font('Helvetica')
            .text(`Fix: ${issue.fix_summary}`, LEFT + 14, fixY, { width: TEXT_W });
          doc.y = issY + CARD_H + 10;
        });
      };

      renderConfigSection(tagConfigIssues, 'GTM Configuration Issues');
      renderConfigSection(driftIssues, 'Drift Detection Issues');
    }

    // ── Runtime issues (signal_initiation, parameter_completeness, persistence) ─

    doc.addPage();
    pageHeader('Issues & Fixes');
    const runtimeIssues = report.issues.filter(
      (iss) => iss.validation_layer !== 'tag_configuration' && iss.validation_layer !== 'implementation_drift',
    );
    const issueCount = runtimeIssues.length;
    const criticalRuntimeCount = runtimeIssues.filter((i) => i.severity === 'critical').length;
    const actionItemsHeading = `Runtime Action Items — ${issueCount} action item${issueCount === 1 ? '' : 's'}`
      + (criticalRuntimeCount > 0 ? `, ${criticalRuntimeCount} of them critical` : '');
    sectionHeading(actionItemsHeading);

    // Build lookup so each issue card can pull evidence from validation results
    const resultByRuleId = new Map(
      report.technical_appendix.validation_results.map((r) => [r.rule_id, r]),
    );

    if (issueCount === 0) {
      doc.fillColor(C.healthy).fontSize(11).font('Helvetica')
        .text('No runtime issues found — all checks passed.', LEFT, doc.y);
    }

    for (let i = 0; i < runtimeIssues.length; i++) {
      const issue = runtimeIssues[i];
      const sevColor = SEVERITY_COLORS[issue.severity] ?? C.lightText;
      const vr = resultByRuleId.get(issue.rule_id);

      const TEXT_W = CONTENT_W - 28;
      const { problemH, fixH } = measureProblemFixHeight(issue.problem, issue.fix_summary, TEXT_W);
      const whyH = measureWhyItMattersHeight(issue.problem, issue.why_it_matters, TEXT_W);

      // Evidence — ordered so items the failure message names by key come
      // first, capped with an explicit overflow line rather than a silent
      // slice(0, 3) (PRD §3.1/W1).
      const rawEvidence = vr?.technical_details?.evidence ?? [];
      const { shown: shownEvidence, hiddenCount: hiddenEvidenceCount } =
        selectDisplayedEvidence(vr?.technical_details.found ?? '', rawEvidence);

      const EVIDENCE_TEXT_W = CONTENT_W - 36;
      let evidenceH = 0;
      if (shownEvidence.length > 0) {
        doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica-Bold');
        evidenceH += doc.heightOfString('Evidence observed during scan:', { width: TEXT_W }) + 3;
        doc.font('Helvetica');
        for (const ev of shownEvidence) {
          evidenceH += doc.heightOfString(`• ${ev}`, { width: EVIDENCE_TEXT_W }) + 3;
        }
        if (hiddenEvidenceCount > 0) {
          evidenceH += doc.heightOfString(`+ ${hiddenEvidenceCount} more (not shown)`, { width: EVIDENCE_TEXT_W }) + 3;
        }
      }

      const HEADER_H = 44; // "#N" badge + pills row
      const CARD_H = HEADER_H + problemH + (whyH > 0 ? 4 + whyH : 0) + 6 + fixH + (evidenceH > 0 ? 10 + evidenceH : 4) + 12;

      if (needsNewPage(CARD_H + 14)) {
        doc.addPage();
        pageHeader('Issues & Fixes');
        sectionHeading('Runtime Action Items (continued)');
      }

      const issY = doc.y;

      doc.strokeColor(C.bgLight).lineWidth(1).rect(LEFT, issY, CONTENT_W, CARD_H).stroke();
      doc.fillColor(sevColor).rect(LEFT, issY, 4, CARD_H).fill();

      // Issue number — no raw rule_id here; this page is marketer-facing and
      // the rule_id is still available in the Technical Appendix table.
      doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
        .text(`#${i + 1}`, LEFT + 14, issY + 8, { width: CONTENT_W - 20 });

      // Pills row
      let pillX = LEFT + 14;
      const pillY = issY + 23;
      pillX += pill(issue.severity.toUpperCase(), sevColor, pillX, pillY);
      pillX += pill(issue.recommended_owner, C.lightText, pillX, pillY);
      const effortColor = issue.estimated_effort === 'low' ? C.healthy
        : issue.estimated_effort === 'medium' ? C.atRisk : C.broken;
      pillX += pill(`Effort: ${issue.estimated_effort}`, effortColor, pillX, pillY);
      // Report Honesty PRD Part A — disclosure only, never a severity/score
      // change. Absence of this pill (vr.confidence undefined or 'high') is
      // itself the signal; a high-confidence item carries nothing extra.
      if (vr?.confidence === 'confirm') {
        pill('Needs confirmation', C.partial, pillX, pillY);
      }

      // Problem — full text, wrapped, never truncated (PRD §3.2/W2)
      doc.fillColor(C.darkText).fontSize(9.5).font('Helvetica-Bold')
        .text(issue.problem, LEFT + 14, issY + 44, { width: TEXT_W });

      // Impact sentence beneath the heading (Report Correctness Programme
      // PRD Part B2 — "unconditional structure: rule name as heading,
      // impact sentence beneath"), omitted when identical to the heading.
      drawWhyItMatters(issue.problem, issue.why_it_matters, LEFT + 14, issY + 44 + problemH + 4, TEXT_W);

      // Fix summary — full text, wrapped, never truncated
      const fixY = issY + 44 + problemH + (whyH > 0 ? 4 + whyH : 0) + 6;
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(`Fix: ${issue.fix_summary}`, LEFT + 14, fixY, { width: TEXT_W });

      // Evidence — what was observed during the scan
      if (shownEvidence.length > 0) {
        let evY = fixY + fixH + 10;
        doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica-Bold')
          .text('Evidence observed during scan:', LEFT + 14, evY);
        evY += doc.heightOfString('Evidence observed during scan:', { width: TEXT_W }) + 3;
        doc.font('Helvetica');
        for (const ev of shownEvidence) {
          doc.fillColor(C.mutedText).fontSize(7.5)
            .text(`• ${ev}`, LEFT + 18, evY, { width: EVIDENCE_TEXT_W });
          evY += doc.heightOfString(`• ${ev}`, { width: EVIDENCE_TEXT_W }) + 3;
        }
        if (hiddenEvidenceCount > 0) {
          doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica-Oblique')
            .text(`+ ${hiddenEvidenceCount} more (not shown)`, LEFT + 18, evY, { width: EVIDENCE_TEXT_W });
        }
      } else if (vr) {
        // Fallback: show the observed value if no structured evidence array
        const foundText = vr.technical_details.found ? `Observed: ${vr.technical_details.found}` : '';
        if (foundText) {
          doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica')
            .text(foundText, LEFT + 14, fixY + fixH + 10, { width: TEXT_W });
        }
      }

      doc.y = issY + CARD_H + 10;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE — Site Setup — what tracking infrastructure was detected on the
    // site during this scan (mirrors the web report's Site Setup tab).
    // Informational, non-scored; omitted entirely (no page added) when this
    // audit predates site_setup rather than rendering a fabricated "no data"
    // state, per CLAUDE.md rule 12.
    // ══════════════════════════════════════════════════════════════════════

    if (report.site_setup) {
      doc.addPage();
      pageHeader('Site Setup');
      sectionHeading('Site Setup');
      doc.fillColor(C.midText).fontSize(9).font('Helvetica')
        .text(
          'What tracking infrastructure we detected on your site during this scan.',
          LEFT, doc.y, { width: CONTENT_W },
        );
      doc.moveDown(0.5);

      const { gtm_container, tags, possible_server_side_gtm, datalayer_inventory } = report.site_setup;

      // GTM Container
      sectionHeading('Google Tag Manager Container');
      const gtmBadgeY = doc.y;
      pill(gtm_container.detected ? 'Detected' : 'Not Detected', gtm_container.detected ? C.healthy : C.mutedText, LEFT, gtmBadgeY);
      doc.y = gtmBadgeY + 22;
      if (gtm_container.detected) {
        doc.fillColor(C.darkText).font('Helvetica').fontSize(9)
          .text(gtm_container.container_ids.join(', '), LEFT, doc.y, { width: CONTENT_W });
      } else {
        doc.fillColor(C.lightText).fontSize(9).font('Helvetica')
          .text('No GTM container script was observed loading on the scanned pages.', LEFT, doc.y, { width: CONTENT_W });
      }
      if (gtm_container.connected_container_id) {
        doc.moveDown(0.3);
        const matchLabel = gtm_container.ids_match === false
          ? 'Mismatch — live site loads a different container'
          : gtm_container.ids_match === true
          ? 'Matches connected container' : null;
        doc.fillColor(C.lightText).fontSize(8.5).font('Helvetica')
          .text(`Connected container: ${gtm_container.connected_container_id}${matchLabel ? `  ·  ${matchLabel}` : ''}`, LEFT, doc.y, { width: CONTENT_W });
      }
      doc.moveDown(0.8);

      // Tags & Pixels Detected
      if (needsNewPage(60)) {
        doc.addPage();
        pageHeader('Site Setup');
      }
      sectionHeading('Tags & Pixels Detected');
      doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
        .text('General presence, independent of whether a conversion event fired.', LEFT, doc.y, { width: CONTENT_W });
      doc.moveDown(0.35);
      for (const tag of tags) {
        if (needsNewPage(26)) {
          doc.addPage();
          pageHeader('Site Setup');
          sectionHeading('Tags & Pixels Detected (continued)');
        }
        const rowY = doc.y;
        doc.fillColor(C.bgLight).rect(LEFT, rowY, CONTENT_W, 22).fill();
        doc.fillColor(C.darkText).fontSize(9).font('Helvetica-Bold')
          .text(TAG_PLATFORM_LABELS[tag.platform] ?? formatLabel(tag.platform), LEFT + 10, rowY + 6);
        pill(tag.detected ? 'Detected' : 'Not Detected', tag.detected ? C.healthy : C.mutedText, LEFT + CONTENT_W - 90, rowY + 4);
        if (tag.detected) {
          const detail = `${tag.ids.length > 0 ? `ID${tag.ids.length > 1 ? 's' : ''}: ${tag.ids.join(', ')}  ·  ` : ''}${tag.hit_count} request${tag.hit_count === 1 ? '' : 's'} observed`;
          doc.fillColor(C.lightText).fontSize(7.5).font('Helvetica')
            .text(detail, LEFT + 10, rowY + 6, { align: 'right', width: CONTENT_W - 110 });
        }
        doc.y = rowY + 26;
      }
      doc.moveDown(0.4);

      // Possible Server-Side GTM
      if (needsNewPage(60)) {
        doc.addPage();
        pageHeader('Site Setup');
      }
      sectionHeading('Possible Server-Side GTM');
      const sgtmBadgeY = doc.y;
      pill(
        possible_server_side_gtm.detected ? 'Possible Signal Found' : 'No Signal Found',
        possible_server_side_gtm.detected ? C.atRisk : C.mutedText,
        LEFT, sgtmBadgeY,
      );
      doc.y = sgtmBadgeY + 22;
      if (possible_server_side_gtm.detected && possible_server_side_gtm.candidate_hosts.length > 0) {
        doc.fillColor(C.darkText).fontSize(8.5).font('Helvetica')
          .text(
            `Candidate host${possible_server_side_gtm.candidate_hosts.length > 1 ? 's' : ''}: ${possible_server_side_gtm.candidate_hosts.join(', ')}`,
            LEFT, doc.y, { width: CONTENT_W },
          );
        doc.moveDown(0.25);
        doc.fillColor(C.lightText).fontSize(8)
          .text(`Confidence: ${possible_server_side_gtm.confidence}`, LEFT, doc.y);
        doc.moveDown(0.25);
      }
      doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica-Oblique')
        .text(
          possible_server_side_gtm.caveat || 'This is a best-effort heuristic based on request path/hostname shape, not a confirmed server-side GTM installation.',
          LEFT, doc.y, { width: CONTENT_W },
        );
      doc.moveDown(0.6);

      // DataLayer Inventory
      if (needsNewPage(60)) {
        doc.addPage();
        pageHeader('Site Setup');
      }
      sectionHeading('Data Layer Inventory');
      doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
        .text('Events observed in window.dataLayer during this scan and the parameters each one carries.', LEFT, doc.y, { width: CONTENT_W });
      doc.moveDown(0.35);
      if (datalayer_inventory.length === 0) {
        doc.fillColor(C.lightText).fontSize(9).font('Helvetica')
          .text('No dataLayer events were observed.', LEFT, doc.y);
      }
      for (const entry of datalayer_inventory) {
        const paramLine = entry.parameter_keys.join(', ');
        const paramH = entry.parameter_keys.length > 0
          ? doc.font('Helvetica').fontSize(7.5).heightOfString(paramLine, { width: CONTENT_W - 20 }) + 4
          : 0;
        const entryH = 20 + paramH + 8;
        if (needsNewPage(entryH)) {
          doc.addPage();
          pageHeader('Site Setup');
          sectionHeading('Data Layer Inventory (continued)');
        }
        const entryY = doc.y;
        doc.strokeColor(C.bgLight).lineWidth(1).rect(LEFT, entryY, CONTENT_W, entryH).stroke();
        doc.fillColor(C.darkText).fontSize(9).font('Helvetica-Bold')
          .text(entry.event_name, LEFT + 10, entryY + 6);
        doc.fillColor(C.mutedText).fontSize(7.5).font('Helvetica')
          .text(
            `${entry.occurrence_count} occurrence${entry.occurrence_count === 1 ? '' : 's'}  ·  ${entry.steps_seen.join(', ')}`,
            LEFT + 10, entryY + 6, { align: 'right', width: CONTENT_W - 20 },
          );
        if (entry.parameter_keys.length > 0) {
          doc.fillColor(C.lightText).fontSize(7.5).font('Helvetica')
            .text(paramLine, LEFT + 10, entryY + 20, { width: CONTENT_W - 20 });
        }
        doc.y = entryY + entryH + 8;
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE — Technical Appendix
    // ══════════════════════════════════════════════════════════════════════

    doc.addPage();
    pageHeader('Technical Appendix');
    sectionHeading('All Validation Results');

    const COL_RULE_X       = LEFT;
    const COL_LAYER_X      = LEFT + 175;
    const COL_STATUS_X     = LEFT + 295;
    const COL_SEVERITY_X   = LEFT + 348;
    const COL_CONFIDENCE_X = LEFT + 403;
    const ROW_H = 18;

    function drawTableHeader() {
      const hY = doc.y;
      doc.fillColor(C.bgLight).rect(LEFT, hY, CONTENT_W, ROW_H).fill();
      doc.fillColor(C.midText).fontSize(8).font('Helvetica-Bold')
        .text('Rule', COL_RULE_X + 4, hY + 5)
        .text('Layer', COL_LAYER_X + 4, hY + 5)
        .text('Status', COL_STATUS_X + 4, hY + 5)
        .text('Severity', COL_SEVERITY_X + 4, hY + 5)
        .text('Confidence', COL_CONFIDENCE_X + 4, hY + 5);
      doc.y = hY + ROW_H;
    }

    drawTableHeader();

    validatedResults.forEach((result, i) => {
      if (needsNewPage(ROW_H + 10)) {
        doc.addPage();
        pageHeader('Technical Appendix');
        sectionHeading('Validation Results (continued)');
        drawTableHeader();
      }

      const rowY = doc.y;
      if (i % 2 === 0) doc.fillColor(C.bgAlt).rect(LEFT, rowY, CONTENT_W, ROW_H).fill();

      const sc = statusColor(result.status);
      // Severity shown only on rows that actually failed/warned (PRD
      // §3.8/W8) — a passing check's severity is what it would have cost
      // had it failed, which isn't a property of the current result, so a
      // pass row leaves the column blank rather than a greyed-out label
      // that needed its own footnote to explain.
      const isFailing = result.status === 'fail' || result.status === 'warning';

      doc.fillColor(C.midText).fontSize(7.5).font('Helvetica')
        .text(result.rule_id.replace(/_/g, ' '), COL_RULE_X + 4, rowY + 5, { width: 166 });
      doc.fillColor(C.lightText)
        .text(result.validation_layer.replace(/_/g, ' '), COL_LAYER_X + 4, rowY + 5, { width: 108 });
      doc.fillColor(sc).font('Helvetica-Bold')
        .text(result.status.toUpperCase(), COL_STATUS_X + 4, rowY + 5, { width: 50 });
      if (isFailing) {
        doc.fillColor(SEVERITY_COLORS[result.severity] ?? C.lightText).font('Helvetica-Bold')
          .text(result.severity.toUpperCase(), COL_SEVERITY_X + 4, rowY + 5, { width: 52 });
      }
      // Confidence column (Report Honesty PRD Part A) — populated only for
      // 'confirm' rows; a 'high'-confidence (or unset, e.g. a v1-originated)
      // result leaves this blank, same "absence is the signal" rule the
      // Action Items chip follows.
      if (result.confidence === 'confirm') {
        doc.fillColor(C.partial).font('Helvetica-Bold')
          .text('CONFIRM', COL_CONFIDENCE_X + 4, rowY + 5, { width: 88 });
      }

      doc.y = rowY + ROW_H;
    });

    // Footer
    doc.moveDown(0.8);
    doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
      .text(
        'Generated by Atlas Signal Health Platform  ·  atlas.vimi.digital',
        LEFT, doc.y, { align: 'center', width: CONTENT_W },
      );

    // Real page numbering post-pass (PRD §3.3/W6) — every page recorded by
    // pageHeader() above (everything except page 1's cover layout and the
    // IHC page's deliberate 'IHC' badge) gets its "Page N / TOTAL" filled
    // in now that TOTAL is finally known.
    const { count: totalPages } = doc.bufferedPageRange();
    for (const pageIndex of numberedPageIndices) {
      doc.switchToPage(pageIndex);
      doc.fillColor(C.mutedText).fontSize(8).font('Helvetica')
        .text(`Page ${pageIndex + 1} / ${totalPages}`, LEFT, 18, { align: 'right', width: CONTENT_W });
    }

    doc.end();
  });
}
