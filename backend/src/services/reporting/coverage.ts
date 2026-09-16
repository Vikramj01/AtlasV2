/**
 * Builds ReportJSON.executive_summary.coverage (Site Evaluation Coverage &
 * Honesty PRD §6.4) — "how much of the site did this scan actually reach."
 *
 * Undefined step_coverage (Journey-Builder mode's proxyAuditData, hand-built
 * fixtures, or an AuditData predating this field) means this whole section
 * is omitted from the report rather than rendering a synthesized "0 pages"
 * state — per CLAUDE.md rule 12 (no fabricated UI data).
 */
import crypto from 'crypto';
import type { AuditData, ValidationResult, ValidationLayerV2, StepCoverage, ReportCoverage, CoverageLayerNotTested, RunQuality } from '@/types/audit';
import { normalizeUrlForCoverage } from '@/services/audit/journeySimulator';
import { REGISTER, isRuleApplicable } from '@/services/validation/register/engine';
import { ALL_V2_LAYERS } from '@/services/validation/register/layers';

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
function distinctNormalizedUrls(steps: StepCoverage[]): Set<string> {
  const normalized = steps
    .filter((s) => s.navigation_success)
    .map((s) => normalizeUrlForCoverage(s.final_url ?? s.requested_url))
    .filter((u): u is string => !!u);
  return new Set(normalized);
}

function computePagesDistinct(steps: StepCoverage[]): number {
  return distinctNormalizedUrls(steps).size;
}

/**
 * A stable hash of the sorted set of normalised URLs a run actually,
 * successfully visited (§9) — what the scheduled-audit regression
 * comparator (queue/worker.ts) compares between two runs of the same
 * schedule to tell "the score genuinely regressed" apart from "Phase 2's
 * page discovery started finding real pages that used to be scored as the
 * homepage." Same distinctNormalizedUrls() computation buildCoverageSummary
 * uses for pages_distinct — two runs that visited the same page set always
 * produce the same fingerprint regardless of visit order. Undefined under
 * the same conditions buildCoverageSummary itself returns undefined —
 * never fabricate a fingerprint for an AuditData with no step_coverage.
 */
export function computeCoverageFingerprint(auditData: AuditData): string | undefined {
  const steps = auditData.step_coverage;
  if (!steps || steps.length === 0) return undefined;

  const sorted = [...distinctNormalizedUrls(steps)].sort();
  if (sorted.length === 0) return undefined;

  return crypto.createHash('sha256').update(sorted.join('|')).digest('hex');
}

/**
 * How many of the register's rules in `layer` are applicable to this
 * AuditData (Report Correctness Programme PRD Part D2) — zero means the
 * layer has nothing to check under this site/scan's own declared
 * configuration (an undeclared platform, a site_type L4's applies_to
 * excludes, ...) or hasn't shipped any rules yet (L11 Reconciliation),
 * independent of whether the crawl itself reached anything.
 */
function applicableRuleCountByLayer(auditData: AuditData): Map<ValidationLayerV2, number> {
  const counts = new Map<ValidationLayerV2, number>(ALL_V2_LAYERS.map((layer) => [layer, 0]));
  for (const rule of REGISTER) {
    if (isRuleApplicable(rule, auditData)) {
      counts.set(rule.layer, (counts.get(rule.layer) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The real, evidence-based reason(s) a layer's rules all self-skipped, read
 * off their own `technical_details.found` (Signal vs Implementation PRD
 * P0-01) — every ValidationRule already writes a specific skip reason
 * there (e.g. L8.1's "No CMP declared and no EEA/UK/Switzerland traffic
 * declared — a consent banner is not expected"), evidence that a runtime
 * signal (like an observed `consent(default)` push, or a banner genuinely
 * not being present) fed the decision. Discarding that in favour of a
 * canned generic string is the defect this function fixes: it made every
 * such exclusion look declaration-only, even when the underlying rules
 * looked at real crawl evidence and found nothing requiring them. Joins
 * every *distinct* reason rather than requiring all rules to agree on one —
 * a layer's several rules can each skip for their own genuine, different
 * reason (L8.1 on the CMP/region declaration, L8.2/L8.3 on the banner
 * itself not being present), and per the PRD's own acceptance criterion
 * ("every remaining exclusion names the evidence check that produced it"),
 * naming all of them beats collapsing to a generic fallback. Returns
 * undefined only when no skipped result in the layer carried any reason at
 * all (shouldn't happen in practice — every rule's test() always writes
 * `found` — kept as a defensive fallback to the generic string).
 */
function evidenceBasedSkipReason(layerResults: ValidationResult[]): string | undefined {
  const reasons = [
    ...new Set(
      layerResults
        .filter((r) => r.status === 'skipped' && !isCoverageSkip(r))
        .map((r) => r.technical_details.found)
        .filter((found): found is string => !!found),
    ),
  ];
  return reasons.length > 0 ? reasons.join(' ') : undefined;
}

/**
 * Classifies every one of the register's 13 layers (Report Correctness
 * Programme PRD Part D1/D2) — not just the ones that happen to appear in
 * `results` — into 'not_applicable' (this site/scan's own declared
 * configuration means the layer has nothing to check, or it isn't built
 * yet) or 'not_scanned' (the layer IS relevant here, but this run's crawl
 * never reached what it needed). A layer with at least one non-skipped
 * result is fully exercised and excluded from this list entirely — a
 * mix of tested and skipped rules in one layer was still meaningfully run.
 */
function classifyUntestedLayers(auditData: AuditData, results: ValidationResult[]): CoverageLayerNotTested[] {
  const byLayer = new Map<ValidationLayerV2, ValidationResult[]>();
  for (const r of results) {
    const layer = r.validation_layer as ValidationLayerV2;
    const list = byLayer.get(layer) ?? [];
    list.push(r);
    byLayer.set(layer, list);
  }
  const applicableCounts = applicableRuleCountByLayer(auditData);

  const notTested: CoverageLayerNotTested[] = [];
  for (const layer of ALL_V2_LAYERS) {
    const layerResults = byLayer.get(layer) ?? [];
    if (layerResults.some((r) => r.status !== 'skipped')) continue; // scanned — excluded from this list

    if ((applicableCounts.get(layer) ?? 0) === 0) {
      notTested.push({
        layer,
        label: LAYER_LABELS[layer] ?? layer,
        reason: REGISTER.some((r) => r.layer === layer)
          ? "Not applicable — nothing in this layer applies to this site's declared configuration"
          : 'Not yet built into the Check Register',
        state: 'not_applicable',
      });
      continue;
    }

    const anyCoverageSkip = layerResults.some(isCoverageSkip);
    const evidenceReason = anyCoverageSkip ? undefined : evidenceBasedSkipReason(layerResults);
    notTested.push({
      layer,
      label: LAYER_LABELS[layer] ?? layer,
      reason: anyCoverageSkip
        ? 'The crawl never reached a page distinct from the landing page'
        : evidenceReason
          ?? "Not applicable — nothing to check under this scan's current configuration (e.g. no domain declared, or nothing connected for this layer)",
      state: anyCoverageSkip ? 'not_scanned' : 'not_applicable',
    });
  }
  assertLayersReconcile(notTested);
  return notTested;
}

/**
 * Signal vs Implementation PRD P0-02 — every layer in `ALL_V2_LAYERS` must
 * land in exactly one bucket: "assessed" (excluded from `notTested`, by
 * `classifyUntestedLayers`'s own `continue`) or `notTested` (not_applicable/
 * not_scanned), never both and never neither. Guaranteed by construction
 * today (the loop above iterates `ALL_V2_LAYERS` once and either continues
 * or pushes exactly once per layer) — this assertion exists so a future
 * change to that loop (or to `ALL_V2_LAYERS` itself) that breaks the
 * invariant fails loudly in tests/report generation, rather than silently
 * reproducing the PRD's "assessed + not applicable + not assessed don't
 * visibly sum to thirteen" defect.
 */
function assertLayersReconcile(notTested: CoverageLayerNotTested[]): void {
  const seen = new Set<ValidationLayerV2>();
  for (const { layer } of notTested) {
    if (seen.has(layer)) {
      throw new Error(`Coverage arithmetic broken: layer "${layer}" appears more than once in layers_not_tested`);
    }
    if (!ALL_V2_LAYERS.includes(layer)) {
      throw new Error(`Coverage arithmetic broken: layer "${layer}" is not one of the register's ${ALL_V2_LAYERS.length} declared layers`);
    }
    seen.add(layer);
  }
  const assessedCount = ALL_V2_LAYERS.length - seen.size;
  if (assessedCount + seen.size !== ALL_V2_LAYERS.length) {
    throw new Error(
      `Coverage arithmetic broken: assessed (${assessedCount}) + not-tested (${seen.size}) does not sum to the fixed ${ALL_V2_LAYERS.length}-layer denominator`,
    );
  }
}

/** Step names whose navigation degraded (StepCoverage.degraded) — Platform Attribution & Determinism PRD B-W3. */
export function degradedStepNames(steps: StepCoverage[]): string[] {
  return steps.filter((s) => s.degraded === true).map((s) => s.step);
}

/**
 * Run-level settle-reliability verdict (Pre-Connection Scan Confidence
 * Tiering PRD §7.3) — the single source of truth reused by both
 * ReportCoverage (buildCoverageSummary below, for the report header) and
 * orchestrator.ts (for the durable audits.run_quality column the export
 * route gates on), so the two can never silently disagree.
 *
 * No steps at all (Journey-Builder mode never reaches this — caller returns
 * undefined first — but a directly-constructed empty array shouldn't read
 * as a clean run) — 'INSUFFICIENT'.
 *
 * The declared conversion surface is "a step distinct from the landing page
 * that navigated successfully" — the same basic condition
 * conversionSurfaceReached() (register/L0.ts) tests, without that
 * function's extra isVerifiedStep() confidence gate, since run_quality asks
 * "did settling fail on the page that mattered," not "is this evidence
 * strong enough to score." When at least one such step exists but *none* of
 * them actually reached 'settled', the run can't support a client-facing
 * report regardless of how many other steps settled cleanly. Independently,
 * fewer than two settled steps overall is too little to report on even when
 * no conversion surface was ever reached (e.g. a bare-URL homepage-only
 * scan that also failed to settle the homepage itself).
 */
export function computeRunQuality(steps: StepCoverage[]): RunQuality {
  if (steps.length === 0) return 'INSUFFICIENT';

  const settledSteps = steps.filter((s) => s.settle_outcome === 'settled');
  const conversionSteps = steps.filter((s) => s.distinct_from_landing && s.navigation_success);
  const conversionSurfaceUnsettled = conversionSteps.length > 0
    && conversionSteps.every((s) => s.settle_outcome !== 'settled');

  if (conversionSurfaceUnsettled || settledSteps.length < 2) return 'INSUFFICIENT';
  return settledSteps.length < steps.length ? 'PROVISIONAL' : 'COMPLETE';
}

export function buildCoverageSummary(auditData: AuditData, results: ValidationResult[]): ReportCoverage | undefined {
  const steps = auditData.step_coverage;
  if (!steps || steps.length === 0) return undefined;

  const rulesNotTested = results.filter(isCoverageSkip).length;
  const degradedSteps = degradedStepNames(steps);

  return {
    pages_requested: steps.length,
    pages_distinct: computePagesDistinct(steps),
    steps,
    layers_not_tested: classifyUntestedLayers(auditData, results),
    rules_tested: results.length - rulesNotTested,
    rules_not_tested: rulesNotTested,
    partial: degradedSteps.length > 0,
    degraded_steps: degradedSteps,
    run_quality: computeRunQuality(steps),
  };
}
