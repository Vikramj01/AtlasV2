/**
 * Output vocabulary lint — Pre-Connection Scan Confidence Tiering PRD §5.
 *
 * A pre-connection scan's client-side crawl cannot always distinguish "this
 * tag genuinely isn't installed" from "this tag exists but the scan
 * couldn't observe it firing" (blocked by consent, behind a gated step the
 * crawl never reached, a timing race). Asserting the former when only the
 * latter is known overstates what was actually observed. PRD §5 bans a
 * fixed vocabulary of absolute-absence/defect words from every rule title,
 * summary, evidence line, and platform verdict — case-insensitive, "in any
 * casing" — and is explicit that this is a hard failure, not a warning: "a
 * report that cannot be phrased safely must not ship."
 *
 * Deliberately mirrors placeholderGuard.ts's field-walk (same narrative
 * fields: business_summary, issues[].problem/why_it_matters,
 * journey_stages[].issues[].label, platform_breakdown[].risk_explanation/
 * failed_rule_details[].impact) but is broader in one respect — it also
 * covers technical_appendix.validation_results[].technical_details, which
 * placeholderGuard deliberately skips (there, a literal "XXXX"-shaped value
 * could legitimately be real evidence; here, the banned tokens are never
 * legitimate evidence content) — and covers could_not_be_assessed[].reason
 * and open_questions[], which placeholderGuard doesn't scan at all.
 *
 * Deliberately narrower in one respect: it does NOT scan
 * remediation/fix_summary/client_question prose (PRD §5.1 explicitly scopes
 * the ban to titles/summaries/evidence/verdicts, not remediation advice —
 * "missing the domain" in a fix instruction is fine), and it does NOT scan
 * platform_breakdown[].status / journey_stages[].status /
 * ValidationResult.status. Those are internal enum identifiers
 * ('healthy'|'at_risk'|'broken'|'not_included' etc.), never rendered
 * verbatim — the frontend/PDF only ever show them through a fixed, reviewed
 * label map (pdfGenerator.ts's PLATFORM_STATUS_LABELS, PlatformImpact.tsx's
 * PLATFORM_STATUS_CONFIG) that already applies the PRD §5.1 remap. Linting
 * the raw enum value would hard-fail every report with an unhealthy
 * platform, which is not what this gate is for.
 */
import type { ReportJSON } from '@/types/audit';

const BANNED_TOKENS = ['Not Detected', 'Missing', 'Broken', 'is not installed', 'you have no', 'zero measurement'] as const;

export interface OutputLintViolation {
  field: string;
  token: string;
  excerpt: string;
}

export class OutputLintError extends Error {
  violations: OutputLintViolation[];

  constructor(violations: OutputLintViolation[]) {
    super(
      `Report failed output vocabulary lint (PRD §5) — ${violations.length} banned-token occurrence(s): ` +
        violations.map((v) => `${v.field}: "${v.token}" in "${v.excerpt}"`).join('; '),
    );
    this.name = 'OutputLintError';
    this.violations = violations;
  }
}

function findViolations(field: string, text: string, out: OutputLintViolation[]): void {
  const lower = text.toLowerCase();
  for (const token of BANNED_TOKENS) {
    const idx = lower.indexOf(token.toLowerCase());
    if (idx !== -1) {
      out.push({ field, token, excerpt: text.slice(Math.max(0, idx - 20), idx + token.length + 20) });
    }
  }
}

/** Scans an assembled report for every PRD §5 banned-token occurrence. Returns [] when clean. */
export function lintReportOutput(report: ReportJSON): OutputLintViolation[] {
  const violations: OutputLintViolation[] = [];

  findViolations('executive_summary.business_summary', report.executive_summary.business_summary, violations);

  report.issues.forEach((issue, i) => {
    findViolations(`issues[${i}].problem (${issue.rule_id})`, issue.problem, violations);
    findViolations(`issues[${i}].why_it_matters (${issue.rule_id})`, issue.why_it_matters, violations);
  });

  report.journey_stages.forEach((stage, i) => {
    stage.issues.forEach((issue, j) => {
      findViolations(`journey_stages[${i}].issues[${j}].label (${issue.rule_id})`, issue.label, violations);
    });
  });

  report.platform_breakdown.forEach((platform, i) => {
    findViolations(`platform_breakdown[${i}].risk_explanation (${platform.platform})`, platform.risk_explanation, violations);
    platform.failed_rule_details.forEach((detail, j) => {
      findViolations(`platform_breakdown[${i}].failed_rule_details[${j}].impact (${detail.rule_id})`, detail.impact, violations);
    });
  });

  report.technical_appendix.validation_results.forEach((result, i) => {
    const base = `technical_appendix.validation_results[${i}] (${result.rule_id})`;
    findViolations(`${base}.technical_details.found`, result.technical_details.found, violations);
    findViolations(`${base}.technical_details.expected`, result.technical_details.expected, violations);
    result.technical_details.evidence.forEach((line, k) => {
      findViolations(`${base}.technical_details.evidence[${k}]`, line, violations);
    });
  });

  (report.could_not_be_assessed ?? []).forEach((finding, i) => {
    findViolations(`could_not_be_assessed[${i}].reason (${finding.rule_id})`, finding.reason, violations);
  });

  (report.open_questions ?? []).forEach((question, i) => {
    findViolations(`open_questions[${i}]`, question, violations);
  });

  return violations;
}

/**
 * Hard gate — throws OutputLintError on any violation. Call before
 * persisting or exporting a report; PRD §5: "This is a hard failure, not a
 * warning · a report that cannot be phrased safely must not ship."
 */
export function assertReportOutputClean(report: ReportJSON): void {
  const violations = lintReportOutput(report);
  if (violations.length > 0) throw new OutputLintError(violations);
}
