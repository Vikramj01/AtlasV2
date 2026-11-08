/**
 * Google Tag Gateway (GTG) status model — pure, no I/O.
 *
 * PRD: docs/prd/google-tag-gateway.md §5. Replaces the old boolean
 * `gtg_active`, which was true whenever a GTM OAuth connection existed
 * (a GTM connection is NOT evidence of a gateway).
 *
 * Status values are computed elsewhere (Sprint 2's matcher, Sprint 3's
 * probe). Until then every client is 'unknown', and 'unknown' never
 * caps a score or raises a "not deployed" flag (PRD D1).
 */

export const GTG_STATUSES = [
  'verified',
  'verified_no_geo',
  'detected_unverified',
  'partial',
  'legacy',
  'broken',
  'not_detected',
  'not_applicable',
  'unknown',
] as const;

export type GtgStatus = (typeof GTG_STATUSES)[number];

export function isGtgStatus(value: unknown): value is GtgStatus {
  return typeof value === 'string' && (GTG_STATUSES as readonly string[]).includes(value);
}

/** Coerce an unrecognised or missing stored value to 'unknown' — never guess. */
export function normaliseGtgStatus(value: unknown): GtgStatus {
  return isGtgStatus(value) ? value : 'unknown';
}

/** Compatibility boolean: routing verified on the client's own path. */
export function isGtgActive(status: GtgStatus): boolean {
  return status === 'verified' || status === 'verified_no_geo';
}

/**
 * Whether the 85-point health-score cap applies (PRD §5.3 / D1).
 * Only a gateway that is applicable-but-absent, or present-but-failing,
 * caps. 'unknown' and 'not_applicable' never do.
 */
export function shouldCapScore(status: GtgStatus): boolean {
  return status === 'not_detected' || status === 'broken';
}

/**
 * needs_action flags for the Data Manager Console (PRD §5.3).
 * `gtg_not_deployed` only for an applicable, observed absence.
 */
export function gtgNeedsActionFlags(status: GtgStatus): string[] {
  switch (status) {
    case 'not_detected':
      return ['gtg_not_deployed'];
    case 'broken':
      return ['gtg_broken'];
    case 'verified_no_geo':
      return ['gtg_geo_missing'];
    case 'partial':
      return ['gtg_partial'];
    default:
      return [];
  }
}

export const GTG_STATUS_LABELS: Record<GtgStatus, string> = {
  verified: 'Verified',
  verified_no_geo: 'Verified · no location headers',
  detected_unverified: 'Detected · not verified',
  partial: 'Partly routed',
  legacy: 'Legacy setup',
  broken: 'Broken',
  not_detected: 'Not detected',
  not_applicable: 'Not applicable',
  unknown: 'Not checked yet',
};

/**
 * Roll per-client statuses up to one org-level status for the org health score.
 *
 * - no clients / all 'unknown'           → 'unknown'
 * - all remaining 'not_applicable'       → 'not_applicable'
 * - any 'broken'                         → 'broken'
 * - every applicable client the same     → that status
 * - applicable clients all verified*     → 'verified' if all verified, else 'verified_no_geo'
 * - otherwise (mixed)                    → 'partial' (never caps)
 *
 * 'unknown' clients are ignored once at least one client has a known status:
 * an unchecked client is not evidence either way.
 */
export function aggregateGtgStatus(statuses: readonly GtgStatus[]): GtgStatus {
  const known = statuses.filter((s) => s !== 'unknown');
  if (known.length === 0) return 'unknown';

  const applicable = known.filter((s) => s !== 'not_applicable');
  if (applicable.length === 0) return 'not_applicable';

  if (applicable.includes('broken')) return 'broken';

  const first = applicable[0];
  if (applicable.every((s) => s === first)) return first;

  if (applicable.every(isGtgActive)) return 'verified_no_geo';

  return 'partial';
}
