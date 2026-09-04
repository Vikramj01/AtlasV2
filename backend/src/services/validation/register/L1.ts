/**
 * Layer L1 — Foundation & Tags (16 rules).
 *
 * The layer beneath every platform-specific check: is a container/tag
 * manager loaded at all, is the dataLayer actually populated, does each
 * platform's own base tag/pixel resolve, and is delivery free of the
 * structural failure modes (duplicate containers, duplicate base tags,
 * patchy page coverage, silently-failed requests) that make every rule
 * above this layer unreliable.
 *
 * Detection reuses two existing crawl-only sources rather than duplicating
 * detection logic a third time:
 *  - services/detection/trackingSignals.ts — per-platform network-request
 *    matchers with ID extraction (GA4/Meta/Microsoft), already used by
 *    siteSetupDetector.ts's informational Site Setup summary.
 *  - services/audit/siteSetupDetector.ts's detectPossibleServerSideGtm — the
 *    existing best-effort sGTM heuristic, reused as-is for L1.14/L1.15.
 *
 * L1.4's "Platform scope: GA4" (per the Check Register) doesn't map onto
 * PlatformScope's DeclaredPlatform union — GA4 isn't an ad platform a site
 * declares in Scan Inputs, it's the universal analytics baseline every
 * other check leans on (see the register's own "why it matters" text for
 * L1.4). Modeled here as platform_scope: 'any' rather than a scope value
 * that doesn't type-check.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus, NetworkRequest } from '@/types/audit';
import * as trackingSignals from '@/services/detection/trackingSignals';
import { detectPossibleServerSideGtm } from '../../audit/siteSetupDetector';

function gtmScriptSrcs(auditData: AuditData): string[] {
  return (auditData.pageMetadata?.gtm_script_srcs as string[] | undefined) ?? [];
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Naive eTLD+1 comparison — matches siteSetupDetector.ts's own baseDomain heuristic. */
function baseDomain(hostname: string): string {
  return hostname.split('.').filter(Boolean).slice(-2).join('.');
}

// ── L1.1 — GTM container loaded ──────────────────────────────────────────────

export const GTM_CONTAINER_LOADED: ValidationRule = {
  id: 'L1.1',
  rule_id: 'GTM_CONTAINER_LOADED',
  layer: 'foundation_tags',
  check: 'GTM container loaded',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: 'Ensure the GTM snippet (gtm.js) is installed in the <head>, loads before other scripts, and isn\'t blocked by a Content Security Policy, ad blocker, or consent gate. Confirm it connects with GTM Preview mode.',

  test(auditData: AuditData): ValidationResult {
    const ids = trackingSignals.extractGtmContainerIdsFromScriptSrcs(gtmScriptSrcs(auditData));
    const found = ids.length > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: found ? `GTM container${ids.length !== 1 ? 's' : ''} loaded: ${ids.join(', ')}` : 'No GTM container script (gtm.js) detected loading',
        expected: 'gtm.js loads and a container ID (GTM-XXXXXXX) resolves',
        evidence: found ? [`Container IDs observed: ${ids.join(', ')}`] : ['No googletagmanager.com/gtm.js script tag found on any sampled page'],
      },
    };
  },
};

// ── L1.2 — Container ID matches declared account ─────────────────────────────
//
// Reads AuditData.connected_gtm_container_id, resolved by the caller
// (getConnectedGtmContainerId) before rules run — see the field's docstring
// in types/audit.ts. Skipped, not failed, when nothing is connected to
// compare against.

export const CONTAINER_ID_MATCHES_DECLARED: ValidationRule = {
  id: 'L1.2',
  rule_id: 'CONTAINER_ID_MATCHES_DECLARED',
  layer: 'foundation_tags',
  check: 'Container ID matches declared account',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const declaredLine = result.technical_details.evidence.find((e) => e.startsWith('Declared:'));
    const declared = declaredLine ? declaredLine.replace('Declared: ', '') : 'the connected container';
    return `Publish the correct GTM container (${declared}) to this site, or update the connected container in Atlas if the live site is intentionally running a different one.`;
  },

  test(auditData: AuditData): ValidationResult {
    const declared = auditData.connected_gtm_container_id;

    if (!declared) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No connected GTM container on file for this client',
          expected: 'A declared/connected GTM container ID to compare the live site against',
          evidence: ['Rule skipped — nothing declared to compare against'],
        },
      };
    }

    const ids = trackingSignals.extractGtmContainerIdsFromScriptSrcs(gtmScriptSrcs(auditData));
    const matches = ids.includes(declared);
    const status: RuleStatus = ids.length === 0 ? 'fail' : matches ? 'pass' : 'fail';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found: ids.length === 0
          ? `No container loading on the live site (expected ${declared})`
          : matches
            ? `Live container ${declared} matches the declared account`
            : `Live container(s) ${ids.join(', ')} do not match the declared account ${declared}`,
        expected: `The declared container ${declared} is the one actually loading in production`,
        evidence: [`Declared: ${declared}`, `Live: ${ids.length > 0 ? ids.join(', ') : 'none detected'}`],
      },
    };
  },
};

// ── L1.3 — dataLayer initialised ─────────────────────────────────────────────

export const DATALAYER_INITIALISED: ValidationRule = {
  id: 'L1.3',
  rule_id: 'DATALAYER_INITIALISED',
  layer: 'foundation_tags',
  check: 'dataLayer initialised',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: (result) =>
    result.technical_details.found.includes('never received a push')
      ? "Initialize window.dataLayer = window.dataLayer || []; before GTM loads, and push at least a page_view-shaped event on landing — GTM's own tags read from this array, so nothing else can fire correctly without it."
      : 'Move the first dataLayer.push() earlier in the page load — before GTM initializes — so tags evaluating on the landing page see real data instead of falling back to defaults.',

  test(auditData: AuditData): ValidationResult {
    const early = auditData.dataLayer.filter((e) => e.step === 'landing' || e.step === 'init');
    const status: RuleStatus = auditData.dataLayer.length === 0 ? 'fail' : early.length > 0 ? 'pass' : 'warning';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found: auditData.dataLayer.length === 0
          ? 'dataLayer never received a push during the crawl'
          : early.length > 0
            ? `dataLayer populated with ${early.length} event(s) by the landing page`
            : `dataLayer only populated later in the journey (first push at step "${auditData.dataLayer[0]?.step}") — every tag on the landing page fired on defaults`,
        expected: 'dataLayer exists and receives at least one push before the landing page finishes loading',
        evidence: [`Total dataLayer events: ${auditData.dataLayer.length}`, `Events at landing/init: ${early.length}`],
      },
    };
  },
};

// ── L1.4 — GA4 configuration tag present ─────────────────────────────────────

export const GA4_CONFIG_TAG_PRESENT: ValidationRule = {
  id: 'L1.4',
  rule_id: 'GA4_CONFIG_TAG_PRESENT',
  layer: 'foundation_tags',
  check: 'GA4 configuration tag present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: 'Add a GA4 Configuration tag in GTM (or the gtag(\'config\', \'G-XXXXXXX\') snippet directly) firing on All Pages, and confirm in the Network tab that requests reach google-analytics.com/g/collect with a resolved measurement ID.',

  test(auditData: AuditData): ValidationResult {
    const match = trackingSignals.detectGa4(auditData.networkRequests);
    const found = match.hitCount > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: found
          ? `GA4 fired ${match.hitCount} time(s), measurement ID${match.ids.length !== 1 ? 's' : ''}: ${match.ids.join(', ') || 'unresolved'}`
          : 'No GA4 collect request detected',
        expected: 'GA4 config fires and a measurement ID (G-XXXXXXXXXX) resolves',
        evidence: found ? match.urls : ['No requests to google-analytics.com/g/collect or analytics.google.com/g/collect'],
      },
    };
  },
};

// ── L1.5 — Google global site tag present ────────────────────────────────────

export const GOOGLE_GLOBAL_SITE_TAG_PRESENT: ValidationRule = {
  id: 'L1.5',
  rule_id: 'GOOGLE_GLOBAL_SITE_TAG_PRESENT',
  layer: 'foundation_tags',
  check: 'Google global site tag present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: ['google_ads'],
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: 'Add the Google Ads gtag.js loader (googletagmanager.com/gtag/js?id=AW-XXXXXXXXX) via GTM\'s Google Tag or a direct gtag.js snippet, firing on every page — without it, no Google Ads conversion or remarketing tag downstream of this one can work.',

  test(auditData: AuditData): ValidationResult {
    const hits = auditData.networkRequests.filter(
      (r) => r.url.includes('googletagmanager.com/gtag/js') && r.url.includes('AW-'),
    );
    const found = hits.length > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: found ? `gtag.js loaded with an Ads conversion ID (${hits.length} request(s))` : 'No gtag.js loader with an AW- conversion ID detected',
        expected: 'gtag.js loads with an Ads conversion ID (id=AW-XXXXXXXXX)',
        evidence: found ? hits.map((r) => r.url) : ['No googletagmanager.com/gtag/js?id=AW-... request found'],
      },
    };
  },
};

// ── L1.6 — Conversion linker enabled ─────────────────────────────────────────
//
// Google's Conversion Linker tag sets the _gcl_au first-party cookie on
// every page load, independent of whether a click ID was present — its
// presence is the crawl-detectable proxy for "Conversion Linker is
// configured" without needing a GTM container connection.

export const CONVERSION_LINKER_ENABLED: ValidationRule = {
  id: 'L1.6',
  rule_id: 'CONVERSION_LINKER_ENABLED',
  layer: 'foundation_tags',
  check: 'Conversion linker enabled',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: ['google_ads'],
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: 'Enable Auto-tagging and Conversion Linker in the Google Tag (or add the standalone Conversion Linker GTM tag) firing on All Pages — this writes the _gcl_au cookie that later steps rely on to bridge a click ID across pages, even ones that never see a gclid directly.',

  test(auditData: AuditData): ValidationResult {
    const hasLinkerCookie = !!auditData.cookies?.['_gcl_au'];

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: hasLinkerCookie ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasLinkerCookie ? '_gcl_au cookie present — Conversion Linker is writing click data to first-party storage' : 'No _gcl_au cookie found',
        expected: 'Conversion Linker tag (or gtag.js equivalent) sets the _gcl_au first-party cookie',
        evidence: [`_gcl_au present: ${hasLinkerCookie}`],
      },
    };
  },
};

// ── L1.7-10 — Per-platform base pixel present ────────────────────────────────

function makePixelPresenceRule(opts: {
  id: string;
  rule_id: string;
  check: string;
  platform: 'meta' | 'tiktok' | 'linkedin' | 'microsoft';
  detect: (requests: NetworkRequest[]) => trackingSignals.TagMatch;
  expected: string;
  noneFoundMessage: string;
  remediation: string;
}): ValidationRule {
  return {
    id: opts.id,
    rule_id: opts.rule_id,
    layer: 'foundation_tags',
    check: opts.check,
    severity: 'critical',
    applies_to: 'all',
    platform_scope: [opts.platform],
    detectable_by: 'crawl',
    owner: 'Marketing Ops',
    remediation: opts.remediation,

    test(auditData: AuditData): ValidationResult {
      const match = opts.detect(auditData.networkRequests);
      const found = match.hitCount > 0;

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: found ? 'pass' : 'fail',
        severity: this.severity,
        technical_details: {
          found: found
            ? `Fired ${match.hitCount} time(s)${match.ids.length > 0 ? `, ID${match.ids.length !== 1 ? 's' : ''}: ${match.ids.join(', ')}` : ''}`
            : opts.noneFoundMessage,
          expected: opts.expected,
          evidence: found ? match.urls : [opts.noneFoundMessage],
        },
      };
    },
  };
}

export const META_PIXEL_PRESENT = makePixelPresenceRule({
  id: 'L1.7',
  rule_id: 'META_PIXEL_PRESENT',
  check: 'Meta Pixel present',
  platform: 'meta',
  detect: trackingSignals.detectMetaPixel,
  expected: 'fbevents.js loads and a pixel ID resolves',
  noneFoundMessage: 'No requests to facebook.com/tr or connect.facebook.net detected',
  remediation: 'Install the Meta Pixel (via GTM\'s Meta Pixel tag or the fbevents.js base snippet) firing on every page, with the correct Pixel ID from Events Manager. Verify with the Meta Pixel Helper browser extension.',
});

export const TIKTOK_PIXEL_PRESENT = makePixelPresenceRule({
  id: 'L1.8',
  rule_id: 'TIKTOK_PIXEL_PRESENT',
  check: 'TikTok Pixel present',
  platform: 'tiktok',
  detect: trackingSignals.detectTikTokPixel,
  expected: 'TikTok pixel script loads and a pixel ID resolves',
  noneFoundMessage: 'No requests to analytics.tiktok.com detected',
  remediation: 'Install the TikTok Pixel base code (via GTM\'s TikTok Pixel tag or the ttq snippet) firing on every page, with the correct Pixel ID from TikTok Events Manager.',
});

export const LINKEDIN_INSIGHT_TAG_PRESENT = makePixelPresenceRule({
  id: 'L1.9',
  rule_id: 'LINKEDIN_INSIGHT_TAG_PRESENT',
  check: 'LinkedIn Insight Tag present',
  platform: 'linkedin',
  detect: trackingSignals.detectLinkedInInsight,
  expected: 'Insight tag loads with a partner ID',
  noneFoundMessage: 'No requests to snap.licdn.com or linkedin.com/px detected',
  remediation: 'Install the LinkedIn Insight Tag (via GTM\'s LinkedIn tag or the base snippet from Campaign Manager) firing on every page, with the correct Partner ID.',
});

export const MICROSOFT_UET_TAG_PRESENT = makePixelPresenceRule({
  id: 'L1.10',
  rule_id: 'MICROSOFT_UET_TAG_PRESENT',
  check: 'Microsoft UET tag present',
  platform: 'microsoft',
  detect: trackingSignals.detectMicrosoftUet,
  expected: 'UET tag loads with a tag ID',
  noneFoundMessage: 'No requests to bat.bing.com detected',
  remediation: 'Install the Microsoft UET tag (via GTM\'s Microsoft Advertising UET tag or the base snippet from Microsoft Ads) firing on every page, with the correct UET Tag ID.',
});

// ── L1.11 — No duplicate container ───────────────────────────────────────────
//
// Skipped (not failed) when no container loads at all — that gap is
// GTM_CONTAINER_LOADED's (L1.1) to report, not this rule's to double-count.

export const NO_DUPLICATE_CONTAINER: ValidationRule = {
  id: 'L1.11',
  rule_id: 'NO_DUPLICATE_CONTAINER',
  layer: 'foundation_tags',
  check: 'No duplicate container',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const idsLine = result.technical_details.evidence.find((e) => e.startsWith('Container IDs observed:'));
    const ids = idsLine ? idsLine.replace('Container IDs observed: ', '') : 'the extra container';
    return `Remove the extra GTM container(s) (${ids}) — likely a leftover from a migration, a duplicate install by two teams, or a CMS/theme default. Keep only the one intended for production; a second container doubles every tag that fires from it.`;
  },

  test(auditData: AuditData): ValidationResult {
    const ids = trackingSignals.extractGtmContainerIdsFromScriptSrcs(gtmScriptSrcs(auditData));

    if (ids.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No GTM container detected — nothing to check for duplication',
          expected: 'Only one GTM container loads',
          evidence: ['Rule skipped — see GTM_CONTAINER_LOADED (L1.1)'],
        },
      };
    }

    const duplicate = ids.length > 1;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: duplicate ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: duplicate ? `${ids.length} distinct GTM containers loading: ${ids.join(', ')}` : `1 GTM container loading: ${ids[0]}`,
        expected: 'Exactly one GTM container loads across the sampled pages',
        evidence: [`Container IDs observed: ${ids.join(', ')}`],
      },
    };
  },
};

// ── L1.12 — No duplicate base tag ────────────────────────────────────────────
//
// GA4/Meta/Microsoft expose a stable ID in their network calls (measurement
// ID, pixel ID, tag ID), so a duplicate installation shows up as >1 distinct
// ID for the same platform. Google Ads/TikTok/LinkedIn have no such ID in
// their request shape (see trackingSignals.ts's own docs on this) — flagged
// as not evaluable at the ID level from crawl data alone, rather than
// silently assumed clean.

const ID_BEARING_PLATFORMS: Array<{ label: string; detect: (r: NetworkRequest[]) => trackingSignals.TagMatch }> = [
  { label: 'GA4', detect: trackingSignals.detectGa4 },
  { label: 'Meta', detect: trackingSignals.detectMetaPixel },
  { label: 'Microsoft', detect: trackingSignals.detectMicrosoftUet },
];

export const NO_DUPLICATE_BASE_TAG: ValidationRule = {
  id: 'L1.12',
  rule_id: 'NO_DUPLICATE_BASE_TAG',
  layer: 'foundation_tags',
  check: 'No duplicate base tag',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const dupes = result.technical_details.evidence.filter((e) => e.includes('distinct IDs firing'));
    if (dupes.length === 0) return 'Remove the duplicate base tag installation for the affected platform(s) — check for both a GTM-managed tag and a hardcoded script tag on the page, which is the most common cause.';
    return `Remove the duplicate base tag installation: ${dupes.join('; ')}. Check for both a GTM-managed tag and a hardcoded script tag on the page — that combination is the most common cause of two IDs firing for the same platform.`;
  },

  test(auditData: AuditData): ValidationResult {
    const violations: string[] = [];
    const clean: string[] = [];

    for (const { label, detect } of ID_BEARING_PLATFORMS) {
      const match = detect(auditData.networkRequests);
      if (match.ids.length > 1) {
        violations.push(`${label}: ${match.ids.length} distinct IDs firing (${match.ids.join(', ')})`);
      } else if (match.ids.length === 1) {
        clean.push(`${label}: 1 ID (${match.ids[0]})`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} platform(s) with duplicate base tags: ${violations.join('; ')}`
          : 'No duplicate base tags detected among platforms with an extractable ID',
        expected: 'Each platform base tag loads under exactly one account/pixel ID',
        evidence: [
          ...violations,
          ...clean,
          'Google Ads, TikTok, and LinkedIn base tags carry no stable per-installation ID in their network requests — not evaluable at the ID level from crawl data alone',
        ],
      },
    };
  },
};

// ── L1.13 — Tags present across all sampled pages ────────────────────────────
//
// Compares the canonical list of pages the crawl actually visited
// (steps_visited — set regardless of tracking outcome, see its docstring in
// types/audit.ts) against which of those steps produced at least one
// tracked network request. networkRequests alone can't answer this: it only
// contains requests matching a tracked platform URL pattern, so a page with
// a broken tag looks identical to a page the crawl never reached.
//
// A journey with only one page reached (landing) has nothing to compare
// coverage across, so this is 'skipped' rather than trivially 'pass'.

export const TAGS_PRESENT_ACROSS_SAMPLED_PAGES: ValidationRule = {
  id: 'L1.13',
  rule_id: 'TAGS_PRESENT_ACROSS_SAMPLED_PAGES',
  layer: 'foundation_tags',
  check: 'Tags present across all sampled pages',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const gapsLine = result.technical_details.evidence.find((e) => e.startsWith('Steps with no tracking:'));
    const gaps = gapsLine ? gapsLine.replace('Steps with no tracking: ', '') : 'the affected page(s)';
    return `Check tag triggers for the page(s) with zero tracking (${gaps}) — a trigger scoped too narrowly (a specific URL path, a CSS selector that changed) is the most common cause of a tag working on some pages but not others.`;
  },

  test(auditData: AuditData): ValidationResult {
    const steps = [...new Set(auditData.steps_visited ?? [])].filter((s) => s !== 'init');

    if (steps.length < 2) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: `Only ${steps.length} page step${steps.length === 1 ? '' : 's'} sampled — nothing to compare coverage across`,
          expected: 'Tag coverage compared across 2+ sampled pages',
          evidence: ['Rule skipped — journey reached fewer than 2 distinct steps'],
        },
      };
    }

    const gaps = steps.filter((step) => !auditData.networkRequests.some((r) => r.step === step));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: gaps.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: gaps.length > 0
          ? `${gaps.length} of ${steps.length} sampled page(s) had zero tracking requests: ${gaps.join(', ')}`
          : `Tracking requests present on all ${steps.length} sampled pages`,
        expected: 'At least one tracking request fires on every sampled page, not just the homepage',
        evidence: [`Sampled steps: ${steps.join(', ')}`, `Steps with no tracking: ${gaps.length > 0 ? gaps.join(', ') : 'none'}`],
      },
    };
  },
};

// ── L1.14 — Server container endpoint configured ─────────────────────────────

export const SERVER_CONTAINER_ENDPOINT_CONFIGURED: ValidationRule = {
  id: 'L1.14',
  rule_id: 'SERVER_CONTAINER_ENDPOINT_CONFIGURED',
  layer: 'foundation_tags',
  check: 'Server container endpoint configured',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  remediation: 'Stand up a server-side GTM (sGTM) container and route client-side events to it via a first-party endpoint — this enables server-side deduplication and gives Meta/TikTok CAPI and Google Ads Enhanced Conversions a durable, cookie-independent delivery path. If sGTM is deliberately out of scope for this site, this can be deprioritized relative to the client-side rules above it.',

  test(auditData: AuditData): ValidationResult {
    const hostname = safeHostname(auditData.website_url);
    const result = detectPossibleServerSideGtm(auditData.networkRequests, hostname);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: result.detected ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: result.detected
          ? `Possible server-side GTM endpoint detected (${result.confidence} confidence): ${result.candidate_hosts.join(', ')}`
          : 'No first-party server container endpoint referenced',
        expected: 'A first-party sGTM endpoint is referenced and resolves',
        evidence: result.detected ? [result.caveat, ...result.evidence_urls] : ['No sGTM-shaped request detected — see detectPossibleServerSideGtm heuristics'],
      },
    };
  },
};

// ── L1.15 — Server container on a first-party domain ─────────────────────────
//
// Skipped when L1.14 found nothing — there's no endpoint to evaluate the
// domain of.

export const SERVER_CONTAINER_FIRST_PARTY_DOMAIN: ValidationRule = {
  id: 'L1.15',
  rule_id: 'SERVER_CONTAINER_FIRST_PARTY_DOMAIN',
  layer: 'foundation_tags',
  check: 'Server container on a first-party domain',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  remediation: (result) => {
    const hostsLine = result.technical_details.evidence.find((e) => e.startsWith('All candidate hosts:'));
    const hosts = hostsLine ? hostsLine.replace('All candidate hosts: ', '') : 'the third-party sGTM endpoint';
    return `Repoint the server container's subdomain (${hosts}) at the advertiser's own domain via a CNAME, rather than the vendor's shared hosting — a third-party sGTM host doesn't get first-party cookie durability, defeating much of the point of running server-side.`;
  },

  test(auditData: AuditData): ValidationResult {
    const hostname = safeHostname(auditData.website_url);
    const result = detectPossibleServerSideGtm(auditData.networkRequests, hostname);

    if (!result.detected) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No server container endpoint detected — see SERVER_CONTAINER_ENDPOINT_CONFIGURED (L1.14)',
          expected: 'sGTM endpoint is on the advertiser\'s own domain',
          evidence: ['Rule skipped — nothing to evaluate'],
        },
      };
    }

    const siteBase = baseDomain(hostname);
    const firstPartyHosts = result.candidate_hosts.filter((h) => baseDomain(h) === siteBase);
    const status: RuleStatus =
      firstPartyHosts.length === result.candidate_hosts.length ? 'pass' :
      firstPartyHosts.length === 0 ? 'fail' : 'warning';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found: `Candidate endpoint host(s): ${result.candidate_hosts.join(', ')} (site domain: ${siteBase})`,
        expected: 'The sGTM endpoint resolves on the advertiser\'s own domain, not a third-party host',
        evidence: [`First-party hosts: ${firstPartyHosts.length > 0 ? firstPartyHosts.join(', ') : 'none'}`, `All candidate hosts: ${result.candidate_hosts.join(', ')}`],
      },
    };
  },
};

// ── L1.16 — No tag load errors ────────────────────────────────────────────────
//
// Reads NetworkRequest.failed/.statusCode, set by dataCapture.ts's
// requestfailed/response listeners — a tag that fails to load reports as
// absent everywhere else in this layer, not as broken, so this is the only
// rule that distinguishes the two.

export const NO_TAG_LOAD_ERRORS: ValidationRule = {
  id: 'L1.16',
  rule_id: 'NO_TAG_LOAD_ERRORS',
  layer: 'foundation_tags',
  check: 'No tag load errors',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: (result) => {
    const failed = result.technical_details.evidence.slice(0, 3);
    if (failed.length === 0) return 'Investigate the failed tag request(s) reported above — check for CSP blocks, ad-blocker interference, or a stale/incorrect endpoint URL.';
    return `Fix the failing request(s): ${failed.join('; ')}${result.technical_details.evidence.length > 3 ? ', and others' : ''}. A 4xx/5xx status usually means a stale or incorrect endpoint URL; a network failure usually means CSP or an ad blocker is intercepting the request.`;
  },

  test(auditData: AuditData): ValidationResult {
    const violations = auditData.networkRequests.filter(
      (r) => r.failed || (r.statusCode !== undefined && r.statusCode >= 400),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} tag request(s) failed or errored`
          : 'No blocked or failed tag requests observed',
        expected: 'Every tracking request completes without a network failure or 4xx/5xx response',
        evidence: violations.length > 0
          ? violations.map((r) => `${r.url} (step: ${r.step}${r.failed ? ', network failure' : ''}${r.statusCode ? `, status ${r.statusCode}` : ''})`)
          : ['No tag load errors detected'],
      },
    };
  },
};

export const L1_RULES: ValidationRule[] = [
  GTM_CONTAINER_LOADED,
  CONTAINER_ID_MATCHES_DECLARED,
  DATALAYER_INITIALISED,
  GA4_CONFIG_TAG_PRESENT,
  GOOGLE_GLOBAL_SITE_TAG_PRESENT,
  CONVERSION_LINKER_ENABLED,
  META_PIXEL_PRESENT,
  TIKTOK_PIXEL_PRESENT,
  LINKEDIN_INSIGHT_TAG_PRESENT,
  MICROSOFT_UET_TAG_PRESENT,
  NO_DUPLICATE_CONTAINER,
  NO_DUPLICATE_BASE_TAG,
  TAGS_PRESENT_ACROSS_SAMPLED_PAGES,
  SERVER_CONTAINER_ENDPOINT_CONFIGURED,
  SERVER_CONTAINER_FIRST_PARTY_DOMAIN,
  NO_TAG_LOAD_ERRORS,
];
