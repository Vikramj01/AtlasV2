/**
 * Builds ReportJSON.executive_summary.coverage (Site Evaluation Coverage &
 * Honesty PRD §6.4) — "how much of the site did this scan actually reach."
 *
 * Undefined step_coverage (Journey-Builder mode's proxyAuditData, hand-built
 * fixtures, or an AuditData predating this field) means this whole section
 * is omitted from the report rather than rendering a synthesized "0 pages"
 * state — per CLAUDE.md rule 12 (no fabricated UI data).
 */
import type { AuditData, ValidationResult, ValidationLayerV2, StepCoverage, ReportCoverage, CoverageLayerNotTested } from '@/types/audit';
import { normalizeUrlForCoverage } from '@/services/audit/journeySimulator';

/**
 * The exact evidence prefix engine.ts's skippedForPrecondition() writes for
 * an unmet 'conversion_surface' precondition — matched against here rather
 * than re-derived, so this module and the precondition engine can never
 * silently disagree about what counts as a coverage-driven skip.
 */
const COVERAGE_SKIP_MARKER = 'Not tested — the crawl never reached a page distinct from the landing page';

const LAYER_LABELS: Record<ValidationLayerV2, string> = {
  scope_configuration: 'Scope & Configuration',
  foundation_tags: 'Foundation Tags',
  click_id_capture: 'Click ID Capture',
  storage_durability: 'Storage Durability',
  cross_domain_continuity: 'Cross-Domain Continuity',
  event_firing: 'Event Firing',
  parameter_completeness: 'Parameter Completeness',
  identity_match_quality: 'Identity & Match Quality',
  consent: 'Consent',
  server_side_delivery: 'Server-Side Delivery',
  deduplication: 'Deduplication',
  reconciliation: 'Reconciliation',
  hygiene_integrity: 'Hygiene & Integrity',
};

function isCoverageSkip(result: ValidationResult): boolean {
  return result.status === 'skipped' && result.technical_details.found.startsWith(COVERAGE_SKIP_MARKER);
}

/** Unique normalised URLs actually, successfully navigated to — a step that failed to navigate contributed no page. */
function computePagesDistinct(steps: StepCoverage[]): number {
  const normalized = steps
    .filter((s) => s.navigation_success)
    .map((s) => normalizeUrlForCoverage(s.final_url ?? s.requested_url))
    .filter((u): u is string => !!u);
  return new Set(normalized).size;
}

/** A layer counts as not-tested only when EVERY result in it was a coverage-driven skip — a layer with a mix of tested and skipped rules was still meaningfully exercised. */
function computeLayersNotTested(results: ValidationResult[]): CoverageLayerNotTested[] {
  const byLayer = new Map<ValidationLayerV2, ValidationResult[]>();
  for (const r of results) {
    const layer = r.validation_layer as ValidationLayerV2;
    const list = byLayer.get(layer) ?? [];
    list.push(r);
    byLayer.set(layer, list);
  }

  const notTested: CoverageLayerNotTested[] = [];
  for (const [layer, layerResults] of byLayer) {
    if (layerResults.length > 0 && layerResults.every(isCoverageSkip)) {
      notTested.push({
        layer,
        label: LAYER_LABELS[layer] ?? layer,
        reason: 'The crawl never reached a page distinct from the landing page',
      });
    }
  }
  return notTested;
}

export function buildCoverageSummary(auditData: AuditData, results: ValidationResult[]): ReportCoverage | undefined {
  const steps = auditData.step_coverage;
  if (!steps || steps.length === 0) return undefined;

  const rulesNotTested = results.filter(isCoverageSkip).length;

  return {
    pages_requested: steps.length,
    pages_distinct: computePagesDistinct(steps),
    steps,
    layers_not_tested: computeLayersNotTested(results),
    rules_tested: results.length - rulesNotTested,
    rules_not_tested: rulesNotTested,
  };
}
