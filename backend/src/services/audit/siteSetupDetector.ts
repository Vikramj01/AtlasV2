/**
 * Site Setup detection — assembles an informational (non-scored) summary of
 * what tracking infrastructure was observed during an audit's journey
 * simulation: dataLayer contents, tag/pixel presence, live GTM container ID,
 * and a best-effort server-side GTM heuristic.
 */
import type {
  AuditData,
  DataLayerEvent,
  DetectedTagPlatform,
  DetectedTagSignal,
  DataLayerEventInventoryEntry,
  NetworkRequest,
  PossibleServerSideGtm,
  ServerSideGtmHeuristic,
  SiteSetupSummary,
} from '@/types/audit';
import * as trackingSignals from '@/services/detection/trackingSignals';
import type { TagMatch } from '@/services/detection/trackingSignals';

const MAX_EVIDENCE_URLS = 5;
const DATALAYER_META_KEYS = new Set(['event', 'timestamp', 'step', '__step', '__timestamp']);

/** Group captured dataLayer events by name, summarizing what params each one carries. */
export function buildDataLayerInventory(events: DataLayerEvent[]): DataLayerEventInventoryEntry[] {
  const byName = new Map<string, { count: number; keys: Set<string>; steps: Set<string> }>();

  for (const ev of events) {
    const name = ev.event || '(unnamed)';
    let entry = byName.get(name);
    if (!entry) {
      entry = { count: 0, keys: new Set(), steps: new Set() };
      byName.set(name, entry);
    }
    entry.count += 1;
    if (ev.step) entry.steps.add(ev.step);
    for (const key of Object.keys(ev)) {
      if (!DATALAYER_META_KEYS.has(key)) entry.keys.add(key);
    }
  }

  return [...byName.entries()].map(([event_name, entry]) => ({
    event_name,
    occurrence_count: entry.count,
    parameter_keys: [...entry.keys].sort(),
    steps_seen: [...entry.steps],
  }));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Naive eTLD+1 comparison — last two dot-separated labels. Good enough for a best-effort signal. */
function baseDomain(hostname: string): string {
  const parts = hostname.split('.').filter(Boolean);
  return parts.slice(-2).join('.');
}

function isSameSite(requestHostname: string, websiteHostname: string): boolean {
  if (!requestHostname || !websiteHostname) return false;
  return baseDomain(requestHostname) === baseDomain(websiteHostname);
}

const KNOWN_ANALYTICS_HOSTS_SUFFIXES = ['google.com', 'google-analytics.com', 'googletagmanager.com'];
const KNOWN_META_HOST_SUFFIXES = ['facebook.com', 'facebook.net'];

/**
 * Best-effort detection of server-side GTM / a custom-domain tagging proxy
 * (e.g. stape.io-style setups). Always labeled a "possible" signal — never
 * treated as a confirmed fact by any caller.
 */
export function detectPossibleServerSideGtm(
  requests: NetworkRequest[],
  websiteHostname: string,
): PossibleServerSideGtm {
  const matched: ServerSideGtmHeuristic[] = [];
  const candidateHosts = new Set<string>();
  const evidenceUrls: string[] = [];

  const recordEvidence = (hits: NetworkRequest[]) => {
    for (const r of hits) {
      const host = safeHostname(r.url);
      if (host) candidateHosts.add(host);
      if (evidenceUrls.length < MAX_EVIDENCE_URLS && !evidenceUrls.includes(r.url)) {
        evidenceUrls.push(r.url);
      }
    }
  };

  // Heuristic 1: known sGTM URL keyword (existing narrow signal, kept as one input among several).
  const keywordHits = requests.filter((r) => r.url.includes('sgtm') || r.url.includes('gtm-msr'));
  if (keywordHits.length > 0) {
    matched.push('domain_keyword');
    recordEvidence(keywordHits);
  }

  // Heuristic 2: first-party host forwarding requests shaped like GA4 Measurement Protocol.
  const mpHits = requests.filter((r) => {
    const host = safeHostname(r.url);
    if (!isSameSite(host, websiteHostname)) return false;
    if (KNOWN_ANALYTICS_HOSTS_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
    return r.url.includes('/g/collect') || r.url.includes('/mp/collect');
  });
  if (mpHits.length > 0) {
    matched.push('firstparty_measurement_protocol_shape');
    recordEvidence(mpHits);
  }

  // Heuristic 3: first-party host forwarding requests shaped like a Meta CAPI payload.
  const capiHits = requests.filter((r) => {
    const host = safeHostname(r.url);
    if (!isSameSite(host, websiteHostname)) return false;
    if (KNOWN_META_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
    const body = r.body ?? '';
    return body.includes('action_source') || (body.includes('event_name') && body.includes('event_id'));
  });
  if (capiHits.length > 0) {
    matched.push('firstparty_capi_forward_shape');
    recordEvidence(capiHits);
  }

  const detected = matched.length > 0;
  const structuralMatch = matched.some((m) => m !== 'domain_keyword');

  return {
    detected,
    confidence: structuralMatch ? 'medium' : 'low',
    candidate_hosts: [...candidateHosts],
    matched_heuristics: matched,
    evidence_urls: evidenceUrls,
    caveat: detected
      ? 'This is a best-effort heuristic based on request path/hostname shape, not a confirmed server-side GTM installation. Verify manually if this signal is business-critical.'
      : '',
  };
}

function toTagSignal(platform: DetectedTagPlatform, match: TagMatch): DetectedTagSignal {
  return {
    platform,
    detected: match.hitCount > 0 || match.ids.length > 0,
    ids: match.ids,
    hit_count: match.hitCount,
    evidence_urls: match.urls,
  };
}

/**
 * Assemble the full Site Setup summary from an audit's captured data plus
 * the GTM `<script src>` values collected live from the page during simulation.
 */
export function buildSiteSetupSummary(
  auditData: Pick<AuditData, 'dataLayer' | 'networkRequests' | 'website_url'>,
  gtmScriptSrcs: string[],
): SiteSetupSummary {
  const { dataLayer, networkRequests, website_url } = auditData;
  const hostname = safeHostname(website_url);
  const gtmIds = trackingSignals.extractGtmContainerIdsFromScriptSrcs(gtmScriptSrcs);

  return {
    generated_at: new Date().toISOString(),
    datalayer_inventory: buildDataLayerInventory(dataLayer),
    tags: [
      toTagSignal('ga4', trackingSignals.detectGa4(networkRequests)),
      toTagSignal('meta_pixel', trackingSignals.detectMetaPixel(networkRequests)),
      toTagSignal('google_ads', trackingSignals.detectGoogleAds(networkRequests)),
      toTagSignal('linkedin_insight', trackingSignals.detectLinkedInInsight(networkRequests)),
      toTagSignal('tiktok_pixel', trackingSignals.detectTikTokPixel(networkRequests)),
      toTagSignal('microsoft_uet', trackingSignals.detectMicrosoftUet(networkRequests)),
    ],
    gtm_container: { detected: gtmIds.length > 0, container_ids: gtmIds },
    possible_server_side_gtm: detectPossibleServerSideGtm(networkRequests, hostname),
  };
}
