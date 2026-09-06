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
export const REGISTER_VERSION = '1.0.0';

export const ALL_V2_LAYERS: ValidationLayerV2[] = [
  'scope_configuration', 'foundation_tags', 'click_id_capture', 'storage_durability',
  'cross_domain_continuity', 'event_firing', 'parameter_completeness', 'identity_match_quality',
  'consent', 'server_side_delivery', 'deduplication', 'reconciliation', 'hygiene_integrity',
];

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
