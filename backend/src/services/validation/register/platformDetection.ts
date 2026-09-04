/**
 * Check Register v2 — shared per-platform base-tag detection.
 *
 * One place that answers "did platform X's base tag/pixel load on this
 * page view", built from network-request host/path signatures observed
 * during journey simulation. Used by L0.1 (declared platform has a tag)
 * and L0.2 (undeclared platform tag detected) here, and by the L1
 * per-platform "base tag present" rules (foundation_tags layer) so the
 * detection logic for "is platform X present" is defined exactly once.
 *
 * Google Ads and Meta signatures are the same hosts the v1 rule library
 * already checks (GOOGLE_ADS_CONVERSION_EVENT_FIRED / FBCLID_CAPTURED_AT_
 * LANDING in signalInitiation.ts/parameterCompleteness.ts) and the same
 * TikTok pixel loader URL gtmContainerGenerator.ts's "TikTok - Base Pixel"
 * tag itself loads (analytics.tiktok.com/i18n/pixel/events.js). LinkedIn,
 * Microsoft, Reddit, and Pinterest are each platform's own documented
 * pixel/conversion endpoint — lower confidence than the first three since
 * they haven't been cross-checked against a live account the way TikTok's
 * loader URL was; flagged here for easy correction if a real account shows
 * a different host.
 */
import type { AuditData, DeclaredPlatform, NetworkRequest } from '@/types/audit';

type HostMatcher = (req: NetworkRequest) => boolean;

const includesAny = (url: string, needles: string[]): boolean => needles.some((n) => url.includes(n));

/**
 * The literal host/path substrings each platform's matcher looks for —
 * factored out from PLATFORM_MATCHERS below (rather than duplicated) so
 * dataCapture.ts's TRACKED_URL_PATTERNS can be built as a superset of this
 * list. Before this, dataCapture.ts's own separately-maintained pattern
 * list didn't include Reddit/Pinterest/LinkedIn's px.ads host at all — a
 * declared platform whose matcher here could never actually match anything,
 * because the network listener never captured a matching request into
 * AuditData.networkRequests in the first place (Site Evaluation Coverage &
 * Honesty PRD §8.3, defect #4). See the invariant test in
 * dataCapture.test.ts that now guards against this recurring.
 */
export const PLATFORM_MATCHER_HOSTS: Record<DeclaredPlatform, string[]> = {
  google_ads: ['googleadservices.com', 'googleads.g.doubleclick.net', 'google.com/pagead', 'googletagmanager.com/gtag/js?id=AW-'],
  meta: ['facebook.com/tr'],
  tiktok: ['analytics.tiktok.com'],
  linkedin: ['snap.licdn.com', 'px.ads.linkedin.com'],
  microsoft: ['bat.bing.com'],
  reddit: ['alb.reddit.com'],
  pinterest: ['ct.pinterest.com', 's.pinimg.com/ct/core.js'],
};

const PLATFORM_MATCHERS: Record<DeclaredPlatform, HostMatcher> = Object.fromEntries(
  (Object.entries(PLATFORM_MATCHER_HOSTS) as Array<[DeclaredPlatform, string[]]>).map(
    ([platform, hosts]): [DeclaredPlatform, HostMatcher] => [platform, (r) => includesAny(r.url, hosts)],
  ),
) as Record<DeclaredPlatform, HostMatcher>;

export const ALL_DECLARED_PLATFORMS: DeclaredPlatform[] = [
  'google_ads', 'meta', 'tiktok', 'linkedin', 'microsoft', 'reddit', 'pinterest',
];

export const PLATFORM_LABELS: Record<DeclaredPlatform, string> = {
  google_ads: 'Google Ads',
  meta: 'Meta',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  microsoft: 'Microsoft',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
};

/** True if platform's base tag/pixel was observed firing anywhere during the crawl. */
export function platformTagDetected(platform: DeclaredPlatform, auditData: AuditData): boolean {
  const matcher = PLATFORM_MATCHERS[platform];
  return auditData.networkRequests.some(matcher);
}

/** Every request that matched platform's signature, for evidence. */
export function platformTagRequests(platform: DeclaredPlatform, auditData: AuditData): NetworkRequest[] {
  const matcher = PLATFORM_MATCHERS[platform];
  return auditData.networkRequests.filter(matcher);
}
