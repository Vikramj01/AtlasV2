/**
 * The Check Register v2 layer enum, as ordered data (Report Correctness
 * Programme PRD Part D1/D2) — the single source of truth for "how many
 * layers does this rule set define," so a report's denominator can never
 * again be derived from which layers happened to produce a result this
 * run (the exact defect that made OpenArt show "7 of 11" and Birkenstock
 * "7 of 12" — two different denominators for the same fixed rule set).
 * reporting.ts and scoring.ts both read this rather than each computing
 * their own list.
 */
import type { ValidationLayerV2 } from '@/types/audit';

/**
 * Check Register version (Report Correctness Programme PRD Part D4/D5) —
 * bump this on any rule addition, removal, or severity change. Stamped on
 * every v2 audit (ReportJSON.register_version, audits.register_version)
 * so a score's mover can be explained after a release ("this audit ran
 * against register 1.1.0, the previous one against 1.0.0"). Per D5's
 * decision, a historical audit's stored score is never recomputed when
 * this bumps — it stands as issued, tagged with the version that produced
 * it; only the display can note that two scores aren't directly comparable
 * across a version change.
 */
export const REGISTER_VERSION = '1.1.0';

export const ALL_V2_LAYERS: ValidationLayerV2[] = [
  'scope_configuration', 'foundation_tags', 'click_id_capture', 'storage_durability',
  'cross_domain_continuity', 'event_firing', 'parameter_completeness', 'identity_match_quality',
  'consent', 'server_side_delivery', 'deduplication', 'reconciliation', 'hygiene_integrity',
];

/**
 * Scoring & Coverage Gate (Pre-Connection Scan Confidence Tiering PRD §9).
 *
 * Every layer's relative importance to the overall score — PRD §9.1.2
 * declares this per layer but gives no differentiated weighting scheme, so
 * (matching the same "ship a fixed value, revisit only if it misbehaves"
 * call already made for COVERAGE_GATE_THRESHOLD, PRD §17 Q2) every layer
 * defaults to equal weight.
 */
export const LAYER_WEIGHT: Record<ValidationLayerV2, number> = Object.fromEntries(
  ALL_V2_LAYERS.map((layer) => [layer, 1]),
) as Record<ValidationLayerV2, number>;

/**
 * The fraction of a layer's applicable-this-run rules that must reach
 * `verdict: 'PASS' | 'FAIL'` (§4.3's CONFIRMED-and-resolved verdicts)
 * before that layer counts toward coverage_ratio at all (PRD §9.1.2 —
 * "min_confirmed_rules"). Expressed as a ratio of *this run's applicable*
 * rules rather than a hardcoded absolute count against the full register:
 * a fixed absolute number would either go stale every time a rule is
 * added/split/removed (the exact drift class ALL_V2_LAYERS/
 * PLATFORM_MATCHER_HOSTS already exist to prevent elsewhere in this
 * register), or — worse — permanently exclude a legitimately rule-thin
 * layer for a site_type that applies_to filters most of that layer's
 * rules out of scope for. A shared default, like LAYER_WEIGHT above, since
 * the PRD specifies no differentiated per-layer scheme.
 */
export const MIN_CONFIRMED_RATIO = 0.5;

/** PRD §9.1.4 — below this, the overall (and, at their own layer scope, each sub-) score is withheld rather than shown partial. */
export const COVERAGE_GATE_THRESHOLD = 0.6;

export const LAYER_LABELS: Record<ValidationLayerV2, string> = {
  scope_configuration: 'L0 · Scope & Configuration',
  foundation_tags: 'L1 · Foundation & Tags',
  click_id_capture: 'L2 · Click ID Capture',
  storage_durability: 'L3 · Storage Durability',
  cross_domain_continuity: 'L4 · Cross-Domain Continuity',
  event_firing: 'L5 · Event Firing',
  parameter_completeness: 'L6 · Parameter Completeness',
  identity_match_quality: 'L7 · Identity & Match Quality',
  consent: 'L8 · Consent',
  server_side_delivery: 'L9 · Server-Side Delivery',
  deduplication: 'L10 · Deduplication',
  reconciliation: 'L11 · Reconciliation',
  hygiene_integrity: 'L12 · Hygiene & Integrity',
};
