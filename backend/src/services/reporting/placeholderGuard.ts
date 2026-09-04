/**
 * Pre-render placeholder guard — PRD "Signal Health Report" Issue 4's third
 * acceptance criterion: "Add a pre-render guard that fails the report build
 * (or flags it) if a known placeholder pattern is detected in output text."
 *
 * Issue 4's actual bug (the narrator reading technical_details.expected —
 * ideal-state text — instead of .found for a FAIL result) is fixed
 * upstream (interpretation/engine.ts's toSummaryInput/interpretResults).
 * This guard is defense-in-depth, not a fix for a currently-reproducing
 * bug: it catches the case a future rule's authored copy (an `expected`
 * string, or a `remediation`) embeds an illustrative placeholder value the
 * way GA4_CONFIG_TAG_PRESENT.expected's "G-XXXXXXXXXX" did, and that value
 * ends up rendered somewhere in a shipped report.
 *
 * Default behaviour (PRD §5 Open Question 3, proposed default): flag, not
 * block. A hard block would mean no report ships until every one of the
 * 90+ rules' copy is re-verified placeholder-free — disproportionate for a
 * defense-in-depth net rather than a known-broken state. Flagging surfaces
 * the defect (via ReportJSON.content_quality_warning, rendered as a
 * banner) without holding up delivery. Revisit if product decides
 * otherwise.
 */
import type { ReportJSON } from '@/types/audit';

const PLACEHOLDER_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bG-X{6,}\b/, label: 'unfilled GA4 measurement ID placeholder' },
  { pattern: /\bAW-X{6,}\b/, label: 'unfilled Google Ads conversion ID placeholder' },
  { pattern: /\{\{[^{}]*\}\}/, label: 'unresolved {{template}} variable' },
  { pattern: /\bX{4,}\b/, label: 'generic X-run placeholder' },
];

/** Every pattern match found in one string, as "label: matched text". */
function findMatches(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
    const match = text.match(pattern);
    if (match) found.push(`${label}: "${match[0]}"`);
  }
  return found;
}

/** One flagged field, identified by where it lives in the report so a reviewer can find and fix it. */
export interface PlaceholderFlag {
  field: string;
  matches: string[];
}

/**
 * Scans every narrative (human-written-or-templated, as opposed to raw
 * technical) text field in an assembled report. Deliberately excludes
 * technical_appendix.validation_results — that's the raw rule output,
 * where a literal "XXXX"-shaped value could legitimately be real evidence
 * (an actual malformed hash, say) rather than an authoring mistake.
 */
export function scanReportForPlaceholders(report: ReportJSON): PlaceholderFlag[] {
  const flags: PlaceholderFlag[] = [];

  const summaryMatches = findMatches(report.executive_summary.business_summary);
  if (summaryMatches.length > 0) flags.push({ field: 'executive_summary.business_summary', matches: summaryMatches });

  report.issues.forEach((issue, i) => {
    for (const [key, value] of [['problem', issue.problem], ['why_it_matters', issue.why_it_matters], ['fix_summary', issue.fix_summary]] as const) {
      const matches = findMatches(value);
      if (matches.length > 0) flags.push({ field: `issues[${i}].${key} (${issue.rule_id})`, matches });
    }
  });

  report.journey_stages.forEach((stage, i) => {
    stage.issues.forEach((issue, j) => {
      const matches = findMatches(issue.label);
      if (matches.length > 0) flags.push({ field: `journey_stages[${i}].issues[${j}] (${issue.rule_id})`, matches });
    });
  });

  report.platform_breakdown.forEach((platform, i) => {
    const matches = findMatches(platform.risk_explanation);
    if (matches.length > 0) flags.push({ field: `platform_breakdown[${i}].risk_explanation (${platform.platform})`, matches });
    platform.failed_rule_details.forEach((detail, j) => {
      const detailMatches = findMatches(detail.impact);
      if (detailMatches.length > 0) flags.push({ field: `platform_breakdown[${i}].failed_rule_details[${j}].impact (${detail.rule_id})`, matches: detailMatches });
    });
  });

  return flags;
}
