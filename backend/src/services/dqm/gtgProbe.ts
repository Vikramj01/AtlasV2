// GTG Path Health Probe — probes each client's REGISTERED Google tag gateway
// path (docs/prd/google-tag-gateway.md §6.3).
//
// The previous probe sent a HEAD to Google's own CDN, so `dqm_gtg` alerts tracked
// Google's uptime and could never detect a broken client path. This one probes
// the client's own domain, using the two checks Google documents:
//   1. GET https://{host}{path}/healthy                → 200 and body `ok`
//   2. GET https://{host}{path}/?validate_geo=healthy  → 200 and body `ok` only if
//      the CDN is forwarding visitor-location headers
//
// The probe originates from Atlas's own server, so the geo check proves the CDN
// rule is in place (it adds location headers to Atlas's request), not where any
// visitor is. Atlas only ever probes a path the client registered or Atlas
// detected from a capture, never a guess.

import { supabaseAdmin } from '@/services/database/supabase';
import { endpointProbeUrls } from '@/services/gtg/gtgEndpoints';
import { endpointVerdict, summariseProbes, type EndpointProbeVerdict, type ProbeSummary } from '@/services/gtg/gtgStatus';
import { validateUrl } from '@/utils/urlValidator';
import logger from '@/utils/logger';

export const GTG_PROBE_USER_AGENT = 'AtlasGTGProbe/1.0 (+https://atlas.vimi.digital; Google tag gateway health check)';

/** A real gateway answer is the two characters `ok`; anything larger is some other page. */
const MAX_BODY_CHARS = 2_000;

export interface GtgEndpointRow {
  id: string;
  org_id: string;
  client_id: string;
  hostname: string;
  reserved_path: string;
  tag_or_container: string;
}

export interface GtgProbeResult {
  endpointId: string;
  clientId: string;
  healthyUrl: string;
  pathStatus: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
  geoStatus: 'pass' | 'fail' | 'skipped';
  httpStatus: number | null;
  responseMs: number | null;
  errorMessage: string | null;
  /** The host answered 403/429: back off, do not probe it again this run. */
  rateLimited: boolean;
  verdict: EndpointProbeVerdict;
}

export type GtgFetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

interface Fetched {
  status: number | null;
  body: string;
  contentType: string;
  timedOut: boolean;
  failed: string | null;
  ms: number;
}

async function fetchText(url: string, timeoutMs: number, doFetch: GtgFetch): Promise<Fetched> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { method: 'GET', headers: { 'User-Agent': GTG_PROBE_USER_AGENT, Accept: 'text/plain,*/*' }, signal: controller.signal });
    const text = (await res.text()).slice(0, MAX_BODY_CHARS);
    return { status: res.status, body: text, contentType: res.headers.get('content-type') ?? '', timedOut: false, failed: null, ms: Date.now() - start };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { status: null, body: '', contentType: '', timedOut, failed: err instanceof Error ? err.message : String(err), ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the body is a web page rather than the gateway's plain answer. */
function looksLikeWebPage(body: string, contentType: string): boolean {
  return /text\/html/i.test(contentType) || /^\s*</.test(body);
}

export type HealthyClassification = 'pass' | 'fail_not_routed' | 'fail_http' | 'rate_limited' | 'unexpected_body';

/**
 * Classifies a /healthy response. The body is checked, not only the status: a
 * site's catch-all 200 page would otherwise pass (PRD §6.3).
 *  - 200 + `ok`                          → pass
 *  - 200 + an HTML page                  → fail (the path is not routed to the gateway)
 *  - 200 + other short plain text        → unexpected_body → 'error', never 'fail': Google may
 *    have changed this contract (PRD §13), and Atlas must not call a gateway broken on that
 *  - 403 / 429                           → rate_limited (back off)
 *  - any other non-200                   → fail
 */
export function classifyHealthyResponse(status: number, body: string, contentType: string): HealthyClassification {
  if (status === 403 || status === 429) return 'rate_limited';
  if (status !== 200) return 'fail_http';
  if (body.trim().toLowerCase() === 'ok') return 'pass';
  return looksLikeWebPage(body, contentType) ? 'fail_not_routed' : 'unexpected_body';
}

/** /?validate_geo=healthy: `ok` only if location headers arrived. Anything else on a reachable path means they did not. */
export function classifyGeoResponse(status: number, body: string): 'pass' | 'fail' | 'skipped' {
  if (status === 403 || status === 429) return 'skipped';
  return status === 200 && body.trim().toLowerCase() === 'ok' ? 'pass' : 'fail';
}

export async function probeGtgEndpoint(
  ep: GtgEndpointRow,
  degradedThresholdMs = 2000,
  opts: { timeoutMs?: number; fetchImpl?: GtgFetch } = {},
): Promise<GtgProbeResult> {
  const doFetch = opts.fetchImpl ?? (fetch as unknown as GtgFetch);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const urls = endpointProbeUrls(ep);

  const base = {
    endpointId: ep.id,
    clientId: ep.client_id,
    healthyUrl: urls.healthy,
  };
  const done = (r: Omit<GtgProbeResult, 'verdict' | 'endpointId' | 'clientId' | 'healthyUrl'>): GtgProbeResult => ({
    ...base,
    ...r,
    verdict: endpointVerdict({ pathStatus: r.pathStatus, geoStatus: r.geoStatus }),
  });

  // Defence in depth: the hostname was validated on write, re-check before any request.
  const guard = validateUrl(urls.healthy);
  if (!guard.valid) {
    return done({ pathStatus: 'error', geoStatus: 'skipped', httpStatus: null, responseMs: null, errorMessage: guard.error ?? 'Endpoint URL rejected', rateLimited: false });
  }

  const healthy = await fetchText(urls.healthy, timeoutMs, doFetch);
  if (healthy.timedOut) {
    return done({ pathStatus: 'timeout', geoStatus: 'skipped', httpStatus: null, responseMs: healthy.ms, errorMessage: 'Timed out', rateLimited: false });
  }
  if (healthy.status === null) {
    return done({ pathStatus: 'error', geoStatus: 'skipped', httpStatus: null, responseMs: healthy.ms, errorMessage: healthy.failed, rateLimited: false });
  }

  const c = classifyHealthyResponse(healthy.status, healthy.body, healthy.contentType);
  if (c === 'rate_limited') {
    return done({ pathStatus: 'error', geoStatus: 'skipped', httpStatus: healthy.status, responseMs: healthy.ms, errorMessage: `HTTP ${healthy.status} (rate limited or blocked)`, rateLimited: true });
  }
  if (c === 'unexpected_body') {
    return done({ pathStatus: 'error', geoStatus: 'skipped', httpStatus: healthy.status, responseMs: healthy.ms, errorMessage: 'Unexpected /healthy response body', rateLimited: false });
  }
  if (c === 'fail_not_routed' || c === 'fail_http') {
    return done({
      pathStatus: 'fail', geoStatus: 'skipped', httpStatus: healthy.status, responseMs: healthy.ms,
      errorMessage: c === 'fail_not_routed' ? 'Path returned a web page, not the gateway health response' : `HTTP ${healthy.status}`,
      rateLimited: false,
    });
  }

  const pathStatus: GtgProbeResult['pathStatus'] = healthy.ms > degradedThresholdMs ? 'degraded' : 'pass';

  const geo = await fetchText(urls.geo, timeoutMs, doFetch);
  const geoStatus: GtgProbeResult['geoStatus'] = geo.status === null ? 'skipped' : classifyGeoResponse(geo.status, geo.body);

  return done({
    pathStatus,
    geoStatus,
    httpStatus: healthy.status,
    responseMs: healthy.ms,
    errorMessage: geoStatus === 'fail' ? 'Location headers are not reaching the gateway' : null,
    rateLimited: geo.status === 403 || geo.status === 429,
  });
}

/** Probes every registered endpoint in the list, backing off a host that rate-limits. Sequential on purpose: two light GETs per endpoint. */
export async function probeGtgEndpoints(
  endpoints: GtgEndpointRow[],
  degradedThresholdMs = 2000,
  opts: { fetchImpl?: GtgFetch } = {},
): Promise<GtgProbeResult[]> {
  const results: GtgProbeResult[] = [];
  const blockedHosts = new Set<string>();

  for (const ep of endpoints) {
    if (blockedHosts.has(ep.hostname)) {
      results.push({
        endpointId: ep.id, clientId: ep.client_id, healthyUrl: endpointProbeUrls(ep).healthy,
        pathStatus: 'error', geoStatus: 'skipped', httpStatus: null, responseMs: null,
        errorMessage: 'Skipped: host rate-limited an earlier probe in this run', rateLimited: true, verdict: 'inconclusive',
      });
      continue;
    }
    const r = await probeGtgEndpoint(ep, degradedThresholdMs, opts);
    if (r.rateLimited) blockedHosts.add(ep.hostname);
    results.push(r);
  }
  return results;
}

/** Per-client roll-up of a run's results. */
export function summariseByClient(results: GtgProbeResult[]): Map<string, ProbeSummary> {
  const byClient = new Map<string, EndpointProbeVerdict[]>();
  for (const r of results) {
    const list = byClient.get(r.clientId) ?? [];
    list.push(r.verdict);
    byClient.set(r.clientId, list);
  }
  return new Map([...byClient].map(([clientId, verdicts]) => [clientId, summariseProbes(verdicts)]));
}

export async function saveGtgChecks(orgId: string, results: GtgProbeResult[]): Promise<void> {
  if (results.length === 0) return;
  const { error } = await supabaseAdmin.from('dqm_gtg_checks').insert(
    results.map((r) => ({
      org_id: orgId,
      client_id: r.clientId,
      endpoint_id: r.endpointId,
      gtag_url: r.healthyUrl,
      http_status: r.httpStatus,
      response_ms: r.responseMs,
      check_status: r.pathStatus,
      geo_status: r.geoStatus,
      error_message: r.errorMessage,
    })),
  );
  if (error) logger.error({ err: error.message, orgId }, 'DQM: failed to save GTG checks');
}
