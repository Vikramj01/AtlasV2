/**
 * Google Tag Gateway status — frontend mirror of backend/src/services/gtg/gtgStatus.ts
 * (the frontend cannot import backend code). docs/prd/google-tag-gateway.md §5.1.
 */
export type GtgStatus =
  | 'verified'
  | 'verified_no_geo'
  | 'detected_unverified'
  | 'partial'
  | 'legacy'
  | 'broken'
  | 'not_detected'
  | 'not_applicable'
  | 'unknown';

export const GTG_STATUS_LABELS: Record<GtgStatus, string> = {
  verified: 'Verified',
  verified_no_geo: 'No location headers',
  detected_unverified: 'Detected',
  partial: 'Partly routed',
  legacy: 'Legacy setup',
  broken: 'Broken',
  not_detected: 'Not detected',
  not_applicable: 'Not applicable',
  unknown: 'Not checked',
};

/** One short, factual line per status. No uplift figures: Atlas has not measured any. */
export const GTG_STATUS_SUBTEXT: Record<GtgStatus, string> = {
  verified: 'Routing and location headers verified',
  verified_no_geo: 'Routing works; location headers missing',
  detected_unverified: 'Seen on your site; not yet verified',
  partial: 'Some tags still load from Google',
  legacy: 'Older proxy pattern detected',
  broken: 'Gateway path failing its health check',
  not_detected: 'Tags load from Google directly',
  not_applicable: 'Not practical for this setup',
  unknown: 'Run a scan to check',
};

/** Missing or unrecognised values resolve to 'unknown', never to a guess. */
export function normaliseGtgStatus(value: unknown): GtgStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GTG_STATUS_LABELS, value) ? (value as GtgStatus) : 'unknown';
}

export type GtgTone = 'good' | 'warning' | 'critical' | 'neutral';

export function gtgTone(status: GtgStatus): GtgTone {
  switch (status) {
    case 'verified':
      return 'good';
    case 'broken':
      return 'critical';
    case 'verified_no_geo':
    case 'partial':
    case 'legacy':
    case 'not_detected':
      return 'warning';
    default:
      return 'neutral';
  }
}
