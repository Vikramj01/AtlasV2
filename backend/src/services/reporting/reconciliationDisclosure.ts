/**
 * Builds ReportJSON.reconciliation_disclosure — the "Against your connected
 * platforms" section (GA4 Admin / L11 / Junk Gate PRD §B.5). Pure.
 *
 * L11 results are partitioned out of the scored/issue pipeline by the
 * orchestrator and arrive here as-is. They were genuinely ASSESSED, so they do
 * not go in `could_not_be_assessed` (see the PRD §12 deviation note); this is a
 * separate disclosure surface that never counts toward anything.
 *
 * Wording (scoping doc §7, load-bearing): a combined Google tag is only ever a
 * *candidate explanation* for a GA4-vs-Google Ads difference, never the cause;
 * an `assumed`/`none` strength says it needs confirmation; SPLIT and UNKNOWN
 * say nothing about combination. A client-scoped tracking change is annotated
 * as a known change in how data is collected from its date, not as drift.
 */
import type {
  ReconciliationDisclosure, ReconciliationDisclosureItem, ReconciliationSummary, ValidationResult,
} from '@/types/audit';
import { BANNED_TOKENS } from './outputLint';
import { runAgeDays, RECONCILIATION_STALE_AFTER_DAYS } from '@/services/validation/register/L11';
import { L11_RULES } from '@/services/validation/register/L11';

export const RECONCILIATION_NOTICE =
  'These observations describe your connected ad platforms, not this scan. They are shown for context and are not included in any score or issue count.';

const PLATFORM_LABELS: Record<string, string> = { ga4: 'GA4', google_ads: 'Google Ads', meta: 'Meta', gtm: 'Google Tag Manager', linkedin: 'LinkedIn', tiktok: 'TikTok' };
const label = (p: string): string => PLATFORM_LABELS[p] ?? p;

const GOOGLE_PAIR = new Set(['ga4', 'google_ads']);
const SEVERITY_ORDER = { critical: 3, high: 2, medium: 1, low: 0 } as const;

/**
 * Finding narratives interpolate client-chosen names (a conversion action, an
 * account label). outputLint is a hard gate on the whole report, so one such
 * name containing a banned word must not fail the entire audit: a line that
 * would trip the lint is replaced by a neutral pointer rather than shipped or
 * thrown on. Atlas-authored copy never trips this (tests assert it).
 */
export function lintSafe(line: string): string {
  const lower = line.toLowerCase();
  const hit = BANNED_TOKENS.some((t) => lower.includes(t.toLowerCase()));
  return hit ? 'A finding on this platform includes a name Atlas cannot display here — see Platform Reconciliation for the full text.' : line;
}

const RULE_LABELS = new Map(L11_RULES.map((r) => [r.rule_id, r.check]));

/** Topology + tracking-change context lines. Exported for tests. */
export function buildContextNotes(summary: ReconciliationSummary): string[] {
  const notes: string[] = [];
  const open = summary.findings.filter((f) => !f.resolved_at);

  // Candidate explanation: only when a GA4 / Google Ads difference is actually on the table.
  const googleDifference = open.some(
    (f) => GOOGLE_PAIR.has(f.platform) && (f.dimension === 'volume' || f.dimension === 'alignment' || f.dimension === 'config'),
  );
  const topology = summary.google_tag_topology;
  if (googleDifference && topology && (topology.verdict === 'COMBINED' || topology.verdict === 'COMBINED_ADS_PRIMARY')) {
    const confirm = topology.strength === 'assumed' || topology.strength === 'none';
    notes.push(
      `Google tag setup: ${topology.verdict === 'COMBINED_ADS_PRIMARY' ? 'the GA4 and Google Ads destinations appear to share one Google tag, with the Google Ads ID as its primary' : 'the GA4 and Google Ads destinations appear to share one Google tag'}`
      + `${confirm ? ' (this needs confirmation — it has not been confirmed for this client)' : ''}. `
      + 'A shared Google tag is one candidate explanation for differences between GA4 and Google Ads figures; it has not been established as the cause.',
    );
  }

  // Known changes in how data is collected — annotate, never call it drift.
  const platformsWithDifferences = new Set(
    open.filter((f) => f.dimension === 'volume' || f.dimension === 'alignment').map((f) => f.platform),
  );
  const seen = new Set<string>();
  for (const c of summary.tracking_changes ?? []) {
    if (!platformsWithDifferences.has(c.platform)) continue;
    const key = `${c.platform}|${c.title}|${c.effective_date ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(
      lintSafe(
        `${label(c.platform)}: a change to how its data is collected${c.effective_date ? ` took effect on ${c.effective_date}` : ' is on record'} ("${c.title}"). `
        + 'Differences around that date may reflect the change rather than drift.',
      ),
    );
  }
  return notes;
}

/**
 * Splits the register's results into the scored/issue pipeline's input and the
 * L11 disclosure-only results. Everything downstream of runRegister() — scores,
 * issues, journey/platform breakdowns, coverage counts, the technical appendix,
 * rule confirmations — sees only `core`, so L11 cannot leak into any of them.
 */
export function partitionReconciliation(results: ValidationResult[]): { core: ValidationResult[]; reconciliation: ValidationResult[] } {
  const core: ValidationResult[] = [];
  const reconciliation: ValidationResult[] = [];
  for (const r of results) (r.validation_layer === 'reconciliation' ? reconciliation : core).push(r);
  return { core, reconciliation };
}

/** `l11Results` are the register's results for layer 'reconciliation' (skipped ones are ignored). */
export function buildReconciliationDisclosure(
  l11Results: ValidationResult[],
  summary: ReconciliationSummary | undefined,
  now: Date = new Date(),
): ReconciliationDisclosure | undefined {
  if (!summary) return undefined;
  const ran = l11Results.filter((r) => r.status !== 'skipped' && r.status !== 'not_run');
  if (ran.length === 0) return undefined;

  const items: ReconciliationDisclosureItem[] = ran.map((r) => ({
    rule_id: r.rule_id,
    label: RULE_LABELS.get(r.rule_id) ?? r.rule_id,
    outcome: r.status === 'pass' ? 'clear' : 'flagged',
    severity: r.severity,
    summary: lintSafe(r.technical_details.found),
    details: r.technical_details.evidence.map(lintSafe),
  }));
  // Flagged first, most prominent first; stable on rule order otherwise.
  items.sort((a, b) => (a.outcome === b.outcome ? SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] : a.outcome === 'flagged' ? -1 : 1));

  const age = runAgeDays(summary, now);
  return {
    run_completed_at: summary.run_completed_at,
    run_age_days: age,
    stale: age > RECONCILIATION_STALE_AFTER_DAYS,
    notice: RECONCILIATION_NOTICE,
    items,
    context_notes: buildContextNotes(summary),
  };
}
