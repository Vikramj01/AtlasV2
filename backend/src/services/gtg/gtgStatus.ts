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

// ── Capture-derived status (Sprint 2) ────────────────────────────────────────

/** The subset of a Google capture summary the status derivation reads. */
export interface GtgCaptureEvidence {
  /** Loader requests (GTM container / Google tag) served via a gateway path or unattributable same-site path. */
  hasFirstPartyLoad: boolean;
  /** Loader requests served from a Google-owned host. */
  hasGoogleDirectLoad: boolean;
  /** True when a first-party loader is attributed to a gateway rather than merely same-site. */
  firstPartyIsGateway: boolean;
}

/**
 * - first-party loads AND Google-direct loads  → 'partial'
 * - first-party loads only                     → 'detected_unverified'
 * - Google-direct loads only                   → 'not_detected'
 * - no loader seen at all                      → 'unknown' (absence of evidence is not "not detected")
 */
export function gtgStatusFromCapture(e: GtgCaptureEvidence): GtgStatus {
  if (e.hasFirstPartyLoad && e.hasGoogleDirectLoad) return 'partial';
  if (e.hasFirstPartyLoad) return e.firstPartyIsGateway ? 'detected_unverified' : 'unknown';
  if (e.hasGoogleDirectLoad) return 'not_detected';
  return 'unknown';
}

// ── Probe-derived status (Sprint 3) ──────────────────────────────────────────

/** One endpoint's verdict from a probe run. 'inconclusive' = the probe could not decide (rate limit, network, unexpected body, geo not checked). */
export type EndpointProbeVerdict = 'ok' | 'no_geo' | 'broken' | 'inconclusive';
/** A client's probes rolled up. 'none' = no endpoint was probed at all. */
export type ProbeSummary = 'none' | 'inconclusive' | 'broken' | 'ok' | 'no_geo';

export const PROBE_SUMMARIES: readonly ProbeSummary[] = ['none', 'inconclusive', 'broken', 'ok', 'no_geo'];

export function normaliseProbeSummary(value: unknown): ProbeSummary {
  return typeof value === 'string' && (PROBE_SUMMARIES as readonly string[]).includes(value)
    ? (value as ProbeSummary)
    : 'none';
}

/** The probe outcome the per-endpoint verdict is derived from. */
export interface ProbeOutcome {
  pathStatus: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
  geoStatus: 'pass' | 'fail' | 'skipped';
}

/**
 * - /healthy failed or timed out        → broken (the registered path does not route to the gateway)
 * - /healthy 'error' (rate limit, network, body not understood) → inconclusive, never broken
 * - /healthy passed, geo failed         → no_geo (routing works, location headers missing)
 * - /healthy passed, geo skipped        → inconclusive (cannot claim verified without the geo check)
 * - both passed                         → ok
 */
export function endpointVerdict(o: ProbeOutcome): EndpointProbeVerdict {
  if (o.pathStatus === 'fail' || o.pathStatus === 'timeout') return 'broken';
  if (o.pathStatus === 'error') return 'inconclusive';
  if (o.geoStatus === 'fail') return 'no_geo';
  if (o.geoStatus === 'skipped') return 'inconclusive';
  return 'ok';
}

/** any broken → broken; else any inconclusive → inconclusive; else any no_geo → no_geo; else ok; none probed → none. */
export function summariseProbes(verdicts: readonly EndpointProbeVerdict[]): ProbeSummary {
  if (verdicts.length === 0) return 'none';
  if (verdicts.includes('broken')) return 'broken';
  if (verdicts.includes('inconclusive')) return 'inconclusive';
  if (verdicts.includes('no_geo')) return 'no_geo';
  return 'ok';
}

/** PRD §5.1: `verified` needs a pass within the last 24 hours. An older probe is treated as inconclusive. */
export const PROBE_FRESH_HOURS = 24;

export function effectiveProbeSummary(summary: ProbeSummary, checkedAt: string | null, now: Date = new Date()): ProbeSummary {
  if (summary === 'none' || summary === 'inconclusive') return summary;
  if (!checkedAt) return 'inconclusive';
  const ageMs = now.getTime() - new Date(checkedAt).getTime();
  return Number.isFinite(ageMs) && ageMs <= PROBE_FRESH_HOURS * 3_600_000 ? summary : 'inconclusive';
}

export interface CombineInput {
  /** The stored clients.gtg_status. */
  current: GtgStatus;
  /** Last capture-derived status ('unknown' when no capture has seen a loader). */
  capture: GtgStatus;
  /** Probe summary, already passed through effectiveProbeSummary(). */
  probe: ProbeSummary;
}

/**
 * The one place a client's gtg_status is decided from its two evidence streams
 * (PRD §5.1). A capture says what the PAGE loads; a probe says whether the
 * registered PATH works. `verified` needs both.
 *
 * - an operator-declared 'not_applicable' is never overwritten here
 * - a failing registered path is 'broken' whatever the page does (it can cost the container)
 * - a working path with a capture that shows the page using it → verified / verified_no_geo
 * - a working path but the page still loads from Google       → not_detected (applicable, absent)
 * - a working path with a partly-routed page                   → partial
 * - a working path with no capture yet                         → unknown (cannot claim the page uses it)
 * - an inconclusive probe never regresses a verified/broken value; it falls back to the capture otherwise
 */
export function combineGtgStatus({ current, capture, probe }: CombineInput): GtgStatus {
  if (current === 'not_applicable') return 'not_applicable';
  if (current === 'legacy') return 'legacy';

  if (probe === 'broken') return 'broken';

  if (probe === 'ok' || probe === 'no_geo') {
    if (capture === 'detected_unverified') return probe === 'ok' ? 'verified' : 'verified_no_geo';
    if (capture === 'partial') return 'partial';
    if (capture === 'not_detected') return 'not_detected';
    return 'unknown';
  }

  if (probe === 'inconclusive') {
    return current === 'verified' || current === 'verified_no_geo' || current === 'broken' ? current : capture;
  }

  return capture; // no endpoint registered or probed: the capture decides, as in Sprint 2
}
