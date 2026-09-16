/**
 * Implementation path classification (Signal vs Implementation PRD P1-02).
 *
 * Turns P1-01's raw per-request CDP initiator capture (dataCapture.ts's
 * interceptRequestInitiators, AuditData.request_provenance) into "how did
 * this platform's signal actually reach the network for this page" — GTM,
 * a directly-loaded vendor script, or (given P1-03's commerce-platform
 * detection) a Shopify Web Pixels Manager sandbox. A pure function over
 * already-captured data: no crawl access, no async resolution, callable by
 * both the report generator and a future rule (per the PRD's own
 * acceptance criterion).
 *
 * A platform can genuinely carry more than one path on the same page at
 * once (a theme pixel plus a GTM tag, say) — this is not collapsed into a
 * single verdict per (platform, page); each distinct path observed gets
 * its own ImplementationPathClassification row, which is exactly the
 * multiplicity P1-06's duplicate-implementation detection needs to read.
 *
 * Deliberately conservative about three of the four Shopify-specific enum
 * values (SHOPIFY_APP_PIXEL/SHOPIFY_CUSTOM_PIXEL/SHOPIFY_THEME) and
 * SERVER_SIDE — see ImplementationPath's own docstring (types/audit.ts).
 * SHOPIFY_WEB_PIXEL itself activates once P1-03's commerce-platform
 * detection confirms the page is Shopify/Shopify-backed (Signal vs
 * Implementation PRD P1-04, path-only per the Sprint 10 spike): Shopify's
 * Web Pixels Manager sandbox is origin-isolated by design specifically so
 * nothing outside it can introspect which pixel (theme/app/custom) is
 * installed, so naming the more specific sub-type is never attempted —
 * only "a Shopify Web Pixels Manager sandbox fired here" is asserted, and
 * only when commerce-platform evidence actually supports it. Absent that
 * evidence, a cross-origin sandboxed frame still reports as UNKNOWN with
 * descriptive evidence rather than guessed at — asserting a mechanism this
 * register can't confirm would be the exact category error (a confident
 * claim the evidence doesn't support) this PRD exists to fix, one layer
 * down.
 */
import type { RequestInitiator, ImplementationPath, ImplementationPathClassification, DeclaredPlatform, NetworkRequest, CommercePlatformDetection } from '@/types/audit';
import { PLATFORM_MATCHER_HOSTS, ALL_DECLARED_PLATFORMS } from '@/services/validation/register/platformDetection';
import * as trackingSignals from '@/services/detection/trackingSignals';

/**
 * GTM's own loader shapes — 'gtm.js' for the client-side container,
 * 'gtm-msr' for a server-side (sGTM) container that renamed its endpoint
 * (dataCapture.ts's TRACKED_URL_PATTERNS already tracks both). Deliberately
 * distinct from 'gtag.js' (also served from googletagmanager.com, but
 * that's Google's *direct* gtag loader, not a GTM container — see L1.5's
 * GTAG_LOADER_PRESENT and L1.1's GTM_CONTAINER_LOADED, which the register
 * already keeps as two separate questions for the same reason).
 */
const GTM_LOADER_PATTERNS = ['googletagmanager.com/gtm.js', 'gtm-msr'];

function matchesPlatformHost(url: string, platform: DeclaredPlatform): boolean {
  return PLATFORM_MATCHER_HOSTS[platform].some((host) => url.includes(host));
}

/** Which declared-platform matcher (if any) this request's own URL belongs to — the platform whose signal this request IS, not who caused it. */
function platformForRequestUrl(url: string): DeclaredPlatform | undefined {
  return ALL_DECLARED_PLATFORMS.find((platform) => matchesPlatformHost(url, platform));
}

/**
 * "Was this URL the platform's own direct loader/pixel script" — reuses
 * L1.ts's own vetted per-platform detectors (trackingSignals.ts) rather
 * than PLATFORM_MATCHER_HOSTS a second time. The two deliberately differ:
 * PLATFORM_MATCHER_HOSTS matches the *tracking request itself* (narrower —
 * e.g. meta is just 'facebook.com/tr'), while these detectors also cover
 * each platform's separate loader-script host where one exists (Meta's
 * connect.facebook.net, LinkedIn's linkedin.com/px alongside snap.licdn.com)
 * — the exact host a GTM-vs-direct-script distinction needs. Reusing them
 * here means this classifier can never silently drift from what L1's own
 * pixel-presence rules already consider "this platform's script."
 * google_ads has no separate detector (gtag.js is shared with GA4, not
 * platform-specific) — PLATFORM_MATCHER_HOSTS.google_ads already includes
 * the AW-specific gtag loader shape, so it's used directly instead.
 */
const OWN_LOADER_DETECTORS: Partial<Record<DeclaredPlatform, (requests: NetworkRequest[]) => trackingSignals.TagMatch>> = {
  meta: trackingSignals.detectMetaPixel,
  tiktok: trackingSignals.detectTikTokPixel,
  linkedin: trackingSignals.detectLinkedInInsight,
  microsoft: trackingSignals.detectMicrosoftUet,
  openai: trackingSignals.detectOpenAIPixel,
  reddit: trackingSignals.detectReddit,
  pinterest: trackingSignals.detectPinterest,
};

function asFakeRequest(url: string): NetworkRequest {
  return { url, method: 'GET', headers: {}, timestamp: 0, step: '' };
}

/** Whether `url` is a platform's own direct loader/pixel script — see OWN_LOADER_DETECTORS' docstring. */
function isPlatformOwnLoader(url: string, platform: DeclaredPlatform): boolean {
  const detector = OWN_LOADER_DETECTORS[platform];
  if (detector) return detector([asFakeRequest(url)]).hitCount > 0;
  return matchesPlatformHost(url, platform);
}

/** Every URL in an initiator's call chain, outermost first, innermost (closest to the request) last. */
function initiatorChain(initiator: RequestInitiator): string[] {
  const stack = initiator.initiator_stack ?? [];
  const innermost = initiator.initiator_script_url;
  return innermost && !stack.includes(innermost) ? [...stack, innermost] : stack;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** True when frame_url is present and genuinely cross-origin to page_url — a same-origin iframe (e.g. a checkout widget on the same domain) isn't "sandboxed" in the sense this function cares about. */
function firedFromSandboxedFrame(initiator: RequestInitiator): boolean {
  if (!initiator.frame_url) return false;
  const frameOrigin = originOf(initiator.frame_url);
  const pageOrigin = originOf(initiator.page_url);
  return !!frameOrigin && !!pageOrigin && frameOrigin !== pageOrigin;
}

/**
 * Whether P1-03's commerce-platform detection actually supports asserting
 * "this is Shopify's sandbox" for a cross-origin frame finding — the one
 * piece of independent evidence Sprint 10's spike found this classifier was
 * missing. `shopify`/`shopify_plus` cover a classic theme; `detected_backend
 * === 'shopify'` covers a headless/composable storefront proxying a Shopify
 * backend (P1-03's own PureBorn case) — either way, a real signal the page
 * belongs to Shopify, not a guess.
 */
function isShopifyFlavored(commercePlatform: CommercePlatformDetection | undefined): boolean {
  if (!commercePlatform) return false;
  return commercePlatform.platform === 'shopify'
    || commercePlatform.platform === 'shopify_plus'
    || commercePlatform.detected_backend === 'shopify';
}

function classifyOne(initiator: RequestInitiator, platform: DeclaredPlatform, shopifyFlavored: boolean): ImplementationPathClassification {
  const base = { platform, page: initiator.step, request_urls: [initiator.url] };
  const chain = initiatorChain(initiator);

  const gtmLoaderUrl = chain.find((url) => GTM_LOADER_PATTERNS.some((pattern) => url.includes(pattern)));
  if (gtmLoaderUrl) {
    return { ...base, path: 'GTM', evidence: [`Initiator chain includes a GTM loader: ${gtmLoaderUrl}`] };
  }

  const ownLoaderUrl = chain.find((url) => isPlatformOwnLoader(url, platform));
  if (ownLoaderUrl) {
    return { ...base, path: 'DIRECT_SCRIPT', evidence: [`Initiated by ${platform}'s own script, loaded directly (not via GTM): ${ownLoaderUrl}`] };
  }

  if (firedFromSandboxedFrame(initiator)) {
    if (shopifyFlavored) {
      return {
        ...base,
        path: 'SHOPIFY_WEB_PIXEL',
        evidence: [
          `Fired from a frame (${initiator.frame_url}) cross-origin to the page (${initiator.page_url}) — Shopify's Web Pixels Manager sandbox, on a page commerce-platform detection identified as Shopify/Shopify-backed (Signal vs Implementation PRD P1-03). ` +
          'Path-only, per the Sprint 10 spike: which specific pixel (theme/app/custom) is installed cannot be determined from outside Shopify\'s sandbox isolation.',
        ],
      };
    }
    return {
      ...base,
      path: 'UNKNOWN',
      evidence: [
        `Fired from a frame (${initiator.frame_url}) cross-origin to the page (${initiator.page_url}) — a sandboxed execution context of some kind. ` +
        'Attributing it to a specific mechanism (e.g. a Shopify Web Pixel) needs commerce-platform detection confirming the page is Shopify/Shopify-backed (Signal vs Implementation PRD P1-03), which this scan did not establish.',
      ],
    };
  }

  if (initiator.initiator_type === 'UNKNOWN') {
    return {
      ...base,
      path: 'UNKNOWN',
      evidence: ['CDP reported no initiator for this request (a preload, sendBeacon, or worker-originated request) — genuinely unknown, not evidence of absence.'],
    };
  }

  return {
    ...base,
    path: 'UNKNOWN',
    evidence: [`Initiator type "${initiator.initiator_type}" observed, but the call chain doesn't match a known GTM or ${platform} loader pattern.`],
  };
}

/** Merges same-(platform, page, path) rows into one — a platform firing 12 times via the same script shouldn't produce 12 rows. */
function mergeByPlatformPagePath(rows: ImplementationPathClassification[]): ImplementationPathClassification[] {
  const merged = new Map<string, ImplementationPathClassification>();
  for (const row of rows) {
    const key = `${row.platform}|${row.page}|${row.path}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, request_urls: [...row.request_urls], evidence: [...row.evidence] });
      continue;
    }
    for (const url of row.request_urls) if (!existing.request_urls.includes(url)) existing.request_urls.push(url);
    for (const ev of row.evidence) if (!existing.evidence.includes(ev)) existing.evidence.push(ev);
  }
  return [...merged.values()];
}

/**
 * Classifies every tracked-platform request in `initiators` into an
 * implementation path, one row per distinct (platform, page, path) —
 * multiple rows for the same (platform, page) when genuinely more than
 * one path was observed there (P1-06's signal), never collapsed.
 * `initiators` not matching any declared-platform host (e.g. GA4's own
 * collect endpoint — GA4 isn't a DeclaredPlatform) contribute nothing;
 * this classifier is scoped to the platforms the register itself scores.
 *
 * `commercePlatform` is P1-03's output for this same scan (AuditData.
 * commerce_platform) — optional, and when absent every cross-origin
 * sandboxed-frame finding stays `UNKNOWN` rather than a guessed
 * `SHOPIFY_WEB_PIXEL` (Signal vs Implementation PRD P1-04, per the
 * Sprint 10 spike's finding: naming the mechanism needs independent
 * commerce-platform evidence, not just a sandboxed frame's shape alone).
 */
export function classifyImplementationPaths(
  initiators: RequestInitiator[],
  commercePlatform?: CommercePlatformDetection,
): ImplementationPathClassification[] {
  const shopifyFlavored = isShopifyFlavored(commercePlatform);
  const perRequest: ImplementationPathClassification[] = [];
  for (const initiator of initiators) {
    const platform = platformForRequestUrl(initiator.url);
    if (!platform) continue;
    perRequest.push(classifyOne(initiator, platform, shopifyFlavored));
  }
  return mergeByPlatformPagePath(perRequest);
}
