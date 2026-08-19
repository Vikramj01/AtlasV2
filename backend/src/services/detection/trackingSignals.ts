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

function buildMatch(hits: NetworkRequest[], ids: (string | null)[]): TagMatch {
  return {
    ids: [...new Set(ids.filter((id): id is string => !!id))],
    hitCount: hits.length,
    urls: hits.slice(0, MAX_EVIDENCE_URLS).map((r) => r.url),
  };
}

/** GA4 base pageview/event hits — measurement ID via the `tid` query param. */
export function detectGa4(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter(
    (r) => r.url.includes('google-analytics.com/g/collect') || r.url.includes('analytics.google.com/g/collect'),
  );
  return buildMatch(hits, hits.map((r) => searchParam(r.url, 'tid')));
}

/** Meta Pixel — pixel ID via the `id` query param on facebook.com/tr or the connect.facebook.net loader. */
export function detectMetaPixel(requests: NetworkRequest[]): TagMatch {
  const hits = requests.filter((r) => r.url.includes('facebook.com/tr') || r.url.includes('connect.facebook.net'));
  return buildMatch(hits, hits.map((r) => searchParam(r.url, 'id')));
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
