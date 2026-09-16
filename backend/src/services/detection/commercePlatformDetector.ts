/**
 * Commerce platform / rendering-model detection (Signal vs Implementation
 * PRD P1-03). Atlas previously reported no statement of this at all — a
 * real gap, since it changes how every finding about checkout/confirmation
 * should read (the PRD's own PureBorn example: a report calling out an
 * unreachable checkout page reads very differently once a reader knows
 * the site is Shopify).
 *
 * A pure, framework-agnostic function over already-captured DOM signals —
 * same "no Playwright dependency" discipline as trackingSignals.ts, so it
 * can be unit-tested without a browser and reused anywhere those signals
 * are available. Ports (rather than duplicates) the detection heuristics
 * already proven in services/planning/siteDetectionService.ts's
 * detectPlatform() (a server-side HTTP-fetch-only detector for AI Planning
 * Mode, entirely unwired from the audit/register pipeline before this) —
 * same indicator logic, adapted to read from live-crawl-captured signals
 * instead of a standalone fetch.
 *
 * The one genuinely new case beyond what siteDetectionService.ts detects:
 * 'headless'. PureBorn's own trigger audit (Signal vs Implementation PRD)
 * showed a Next.js frontend proxying product imagery from cdn.shopify.com
 * with no Shopify theme JS running at all — a decoupled/composable
 * storefront that siteDetectionService.ts's Shopify check alone would
 * have mis-detected as 'custom' (no `window.Shopify`) or, worse, quietly
 * missed the Shopify backend entirely.
 */
import type { CommercePlatform, CommercePlatformDetection } from '@/types/audit';

export type CommercePlatformSignals = {
  /** Every <script src> observed on the landing page (already captured for GTM detection — reused here, not re-fetched). */
  scriptSrcs: string[];
  /** Every <link href> observed on the landing page. */
  linkHrefs: string[];
  /** window.Shopify defined — only true when the site's own Shopify theme JS is actually running (not just backend evidence via CDN assets). */
  hasShopifyGlobal: boolean;
  /** A `[class*="woocommerce"]` element found on the page. */
  hasWooCommerceMarker: boolean;
  /** A decoupled-frontend-framework marker (Next.js `__NEXT_DATA__`, Nuxt `__NUXT__`, Gatsby `___gatsby`) — evidence the frontend is a headless SPA, independent of any commerce backend. */
  hasHeadlessFrameworkMarker: boolean;
  /** <meta name="generator"> content, when present. */
  generatorMeta: string | null;
};

function includesAny(haystack: string[], needle: string): boolean {
  return haystack.some((s) => s.includes(needle));
}

/** Shopify backend evidence from asset URLs alone — true whether or not the site's own theme JS (window.Shopify) is running. */
function hasShopifyBackendEvidence(signals: CommercePlatformSignals): boolean {
  return includesAny(signals.scriptSrcs, 'cdn.shopify.com') || includesAny(signals.linkHrefs, 'cdn.shopify.com');
}

function hasSalesforceCommerceCloudEvidence(signals: CommercePlatformSignals): { found: boolean; indicator?: string } {
  const dwScript = [...signals.scriptSrcs, ...signals.linkHrefs].find((url) => url.includes('demandware') || url.includes('/on/demandware.store/'));
  return dwScript ? { found: true, indicator: dwScript } : { found: false };
}

function hasWooCommerceEvidence(signals: CommercePlatformSignals): { found: boolean; indicator?: string } {
  if (signals.hasWooCommerceMarker) return { found: true, indicator: 'WooCommerce class marker found on the page' };
  const asset = [...signals.scriptSrcs, ...signals.linkHrefs].find((url) => url.includes('woocommerce'));
  return asset ? { found: true, indicator: `WooCommerce asset detected: ${asset}` } : { found: false };
}

/**
 * Classifies the commerce platform / rendering model from already-captured
 * DOM signals. Ordering matters: headless-plus-backend-evidence is checked
 * before a bare backend-evidence match, so a decoupled Next.js-in-front-of-
 * Shopify storefront resolves to 'headless' (naming the detected backend)
 * rather than falling through to 'shopify' or 'custom'.
 */
export function detectCommercePlatform(signals: CommercePlatformSignals): CommercePlatformDetection {
  const shopifyBackend = hasShopifyBackendEvidence(signals);
  const sfcc = hasSalesforceCommerceCloudEvidence(signals);
  const woo = hasWooCommerceEvidence(signals);

  // A backend was detected, but the frontend is a decoupled SPA framework
  // with no matching platform theme JS running — the storefront is headless.
  if (signals.hasHeadlessFrameworkMarker && !signals.hasShopifyGlobal) {
    if (shopifyBackend) {
      return {
        platform: 'headless',
        confidence: 'medium',
        indicators: ['Decoupled frontend framework detected (no server-rendered theme markup)', 'cdn.shopify.com asset references found with no Shopify theme JS running'],
        detected_backend: 'shopify',
      };
    }
    if (sfcc.found) {
      return {
        platform: 'headless',
        confidence: 'medium',
        indicators: ['Decoupled frontend framework detected (no server-rendered theme markup)', `Salesforce Commerce Cloud asset reference found: ${sfcc.indicator}`],
        detected_backend: 'salesforce_commerce_cloud',
      };
    }
    return {
      platform: 'spa',
      confidence: 'medium',
      indicators: ['Decoupled frontend framework detected (no server-rendered theme markup)', 'No known commerce-backend asset pattern found'],
    };
  }

  // Classic (non-headless) Shopify theme — either the theme JS is running,
  // or backend evidence exists with no competing headless framework marker.
  if (signals.hasShopifyGlobal || shopifyBackend) {
    return {
      platform: 'shopify',
      confidence: signals.hasShopifyGlobal ? 'high' : 'medium',
      indicators: [
        ...(signals.hasShopifyGlobal ? ['window.Shopify global present'] : []),
        ...(shopifyBackend ? ['cdn.shopify.com asset reference found'] : []),
      ],
    };
  }

  if (sfcc.found) {
    return { platform: 'salesforce_commerce_cloud', confidence: 'high', indicators: [`Salesforce Commerce Cloud asset reference found: ${sfcc.indicator}`] };
  }

  if (woo.found) {
    return { platform: 'woocommerce', confidence: 'high', indicators: [woo.indicator as string] };
  }

  if (signals.hasHeadlessFrameworkMarker) {
    return {
      platform: 'spa',
      confidence: 'medium',
      indicators: ['Decoupled frontend framework detected (no server-rendered theme markup)', 'No known commerce-backend asset pattern found'],
    };
  }

  const fallbackIndicators: string[] = [];
  if (signals.generatorMeta) fallbackIndicators.push(`<meta name="generator"> tag: "${signals.generatorMeta}"`);

  return { platform: 'custom', confidence: 'low', indicators: fallbackIndicators };
}

// Re-exported so callers building CommercePlatformSignals don't need a
// separate import just for the type this module already depends on.
export type { CommercePlatform };
