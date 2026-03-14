/**
 * Site Detection Service
 *
 * Performs a lightweight server-side HTTP fetch + HTML parse to detect:
 * - Platform (Shopify, WooCommerce, WordPress, Webflow, Squarespace)
 * - Existing tracking tags (GTM, GA4, Meta Pixel, Google Ads, TikTok, LinkedIn)
 * - Inferred business type (ecommerce, saas, lead_gen, content, custom)
 * - Currency and language from meta tags
 *
 * No Browserbase, no AI, no external APIs. Costs zero.
 * Typical response time: 1–3 seconds.
 */

import * as cheerio from 'cheerio';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SiteDetection {
  url: string;
  resolved_url: string;
  site_title: string;
  detected_platform: DetectedPlatform | null;
  inferred_business_type: string;
  business_type_confidence: number;
  existing_tracking: ExistingTrackingQuick;
  detected_currency: string | null;
  detected_language: string | null;
}

export interface DetectedPlatform {
  name: string;
  version?: string;
  indicators: string[];
}

export interface ExistingTrackingQuick {
  gtm_detected: boolean;
  gtm_container_id: string | null;
  ga4_detected: boolean;
  ga4_measurement_id: string | null;
  meta_pixel_detected: boolean;
  meta_pixel_id: string | null;
  google_ads_detected: boolean;
  tiktok_detected: boolean;
  linkedin_detected: boolean;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function detectSite(rawUrl: string): Promise<SiteDetection> {
  const url = normalizeUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let html: string;
  let resolvedUrl: string;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AtlasBot/1.0; +https://getatlas.io/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    resolvedUrl = res.url || url;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const $ = cheerio.load(html);

  const siteTitle = $('title').first().text().trim() || resolvedUrl;
  const detectedPlatform = detectPlatform($, html);
  const existingTracking = detectTracking($, html);
  const { businessType, confidence } = inferBusinessType($, html, detectedPlatform);
  const detectedCurrency = detectCurrency($, html);
  const detectedLanguage = detectLanguage($);

  return {
    url,
    resolved_url: resolvedUrl,
    site_title: siteTitle,
    detected_platform: detectedPlatform,
    inferred_business_type: businessType,
    business_type_confidence: confidence,
    existing_tracking: existingTracking,
    detected_currency: detectedCurrency,
    detected_language: detectedLanguage,
  };
}

// ── Platform detection ────────────────────────────────────────────────────────

function detectPlatform(
  $: cheerio.CheerioAPI,
  html: string,
): DetectedPlatform | null {
  const indicators: string[] = [];

  // Shopify
  const hasShopifyCdn = $('script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"]').length > 0;
  const hasShopifyVar = html.includes('Shopify.') || html.includes('"Shopify"');
  if (hasShopifyCdn) indicators.push('Shopify CDN detected in script/link tags');
  if (hasShopifyVar) indicators.push('Shopify global variable found');
  if (hasShopifyCdn || hasShopifyVar) {
    return { name: 'shopify', indicators };
  }

  // WooCommerce
  const hasWoo =
    $('[class*="woocommerce"]').length > 0 ||
    $('script[src*="woocommerce"], link[href*="woocommerce"]').length > 0;
  if (hasWoo) {
    return { name: 'woocommerce', indicators: ['WooCommerce class or asset detected'] };
  }

  // WordPress (without WooCommerce)
  const hasWp =
    $('script[src*="wp-content"], script[src*="wp-includes"], link[href*="wp-content"]').length > 0 ||
    html.includes('wp-content/');
  if (hasWp) {
    return { name: 'wordpress', indicators: ['WordPress wp-content/wp-includes assets detected'] };
  }

  // Squarespace
  const hasSqs =
    $('script[src*="static.squarespace.com"], link[href*="static.squarespace.com"]').length > 0 ||
    html.includes('squarespace.com');
  if (hasSqs) {
    return { name: 'squarespace', indicators: ['Squarespace static assets detected'] };
  }

  // Webflow
  const hasWebflow =
    $('script[src*="webflow.com"]').length > 0 ||
    html.includes('Webflow.require') ||
    $('[data-wf-page]').length > 0;
  if (hasWebflow) {
    return { name: 'webflow', indicators: ['Webflow script or data attribute detected'] };
  }

  return null;
}

// ── Tracking detection ────────────────────────────────────────────────────────

function detectTracking(
  $: cheerio.CheerioAPI,
  html: string,
): ExistingTrackingQuick {
  // GTM
  const gtmMatch = html.match(/googletagmanager\.com\/gtm\.js[^'"]*[?&]id=(GTM-[A-Z0-9]+)/);
  const gtmDetected = gtmMatch !== null || html.includes('googletagmanager.com/gtm.js');
  const gtmContainerId = gtmMatch ? gtmMatch[1] : null;

  // GA4 (gtag.js)
  const ga4Match = html.match(/gtag\('config',\s*'(G-[A-Z0-9]+)'\)/);
  const ga4Detected = html.includes('googletagmanager.com/gtag/js') || ga4Match !== null;
  const ga4MeasurementId = ga4Match ? ga4Match[1] : null;

  // Meta Pixel
  const metaMatch = html.match(/fbq\('init',\s*'(\d{10,20})'\)/);
  const metaDetected = html.includes('connect.facebook.net') && html.includes('fbevents.js');
  const metaPixelId = metaMatch ? metaMatch[1] : null;

  // Google Ads
  const googleAdsDetected =
    html.includes('googleadservices.com') ||
    /gtag\('config',\s*'AW-/.test(html);

  // TikTok
  const tiktokDetected = html.includes('analytics.tiktok.com');

  // LinkedIn
  const linkedinDetected = html.includes('snap.licdn.com');

  return {
    gtm_detected: gtmDetected,
    gtm_container_id: gtmContainerId,
    ga4_detected: ga4Detected,
    ga4_measurement_id: ga4MeasurementId,
    meta_pixel_detected: metaDetected,
    meta_pixel_id: metaPixelId,
    google_ads_detected: googleAdsDetected,
    tiktok_detected: tiktokDetected,
    linkedin_detected: linkedinDetected,
  };
}

// ── Business type inference ───────────────────────────────────────────────────

function inferBusinessType(
  $: cheerio.CheerioAPI,
  html: string,
  platform: DetectedPlatform | null,
): { businessType: string; confidence: number } {
  // Platform-based inference (high confidence)
  if (platform?.name === 'shopify' || platform?.name === 'woocommerce') {
    return { businessType: 'ecommerce', confidence: 0.95 };
  }

  // Cart/checkout keywords
  const hasCart =
    html.includes('add-to-cart') ||
    html.includes('add_to_cart') ||
    html.includes('shopping-cart') ||
    $('[class*="cart"], [id*="cart"]').length > 0;
  if (hasCart) {
    return { businessType: 'ecommerce', confidence: 0.85 };
  }

  // Pricing page link
  const hasPricingLink =
    $('a[href*="pricing"], a[href*="/plans"]').length > 0 ||
    html.toLowerCase().includes('/pricing') ||
    html.toLowerCase().includes('/plans');
  if (hasPricingLink) {
    return { businessType: 'saas', confidence: 0.75 };
  }

  // Lead gen signals
  const hasFormAndNoCart =
    $('form').length > 0 &&
    !hasCart &&
    ($('input[type="email"]').length > 0 || $('input[name*="email"]').length > 0);
  if (hasFormAndNoCart) {
    return { businessType: 'lead_gen', confidence: 0.65 };
  }

  // Content / blog
  const hasContentSignals =
    $('article').length > 3 ||
    $('[class*="blog"], [class*="post"]').length > 2;
  if (hasContentSignals) {
    return { businessType: 'content', confidence: 0.6 };
  }

  return { businessType: 'custom', confidence: 0.3 };
}

// ── Currency detection ────────────────────────────────────────────────────────

function detectCurrency(
  $: cheerio.CheerioAPI,
  html: string,
): string | null {
  // OpenGraph product price currency
  const ogCurrency = $('meta[property="product:price:currency"]').attr('content');
  if (ogCurrency) return ogCurrency.toUpperCase();

  // Shopify currency variable
  const shopifyMatch = html.match(/Shopify\.currency\s*=\s*['"]([A-Z]{3})['"]/);
  if (shopifyMatch) return shopifyMatch[1];

  // hreflang currency hint (e.g. en-US → USD fallback)
  const hreflang = $('link[hreflang]').first().attr('hreflang') ?? '';
  const regionCurrencyMap: Record<string, string> = {
    'en-US': 'USD',
    'en-GB': 'GBP',
    'en-AU': 'AUD',
    'de': 'EUR',
    'fr': 'EUR',
    'ja': 'JPY',
    'en-SG': 'SGD',
  };
  if (regionCurrencyMap[hreflang]) return regionCurrencyMap[hreflang];

  return null;
}

// ── Language detection ────────────────────────────────────────────────────────

function detectLanguage($: cheerio.CheerioAPI): string | null {
  return $('html').attr('lang') ?? null;
}

// ── URL normalisation ─────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}
