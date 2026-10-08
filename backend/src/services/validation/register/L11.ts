/**
 * Layer L11 — Reconciliation (5 rules), DISCLOSURE-ONLY.
 *
 * GA4 Admin / L11 / Junk Gate PRD Part B, built from docs/ATLAS_L11_RECONCILIATION_SCOPING.md
 * §5-§7 (decided 2026-09-13). These rules read the linked client's most recent
 * completed reconciliation run (`AuditData.reconciliation_summary`, resolved by
 * the orchestrator before runRegister() — Key Technical Decision §16). They
 * never enter a score: L11 is outside `SCORED_V2_LAYERS` (layers.ts), and the
 * orchestrator partitions these results out before scoring, issues, breakdowns
 * and the technical appendix, so they surface only in the report's
 * "Against your connected platforms" section.
 *
 * Every rule requires `client_linked` + `reconciliation_data_available`: a
 * bare-URL scan, a public no-login scan, or a client with no completed run is
 * `skipped`, never `fail`.
 *
 * Wording is load-bearing (scoping doc §7): a GA4-vs-Ads discrepancy that
 * coincides with a COMBINED / COMBINED_ADS_PRIMARY Google tag topology lists
 * combination as a candidate explanation, never the cause; an `assumed`/`none`
 * strength carries "needs confirmation"; UNKNOWN says nothing about combination.
 * Copy never uses the outputLint banned vocabulary.
 */
import type {
  AuditData, ReconciliationSummary, ReconciliationSummaryFinding, Severity, ValidationResult, ValidationRule,
} from '@/types/audit';

/** A run older than this is disclosed as stale rather than read as clean. */
export const RECONCILIATION_STALE_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const ANNOTATION_WINDOW_DAYS = 14;

/** Underlying finding severity → register severity (disclosure ordering only; nothing is scored). */
export function mapFindingSeverity(severity: ReconciliationSummaryFinding['severity']): Severity {
  switch (severity) {
    case 'critical': return 'critical';
    case 'error': return 'high';
    case 'warning': return 'medium';
    default: return 'low';
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function highestSeverity(findings: ReconciliationSummaryFinding[]): Severity {
  return findings.reduce<Severity>(
    (worst, f) => (SEVERITY_ORDER[mapFindingSeverity(f.severity)] > SEVERITY_ORDER[worst] ? mapFindingSeverity(f.severity) : worst),
    'low',
  );
}

export function unresolvedFindings(summary: ReconciliationSummary): ReconciliationSummaryFinding[] {
  return summary.findings.filter((f) => !f.resolved_at);
}

export function runAgeDays(summary: ReconciliationSummary, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(summary.run_completed_at).getTime()) / DAY_MS));
}

/**
 * Whether a platform has a known change in how its data is collected that
 * would explain a volume shift on it: a discontinuity finding this run already
 * wrote for that platform, or a client-scoped tracking change within the
 * annotation window of the run.
 */
export function isVolumeAnnotated(finding: ReconciliationSummaryFinding, summary: ReconciliationSummary): boolean {
  if (summary.findings.some((f) => f.dimension === 'discontinuity' && f.platform === finding.platform && !f.resolved_at)) return true;
  const runAt = new Date(summary.run_completed_at).getTime();
  return (summary.tracking_changes ?? []).some((c) => {
    if (c.platform !== finding.platform) return false;
    if (!c.effective_date) return true;
    return Math.abs(runAt - new Date(c.effective_date).getTime()) <= ANNOTATION_WINDOW_DAYS * DAY_MS;
  });
}

function summaryOf(auditData: AuditData): ReconciliationSummary | undefined {
  return auditData.reconciliation_summary;
}

const REQUIRES = ['client_linked', 'reconciliation_data_available'] as const;

/**
 * runRegister() never reaches test() without a summary (the precondition skips
 * it first); this keeps a direct test() call — the register-integrity test
 * invokes every rule on a minimal AuditData — from throwing on missing data.
 */
function noData(rule: ValidationRule): ValidationResult {
  return {
    rule_id: rule.rule_id,
    validation_layer: rule.layer,
    status: 'skipped',
    severity: rule.severity,
    technical_details: {
      found: 'Not tested — no completed reconciliation run for the linked client',
      expected: rule.check,
      evidence: ['No completed reconciliation run exists for the linked client'],
    },
  };
}

function ok(rule: ValidationRule, found: string, expected: string): ValidationResult {
  return { rule_id: rule.rule_id, validation_layer: rule.layer, status: 'pass', severity: rule.severity, technical_details: { found, expected, evidence: [] } };
}

function flagged(
  rule: ValidationRule,
  findings: ReconciliationSummaryFinding[],
  found: string,
  expected: string,
): ValidationResult {
  return {
    rule_id: rule.rule_id,
    validation_layer: rule.layer,
    status: 'fail',
    severity: highestSeverity(findings),
    technical_details: {
      found,
      expected,
      evidence: findings.map((f) => `${f.platform}: ${f.narrative}`),
    },
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ── L11.1 — a recent reconciliation run ──────────────────────────────────────

export const RECONCILIATION_RUN_RECENT: ValidationRule = {
  id: 'L11.1',
  rule_id: 'RECONCILIATION_RUN_RECENT',
  layer: 'reconciliation',
  check: 'Reconciliation against connected platforms is recent',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'connector',
  owner: 'Backend',
  requires: [...REQUIRES],
  evidence_class: 'DIRECT',
  remediation: 'Run a reconciliation for this client (Platform Reconciliation → Run now) so the comparison against connected platforms reflects current state.',
  test(auditData: AuditData): ValidationResult {
    const summary = summaryOf(auditData);
    if (!summary) return noData(this);
    const age = runAgeDays(summary);
    const expected = `The most recent reconciliation run is no more than ${RECONCILIATION_STALE_AFTER_DAYS} days old`;
    if (age <= RECONCILIATION_STALE_AFTER_DAYS) {
      return ok(this, `Most recent reconciliation run completed ${plural(age, 'day', 'days')} ago`, expected);
    }
    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: 'warning',
      severity: this.severity,
      technical_details: {
        found: `Most recent reconciliation run completed ${age} days ago`,
        expected,
        evidence: [`The findings in this section reflect the state of the connected platforms on ${summary.run_completed_at.slice(0, 10)}, not today.`],
      },
    };
  },
};

// ── L11.2 — config drift ─────────────────────────────────────────────────────

export const RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT: ValidationRule = {
  id: 'L11.2',
  rule_id: 'RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT',
  layer: 'reconciliation',
  check: 'Connected platform configuration matches what Atlas expects',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'connector',
  owner: 'Backend',
  requires: [...REQUIRES],
  evidence_class: 'DIRECT',
  remediation: 'Open the client\'s Platform Reconciliation findings and work through the configuration items listed; each carries its own remediation.',
  test(auditData: AuditData): ValidationResult {
    const summary = summaryOf(auditData);
    if (!summary) return noData(this);
    const config = unresolvedFindings(summary).filter((f) => f.dimension === 'config');
    const expected = 'No unresolved configuration differences on connected platforms';
    if (config.length === 0) return ok(this, 'No unresolved configuration differences observed', expected);
    return flagged(this, config, `${plural(config.length, 'unresolved configuration difference', 'unresolved configuration differences')} on connected platforms`, expected);
  },
};

// ── L11.3 — alignment gaps ───────────────────────────────────────────────────

export const RECONCILIATION_NO_ALIGNMENT_GAPS: ValidationRule = {
  id: 'L11.3',
  rule_id: 'RECONCILIATION_NO_ALIGNMENT_GAPS',
  layer: 'reconciliation',
  check: 'Connected platforms are aligned with the strategy and with each other',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'connector',
  owner: 'Backend',
  requires: [...REQUIRES],
  evidence_class: 'DIRECT',
  remediation: 'Open the client\'s Platform Reconciliation findings and work through the alignment items listed; each carries its own remediation.',
  test(auditData: AuditData): ValidationResult {
    const summary = summaryOf(auditData);
    if (!summary) return noData(this);
    const gaps = unresolvedFindings(summary).filter((f) => f.dimension === 'alignment');
    const expected = 'No unresolved alignment gaps between connected platforms and the strategy';
    if (gaps.length === 0) return ok(this, 'No unresolved alignment gaps observed', expected);
    return flagged(this, gaps, `${plural(gaps.length, 'unresolved alignment gap', 'unresolved alignment gaps')}`, expected);
  },
};

// ── L11.4 — unexplained volume drift ─────────────────────────────────────────

export const RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT: ValidationRule = {
  id: 'L11.4',
  rule_id: 'RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT',
  layer: 'reconciliation',
  check: 'Volume differences between Atlas and platforms are explained',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'connector',
  owner: 'Backend',
  requires: [...REQUIRES],
  evidence_class: 'DIRECT',
  remediation: 'Review the volume findings in Platform Reconciliation; check CAPI delivery logs for the affected events and dates.',
  test(auditData: AuditData): ValidationResult {
    const summary = summaryOf(auditData);
    if (!summary) return noData(this);
    const volume = unresolvedFindings(summary).filter((f) => f.dimension === 'volume');
    const unexplained = volume.filter((f) => !isVolumeAnnotated(f, summary));
    const expected = 'Volume differences are within tolerance, or coincide with a known change on that platform';
    if (unexplained.length === 0) {
      const annotated = volume.length - unexplained.length;
      return ok(this, annotated > 0 ? `${plural(annotated, 'volume difference', 'volume differences')} coincide with a known change` : 'No unresolved volume differences observed', expected);
    }
    return flagged(this, unexplained, `${plural(unexplained.length, 'volume difference', 'volume differences')} with no known change to account for ${unexplained.length === 1 ? 'it' : 'them'}`, expected);
  },
};

// ── L11.5 — delivery health ──────────────────────────────────────────────────

export const RECONCILIATION_DELIVERY_HEALTHY: ValidationRule = {
  id: 'L11.5',
  rule_id: 'RECONCILIATION_DELIVERY_HEALTHY',
  layer: 'reconciliation',
  check: 'Delivery to connected platforms is healthy',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'connector',
  owner: 'Backend',
  requires: [...REQUIRES],
  evidence_class: 'DIRECT',
  remediation: 'Open the client\'s Platform Reconciliation delivery findings (connection status, events received, deduplication, match quality) and resolve each.',
  test(auditData: AuditData): ValidationResult {
    const summary = summaryOf(auditData);
    if (!summary) return noData(this);
    const delivery = unresolvedFindings(summary).filter((f) => f.dimension === 'delivery');
    const expected = 'Connections are active, events are received, and deduplication and match quality are within thresholds';
    if (delivery.length === 0) return ok(this, 'No unresolved delivery findings observed', expected);
    return flagged(this, delivery, `${plural(delivery.length, 'unresolved delivery finding', 'unresolved delivery findings')}`, expected);
  },
};

export const L11_RULES: ValidationRule[] = [
  RECONCILIATION_RUN_RECENT,
  RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT,
  RECONCILIATION_NO_ALIGNMENT_GAPS,
  RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT,
  RECONCILIATION_DELIVERY_HEALTHY,
];
