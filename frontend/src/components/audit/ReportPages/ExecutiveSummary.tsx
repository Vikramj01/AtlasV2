import { StatusBanner } from '@/components/common/StatusBanner';
import { ScoreCard } from '@/components/common/ScoreCard';
import { TOOLTIPS } from '@/lib/ui-copy';
import type { ReportJSON, AuditScores, ValidationLayerFilter } from '@/types/audit';

// Fixed 13-layer order + labels, mirroring backend/src/services/validation/
// register/layers.ts's ALL_V2_LAYERS/LAYER_LABELS exactly — the single
// source of truth for "how many layers does this rule set define" lives
// backend-side, but the report needs the same fixed list to render every
// layer, not just the ones ReportCoverage.layers_not_tested happens to
// name. Signal vs Implementation PRD P0-02 — previously this page showed a
// count plus two comma-joined name lists, so a reader couldn't reconstruct
// the coverage percentage without inference; this table makes all 13 rows
// visible, assessed or not, so the arithmetic is on the page itself.
const V2_LAYER_ORDER: { layer: ValidationLayerFilter; label: string }[] = [
  { layer: 'scope_configuration', label: 'L0 · Scope & Configuration' },
  { layer: 'foundation_tags', label: 'L1 · Foundation & Tags' },
  { layer: 'click_id_capture', label: 'L2 · Click ID Capture' },
  { layer: 'storage_durability', label: 'L3 · Storage Durability' },
  { layer: 'cross_domain_continuity', label: 'L4 · Cross-Domain Continuity' },
  { layer: 'event_firing', label: 'L5 · Event Firing' },
  { layer: 'parameter_completeness', label: 'L6 · Parameter Completeness' },
  { layer: 'identity_match_quality', label: 'L7 · Identity & Match Quality' },
  { layer: 'consent', label: 'L8 · Consent' },
  { layer: 'server_side_delivery', label: 'L9 · Server-Side Delivery' },
  { layer: 'deduplication', label: 'L10 · Deduplication' },
  { layer: 'reconciliation', label: 'L11 · Reconciliation' },
  { layer: 'hygiene_integrity', label: 'L12 · Hygiene & Integrity' },
];

function scoreColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

function riskColor(level: NonNullable<AuditScores['attribution_risk_level']>): 'green' | 'yellow' | 'red' {
  return level === 'Low' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
}

function strengthColor(level: NonNullable<AuditScores['optimization_strength']>): 'green' | 'yellow' | 'red' {
  return level === 'Strong' ? 'green' : level === 'Moderate' ? 'yellow' : 'red';
}

function consistencyColor(level: NonNullable<AuditScores['data_consistency_score']>): 'green' | 'yellow' | 'red' {
  return level === 'High' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
}

interface Props {
  report: ReportJSON;
}

export function ExecutiveSummary({ report }: Props) {
  const { executive_summary, comparison } = report;
  const { scores, coverage } = executive_summary;

  // Undefined coverage (Journey-Builder mode, an audit predating this field)
  // renders nothing here — per CLAUDE.md rule 12, never fabricate a coverage
  // claim for an AuditData that never captured it.
  const limitedCoverage = coverage && coverage.pages_distinct < coverage.pages_requested;
  // Platform Attribution & Determinism PRD B-W3 — a scan can reach every
  // requested page yet still not have fully settled on one of them; that's
  // a distinct kind of limitation from missing pages, so it's shown even
  // when limitedCoverage is false.
  const partialSettle = coverage?.partial ?? false;

  // Report Correctness Programme PRD Part D2 — "not applicable" (this
  // site's own declared configuration means the layer has nothing to
  // check) must be visibly distinct from "not scanned" (in scope, but this
  // run's crawl didn't get there). Only not_scanned layers belong in the
  // "Limited scan coverage" warning — a site with no cross-domain journey
  // isn't a limited scan for L4 not running.
  const notScannedLayers = coverage?.layers_not_tested.filter((l) => l.state === 'not_scanned') ?? [];
  const notApplicableLayers = coverage?.layers_not_tested.filter((l) => l.state === 'not_applicable') ?? [];

  // Pre-Connection Scan Confidence Tiering PRD §7.3 — an INSUFFICIENT run
  // gets its own prominent notice ahead of everything else on the page,
  // not folded into the amber "Limited scan coverage" banner below: this
  // isn't a caveat on an otherwise-usable report, it's the reason this run
  // can't be exported as a client-facing report at all until re-scanned.
  const insufficientRun = coverage?.run_quality === 'INSUFFICIENT';

  // Scoring & Coverage Gate PRD §9.1.5/§9.2 — a withheld overall score
  // renders as this panel, "not a number and not a blank."
  const coverageGateWithheld = scores.score_withheld_reason === 'INSUFFICIENT_LAYER_COVERAGE';
  const conversionCoverage = scores.conversion_signal_health_coverage;

  return (
    <div className="space-y-6">
      <p className="text-sm font-medium text-muted-foreground">{report.website_url}</p>

      {insufficientRun && coverage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-900">Insufficient run quality — export blocked</p>
          <p className="mt-1 text-sm leading-relaxed text-red-800">
            This scan examined {coverage.pages_distinct} of {coverage.pages_requested} requested page{coverage.pages_requested !== 1 ? 's' : ''},
            but the declared conversion surface never settled or too few pages settled overall. This run is not reliable enough
            to support a client-facing report, and PDF/JSON export is disabled below. Re-run the audit with corrected seed URLs.
          </p>
        </div>
      )}

      {coverageGateWithheld && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">Coverage Gate — Signal Health score withheld</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            This scan assessed {conversionCoverage?.layers_tested ?? 0} of {conversionCoverage?.layers_total ?? 13} signal layers, below the 60 per cent
            coverage this score requires. A partial score would imply confidence the run does not support. The layers assessed are reported individually below.
          </p>
        </div>
      )}

      {(limitedCoverage || partialSettle) && coverage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">Limited scan coverage</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            This scan examined {coverage.pages_distinct} of {coverage.pages_requested} requested page{coverage.pages_requested !== 1 ? 's' : ''}.
            {notScannedLayers.length > 0 && (
              <>
                {' '}
                {notScannedLayers.map((l) => l.label).join(', ')} could not be tested because no conversion surface was reached — {coverage.rules_not_tested} check{coverage.rules_not_tested !== 1 ? 's' : ''} {coverage.rules_not_tested !== 1 ? 'were' : 'was'} skipped rather than scored as failing.
              </>
            )}
            {partialSettle && (
              <>
                {' '}
                This scan didn&apos;t fully settle on {coverage.degraded_steps.length} step{coverage.degraded_steps.length !== 1 ? 's' : ''} ({coverage.degraded_steps.join(', ')}) — treat any &quot;not observed&quot; result tied to those steps as inconclusive rather than a confirmed pass or fail.
              </>
            )}
          </p>
        </div>
      )}

      {notApplicableLayers.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Not applicable to this site: {notApplicableLayers.map((l) => l.label).join(', ')}.
        </p>
      )}

      {coverage && <LayerCoverageTable coverage={coverage} />}

      <StatusBanner
        status={executive_summary.overall_status}
        summary={executive_summary.business_summary}
      />

      {comparison && comparison.delta !== 0 && (
        <div className={`rounded-xl border px-5 py-4 flex items-center justify-between ${
          comparison.delta > 0
            ? 'border-green-200 bg-green-50'
            : 'border-red-100 bg-red-50'
        }`}>
          <div>
            <p className={`text-sm font-semibold ${comparison.delta > 0 ? 'text-green-800' : 'text-red-800'}`}>
              {comparison.delta > 0 ? 'Tracking improved since last audit' : 'Tracking regressed since last audit'}
            </p>
            <p className={`text-xs mt-0.5 ${comparison.delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
              Signal Health: {comparison.previous_score} &rarr; {comparison.current_score} ({comparison.delta > 0 ? '+' : ''}{comparison.delta} points) &middot; Previous audit: {new Date(comparison.previous_audit_date).toLocaleDateString()}
            </p>
          </div>
          <span className={`text-2xl font-bold tabular-nums ${comparison.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {comparison.delta > 0 ? `+${comparison.delta}` : comparison.delta}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard
          title="Conversion Signal Health"
          value={scores.conversion_signal_health === null ? 'Not assessed' : `${scores.conversion_signal_health} / 100`}
          valueColor={scores.conversion_signal_health === null ? 'default' : scoreColor(scores.conversion_signal_health)}
          description={
            scores.conversion_signal_health === null
              ? 'Withheld — see the Coverage Gate notice above.'
              : scores.conversion_signal_health >= 80
              ? 'Signals are reaching your ad platforms.'
              : scores.conversion_signal_health >= 60
              ? 'Most signals are reaching ad platforms, but key data is missing.'
              : 'Significant gaps are preventing accurate conversion tracking.'
          }
          tooltipEntry={TOOLTIPS.conversionSignalHealth}
        />
        <ScoreCard
          title="Attribution Risk"
          value={scores.attribution_risk_level ?? 'Not assessed'}
          valueColor={scores.attribution_risk_level === null ? 'default' : riskColor(scores.attribution_risk_level)}
          description={
            scores.attribution_risk_level === null
              ? 'Not enough of this score\'s layers were confirmed to give a rating.'
              : 'Likelihood that ad click IDs are being lost before conversion. Low is best.'
          }
          tooltipEntry={TOOLTIPS.attributionRisk}
        />
        <ScoreCard
          title="Optimization Strength"
          value={scores.optimization_strength ?? 'Not assessed'}
          valueColor={scores.optimization_strength === null ? 'default' : strengthColor(scores.optimization_strength)}
          description={
            scores.optimization_strength === null
              ? 'Not enough of this score\'s layers were confirmed to give a rating.'
              : 'How much user data is available to improve ad performance. Strong is best.'
          }
          tooltipEntry={TOOLTIPS.optimizationStrength}
        />
        <ScoreCard
          title="Data Consistency"
          value={scores.data_consistency_score ?? 'Not assessed'}
          valueColor={scores.data_consistency_score === null ? 'default' : consistencyColor(scores.data_consistency_score)}
          description={
            scores.data_consistency_score === null
              ? 'Not enough of this score\'s layer was confirmed to give a rating.'
              : 'Consistency of event deduplication between browser and server. High is best.'
          }
          tooltipEntry={TOOLTIPS.dataConsistency}
        />
      </div>

      {executive_summary.overall_status === 'healthy' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
          <p className="font-semibold text-green-800">All signals are functioning correctly.</p>
          <p className="mt-1 text-sm text-green-700">You can scale paid campaigns with confidence.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Full 13-layer coverage breakdown (Signal vs Implementation PRD P0-02) —
 * every layer, assessed or not, with a one-line status and reason. A layer
 * not present in `coverage.layers_not_tested` was assessed (at least one
 * non-skipped result); everything else pulls its state/reason straight
 * from the backend's already-correct classifyUntestedLayers() output —
 * this component adds no new computation, only visibility.
 */
function LayerCoverageTable({ coverage }: { coverage: NonNullable<ReportJSON['executive_summary']['coverage']> }) {
  const notTestedByLayer = new Map(coverage.layers_not_tested.map((l) => [l.layer, l]));
  const assessedCount = V2_LAYER_ORDER.length - coverage.layers_not_tested.length;

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Signal layer coverage</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {assessedCount} of {V2_LAYER_ORDER.length} signal layers assessed.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {V2_LAYER_ORDER.map(({ layer, label }) => {
          const notTested = notTestedByLayer.get(layer);
          const statusLabel = notTested
            ? notTested.state === 'not_scanned' ? 'Not scanned' : 'Not applicable'
            : 'Assessed';
          const statusClass = notTested
            ? notTested.state === 'not_scanned' ? 'text-amber-700 bg-amber-50' : 'text-slate-600 bg-slate-100'
            : 'text-green-700 bg-green-50';
          return (
            <div key={layer} className="flex items-start justify-between gap-4 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-slate-900">{label}</p>
                {notTested && <p className="mt-0.5 text-xs text-muted-foreground">{notTested.reason}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>{statusLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
