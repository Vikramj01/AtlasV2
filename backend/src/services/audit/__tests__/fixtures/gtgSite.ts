/**
 * Synthetic Google tag gateway (GTG) site — www.example.com serving its GTM
 * container, Google tag and measurement hits through the reserved path /metrics.
 *
 * SYNTHETIC: built from the shapes in docs/prd/google-tag-gateway.md §1.1 and §4,
 * not captured from a live gateway. PRD §13 lists what is unverified (whether
 * `/g/collect` keeps its suffix under the path, which `pagead` requests move,
 * whether bare `/path/` gtag loads carry a tag ID). Replace with a real capture
 * when one exists; the matcher is shape-based so the tests should still hold
 * for whichever hits really do move.
 */
import type { NetworkRequest } from '@/types/audit';

export const GTG_SITE_URL = 'https://www.example.com/';
export const GTG_CONTAINER_ID = 'GTM-ABC1234';
export const GTG_GA4_ID = 'G-ABCDEF1234';
export const GTG_ADS_ID = 'AW-123456789';

export const GTG_GTM_SNIPPET = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='/metrics/?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTG_CONTAINER_ID}');</script>`;

export const STANDARD_GTM_SNIPPET = GTG_GTM_SNIPPET.replace('/metrics/?id=', 'https://www.googletagmanager.com/gtm.js?id=');

export const GTG_HTML = `<html><head><title>Example</title>${GTG_GTM_SNIPPET}</head><body><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTG_CONTAINER_ID}"></iframe></noscript></body></html>`;

export const GTG_URLS = {
  container: `https://www.example.com/metrics/?id=${GTG_CONTAINER_ID}&l=dataLayer`,
  ga4Hit: `https://www.example.com/metrics/g/collect?v=2&tid=${GTG_GA4_ID}&en=page_view`,
  adsHit: 'https://www.example.com/metrics/pagead/conversion/123456789/?label=abc',
};

export function req(url: string, step = 'landing'): NetworkRequest {
  return { url, method: 'GET', headers: {}, timestamp: Date.now(), step };
}

/** A complete GTG capture: container + GA4 hit + Ads hit, all first-party. */
export const GTG_REQUESTS: NetworkRequest[] = [
  req(GTG_URLS.container),
  req(GTG_URLS.ga4Hit),
  req(GTG_URLS.adsHit),
];

/** The same site before the gateway: everything straight from Google. */
export const DIRECT_REQUESTS: NetworkRequest[] = [
  req(`https://www.googletagmanager.com/gtm.js?id=${GTG_CONTAINER_ID}`),
  req(`https://www.google-analytics.com/g/collect?v=2&tid=${GTG_GA4_ID}&en=page_view`),
  req('https://www.googleadservices.com/pagead/conversion/123456789/?label=abc'),
];
