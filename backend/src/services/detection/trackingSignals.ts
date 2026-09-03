/**
 * Tracking signal detection — pure, framework-agnostic functions that inspect
 * already-captured network requests / script tags for tag & pixel presence.
 *
 * Deliberately has no Playwright dependency and does not import from
 * services/crawl/* — audit and crawl are separate pipelines (per-journey-step
 * vs per-page-batch) and this module exists so both could reuse the same
 * detection logic without coupling one service to the other.
 */
import type { NetworkRequest } from '@/types/audit';

export interface TagMatch {
  ids: string[];
  hitCount: number;
  urls: string[];
}

const MAX_EVIDENCE_URLS = 5;

function searchParam(url: string, key: string): string | null {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

/** A GA4 hit's param, checked in the URL query string first, then the POST body (gtag sends both shapes). */
export function ga4RequestParam(request: NetworkRequest, key: string): string | null {
  const fromQuery = searchParam(request.url, key);
  if (fromQuery) return fromQuery;
  if (!request.body) return null;
  try {
    return new URLSearchParams(request.body).get(key);
  } catch {
    return null;
  }
}

function isGa4CollectRequest(request: NetworkRequest): boolean {
  return request.url.includes('google-analytics.com/g/collect') || request.url.includes('analytics.google.com/g/collect');
}

function buildMatch(hits: NetworkRequest[], ids: (string | null)[]): TagMatch {
  return {
    ids: [...new Set(ids.filter((id): id is string => !!id))],
    hitCount: hits.length,
    urls: hits.slice(0, MAX_EVIDENCE_URLS).map((r) => r.url),
  };
}

/** GA4 base pageview/event hits — measurement ID via the `tid` query param. */
export function detectGa4(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter(isGa4CollectRequest);
  return buildMatch(hits, hits.map((r) => searchParam(r.url, 'tid')));
}

/**
 * GA4's client_id — read directly from a collect hit's `cid` param when one
 * was captured (most reliable), falling back to the `_ga` cookie's value
 * (format `GA1.<domain_depth>.<client_id part 1>.<client_id part 2>` — the
 * client_id itself is the last two dot-separated segments, which is what
 * gtag.js actually sends as `cid`). Used by Cross-Domain Continuity (L4.3)
 * to compare the same visitor's client_id on either side of a domain
 * boundary.
 */
export function extractGa4ClientId(requests: NetworkRequest[], cookies: Record<string, string> = {}): string | undefined {
  const hit = requests.find((r) => isGa4CollectRequest(r) && ga4RequestParam(r, 'cid'));
  if (hit) return ga4RequestParam(hit, 'cid') ?? undefined;

  const gaCookie = cookies['_ga'];
  if (!gaCookie) return undefined;
  const parts = gaCookie.split('.');
  return parts.length >= 4 ? parts.slice(-2).join('.') : undefined;
}

/**
 * True if any GA4 hit in the given requests is a session-start hit (`_ss=1`
 * — GA4's own marker for the first hit of a new session). Used by
 * SESSION_NOT_RESTARTED_AT_BOUNDARY (L4.4): a session_start firing on the
 * product domain visit means GA4 treated the crossing as a brand new
 * session rather than a continuation.
 */
export function ga4SessionStartDetected(requests: NetworkRequest[]): boolean {
  return requests.some((r) => isGa4CollectRequest(r) && ga4RequestParam(r, '_ss') === '1');
}

/** Meta Pixel — pixel ID via the `id` query param on facebook.com/tr or the connect.facebook.net loader. */
export function detectMetaPixel(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('facebook.com/tr') || r.url.includes('connect.facebook.net'));
  return buildMatch(hits, hits.map((r) => searchParam(r.url, 'id')));
}

/**
 * A Meta Pixel call carrying an actual tracked event (`fbq('track', 'Purchase', ...)`
 * and friends) rather than just the base pageview the loader itself fires —
 * `ev=` present and not `PageView`. Used by META_CONVERSION_EVENT_FIRES
 * (L5.3) to distinguish "the pixel is installed" (L1.7) from "a conversion
 * event actually fired".
 */
export function detectMetaConversionEvent(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => {
    if (!r.url.includes('facebook.com/tr')) return false;
    const ev = searchParam(r.url, 'ev') ?? (r.body ? new URLSearchParams(r.body).get('ev') : null);
    return !!ev && ev !== 'PageView';
  });
  return buildMatch(hits, []);
}

/** Google Ads conversion pixel — googleadservices.com/pagead/conversion or google.com/pagead/conversion. */
export function detectGoogleAds(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter(
    (r) => r.url.includes('googleadservices.com/pagead/conversion') || r.url.includes('google.com/pagead/conversion'),
  );
  return buildMatch(hits, []);
}

/** TikTok Pixel — analytics.tiktok.com. No stable public ID param to extract. */
export function detectTikTokPixel(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('analytics.tiktok.com'));
  return buildMatch(hits, []);
}

/**
 * A TikTok pixel event track call, not just the base pixel loader script —
 * the loader is a GET for the .js file, while ttq.track() calls POST to the
 * tracking endpoint. Used by TIKTOK_CONVERSION_EVENT_FIRES (L5.4) to
 * distinguish "the pixel is installed" (L1.8) from "an event actually fired".
 */
export function detectTikTokConversionEvent(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('analytics.tiktok.com') && r.method === 'POST');
  return buildMatch(hits, []);
}

/** LinkedIn Insight Tag — snap.licdn.com or linkedin.com/px. No stable public ID param to extract. */
export function detectLinkedInInsight(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('snap.licdn.com') || r.url.includes('linkedin.com/px'));
  return buildMatch(hits, []);
}

/** Microsoft UET (Bing Ads) — bat.bing.com, tag ID via the `ti` query param. */
export function detectMicrosoftUet(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('bat.bing.com'));
  return buildMatch(hits, hits.map((r) => searchParam(r.url, 'ti')));
}

/**
 * Given raw <script src> attribute values collected from the live page,
 * extract GTM container IDs (GTM-XXXXXXX) from the gtm.js loader script.
 */
export function extractGtmContainerIdsFromScriptSrcs(srcs: string[]): string[] {
  const ids = srcs
    .filter((src) => src.includes('googletagmanager.com/gtm.js'))
    .map((src) => searchParam(src, 'id'));
  return [...new Set(ids.filter((id): id is string => !!id))];
}
