/**
 * Layer L2 — Click ID Capture (11 of 12 rules — see note on L2.12 below).
 *
 * Every rule here answers a variant of "did we plant a synthetic
 * identifier in the landing URL, and does the site actually read/store it
 * — not just leave it sitting in the address bar." journeySimulator.ts
 * injects a synthetic value for every click ID and UTM param this layer
 * checks (makeSyntheticIds()) into the landing URL, then captures:
 *  - urlParams: what Atlas sent (always present for an injected param)
 *  - storage / cookies / dataLayer: what the site actually captured
 *  - landing_final_url: where navigation actually settled (redirect-safe)
 *  - landing_referrer_captured: document.referrer as the landing page saw it
 *
 * L2.12 ("Consent gating does not block capture") is Detectable by: Second
 * pass in the Check Register — it requires re-crawling with consent
 * withheld and comparing capture behavior, which is out of scope for this
 * phase (crawl-only rules; second-pass detection deferred, same as every
 * other non-crawl detection method). Not included in L2_RULES.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus, DataLayerEvent } from '@/types/audit';

const SYNTHETIC_PARAMS = [
  'gclid', 'fbclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'msclkid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
] as const;

/**
 * 'exact'       — found under the expected key name, exact value match.
 * 'value_match' — found under a *different* key name (or one level inside
 *                 a JSON-encoded string value), but the value itself
 *                 matches exactly. Still counts as captured (§8.4) — a
 *                 site storing gclid as `_atlas_gclid`, or bundling several
 *                 IDs into one JSON blob, has still captured it.
 * 'not_found'   — the synthetic value never showed up anywhere.
 */
export type CaptureTier = 'exact' | 'value_match' | 'not_found';

interface CaptureCheck {
  inUrl: boolean;
  captured: boolean;
  tier: CaptureTier;
  storageHit: boolean;
  cookieHit: boolean;
  dataLayerHit: boolean;
  /** The actual key name the value was found under — only set for tier 'value_match', where it differs from paramName. */
  matchedKey?: string;
}

/**
 * Scans a flat key→value record for a key (other than the expected one)
 * whose value equals target, including one level of JSON-parsing a string
 * value (e.g. a site storing `{"gclid":"...","fbclid":"..."}` as a single
 * localStorage entry). Matching on the *value* — unique per run
 * (test_gclid_${ts}, never shared across different synthetic params even
 * within the same run) — is what keeps this safe from a false positive:
 * two different params can never coincidentally share a value to cross-match.
 */
function findValueUnderDifferentKey(record: Record<string, string> | undefined, expectedKey: string, target: string): string | undefined {
  if (!record) return undefined;
  for (const [key, value] of Object.entries(record)) {
    if (key === expectedKey) continue; // that's tier 1's job, not this
    if (value === target) return key;
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        for (const [nestedKey, nestedValue] of Object.entries(parsed as Record<string, unknown>)) {
          if (String(nestedValue) === target) return `${key}.${nestedKey}`;
        }
      }
    } catch {
      // Not JSON — nothing more to check for this key
    }
  }
  return undefined;
}

/** Same idea as findValueUnderDifferentKey, but over dataLayer's array-of-event shape rather than a flat record. */
function findValueInDataLayerUnderDifferentKey(events: DataLayerEvent[], expectedKey: string, target: string): string | undefined {
  for (const event of events) {
    for (const [key, value] of Object.entries(event)) {
      if (key === expectedKey) continue;
      if (String(value) === target) return key;
    }
  }
  return undefined;
}

/**
 * Whether a synthetic param Atlas injected at landing was actually read and
 * stored somewhere by the site — localStorage/cookies/dataLayer, under the
 * expected key (tier 'exact') or a differently-named one (tier
 * 'value_match') — rather than just sitting unread in the URL. Shared by
 * every per-identifier rule in this layer (L2.1-2.8) and by the
 * redirect-timing check (L2.10).
 */
function checkParamCapture(auditData: AuditData, paramName: string): CaptureCheck {
  const sentValue = auditData.urlParams?.[paramName];
  if (!sentValue) {
    return { inUrl: false, captured: false, tier: 'not_found', storageHit: false, cookieHit: false, dataLayerHit: false };
  }

  // Tier 1 — exact key, exact value
  const storageExact = auditData.storage?.[paramName] === sentValue;
  const cookieExact = auditData.cookies?.[paramName] === sentValue;
  const dataLayerExact = auditData.dataLayer.some(
    (e) => Object.entries(e).some(([k, v]) => k === paramName && String(v) === sentValue),
  );
  if (storageExact || cookieExact || dataLayerExact) {
    return { inUrl: true, captured: true, tier: 'exact', storageHit: storageExact, cookieHit: cookieExact, dataLayerHit: dataLayerExact };
  }

  // Tier 2 — same value, different key (or one level of JSON nesting)
  const storageKey = findValueUnderDifferentKey(auditData.storage, paramName, sentValue);
  const cookieKey = findValueUnderDifferentKey(auditData.cookies, paramName, sentValue);
  const dataLayerKey = findValueInDataLayerUnderDifferentKey(auditData.dataLayer, paramName, sentValue);
  if (storageKey || cookieKey || dataLayerKey) {
    return {
      inUrl: true,
      captured: true,
      tier: 'value_match',
      storageHit: !!storageKey,
      cookieHit: !!cookieKey,
      dataLayerHit: !!dataLayerKey,
      matchedKey: storageKey ?? cookieKey ?? dataLayerKey,
    };
  }

  // Tier 3 — not found anywhere
  return { inUrl: true, captured: false, tier: 'not_found', storageHit: false, cookieHit: false, dataLayerHit: false };
}

function captureEvidence(paramName: string, check: CaptureCheck): string[] {
  const lines = [
    `In landing URL: ${check.inUrl}`,
    `Stored in localStorage["${paramName}"]: ${check.tier === 'exact' && check.storageHit}`,
    `Stored in a cookie["${paramName}"]: ${check.tier === 'exact' && check.cookieHit}`,
    `Echoed into a dataLayer event: ${check.tier === 'exact' && check.dataLayerHit}`,
  ];
  if (check.tier === 'value_match' && check.matchedKey) {
    const mechanism = check.storageHit ? 'localStorage' : check.cookieHit ? 'a cookie' : 'a dataLayer event';
    lines.push(`Value found under a different key ("${check.matchedKey}") in ${mechanism} — captured, just not under the expected name`);
  }
  return lines;
}

// ── L2.1-2.7 — Per-platform click ID captured at landing ─────────────────────

function makeClickIdCaptureRule(opts: {
  id: string;
  rule_id: string;
  check: string;
  paramName: (typeof SYNTHETIC_PARAMS)[number];
  severity: ValidationRule['severity'];
  platform_scope: ValidationRule['platform_scope'];
  why: string;
}): ValidationRule {
  return {
    id: opts.id,
    rule_id: opts.rule_id,
    layer: 'click_id_capture',
    check: opts.check,
    severity: opts.severity,
    applies_to: 'all',
    platform_scope: opts.platform_scope,
    detectable_by: 'crawl',
    owner: 'Frontend',
    remediation: `Read the injected ${opts.paramName} URL parameter on page load and persist it — a first-party cookie or localStorage, before the user can navigate away. A value sitting only in the URL is lost the moment they click through to another page.`,

    test(auditData: AuditData): ValidationResult {
      const result = checkParamCapture(auditData, opts.paramName);
      const status: RuleStatus = !result.inUrl ? 'skipped' : result.captured ? 'pass' : 'fail';

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status,
        severity: this.severity,
        technical_details: {
          found: !result.inUrl
            ? `${opts.paramName} was never injected into the landing URL for this run`
            : result.captured
              ? result.tier === 'exact'
                ? `${opts.paramName} captured (${[result.storageHit && 'localStorage', result.cookieHit && 'cookie', result.dataLayerHit && 'dataLayer'].filter(Boolean).join(', ')})`
                : `${opts.paramName} captured under a different key ("${result.matchedKey}") — the value matches exactly`
              : `${opts.paramName} present in the landing URL but never read into storage, a cookie, or dataLayer`,
          expected: opts.why,
          evidence: captureEvidence(opts.paramName, result),
        },
      };
    },
  };
}

export const GCLID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.1',
  rule_id: 'GCLID_CAPTURED_AT_LANDING',
  check: 'gclid captured at landing',
  paramName: 'gclid',
  severity: 'critical',
  platform_scope: ['google_ads'],
  why: 'gclid present in the URL is read and stored by the page — the entry point for all Google click attribution',
});

export const GBRAID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.2',
  rule_id: 'GBRAID_CAPTURED_AT_LANDING',
  check: 'gbraid captured at landing',
  paramName: 'gbraid',
  severity: 'critical',
  platform_scope: ['google_ads'],
  why: 'gbraid is read and stored — iOS app-to-web clicks arrive as gbraid; missing it silently drops iOS traffic',
});

export const WBRAID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.3',
  rule_id: 'WBRAID_CAPTURED_AT_LANDING',
  check: 'wbraid captured at landing',
  paramName: 'wbraid',
  severity: 'critical',
  platform_scope: ['google_ads'],
  why: 'wbraid is read and stored — web-to-app and privacy-restricted Google clicks arrive as wbraid',
});

export const FBCLID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.4',
  rule_id: 'FBCLID_CAPTURED_AT_LANDING',
  check: 'fbclid captured at landing',
  paramName: 'fbclid',
  severity: 'critical',
  platform_scope: ['meta'],
  why: 'fbclid present in the URL is read and stored — the entry point for Meta click attribution',
});

export const TTCLID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.5',
  rule_id: 'TTCLID_CAPTURED_AT_LANDING',
  check: 'ttclid captured at landing',
  paramName: 'ttclid',
  severity: 'critical',
  platform_scope: ['tiktok'],
  why: 'ttclid is read and stored — the entry point for TikTok attribution, observable without any TikTok API access',
});

export const LI_FAT_ID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.6',
  rule_id: 'LI_FAT_ID_CAPTURED_AT_LANDING',
  check: 'li_fat_id captured at landing',
  paramName: 'li_fat_id',
  severity: 'high',
  platform_scope: ['linkedin'],
  why: 'The LinkedIn click ID is read and stored — the entry point for LinkedIn attribution',
});

export const MSCLKID_CAPTURED_AT_LANDING = makeClickIdCaptureRule({
  id: 'L2.7',
  rule_id: 'MSCLKID_CAPTURED_AT_LANDING',
  check: 'msclkid captured at landing',
  paramName: 'msclkid',
  severity: 'high',
  platform_scope: ['microsoft'],
  why: 'The Microsoft click ID is read and stored — the entry point for Microsoft attribution',
});

// ── L2.8 — UTM parameters captured ────────────────────────────────────────────

const REQUIRED_UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const OPTIONAL_UTM_PARAMS = ['utm_content', 'utm_term'] as const;

export const UTM_PARAMETERS_CAPTURED: ValidationRule = {
  id: 'L2.8',
  rule_id: 'UTM_PARAMETERS_CAPTURED',
  layer: 'click_id_capture',
  check: 'UTM parameters captured',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: (result) => {
    const missing = result.technical_details.evidence
      .filter((e) => e.endsWith('in URL but not captured'))
      .map((e) => e.split(':')[0]);
    if (missing.length === 0) return 'Read the UTM parameters present in the landing URL and persist them (localStorage and/or a first-party cookie) before the user navigates away.';
    return `Read and persist these UTM parameters on landing: ${missing.join(', ')}. They're present in the URL but never make it into storage, a cookie, or dataLayer.`;
  },

  test(auditData: AuditData): ValidationResult {
    const checks = [...REQUIRED_UTM_PARAMS, ...OPTIONAL_UTM_PARAMS].map(
      (p) => ({ param: p, ...checkParamCapture(auditData, p) }),
    );

    if (!checks.some((c) => c.inUrl)) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No UTM parameters were injected into the landing URL for this run',
          expected: 'utm_source, utm_medium, utm_campaign, utm_content, utm_term are read',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const missingRequired = checks.filter((c) => REQUIRED_UTM_PARAMS.includes(c.param as typeof REQUIRED_UTM_PARAMS[number]) && !c.captured);
    const missingOptional = checks.filter((c) => OPTIONAL_UTM_PARAMS.includes(c.param as typeof OPTIONAL_UTM_PARAMS[number]) && !c.captured);
    const status: RuleStatus = missingRequired.length > 0 ? 'fail' : missingOptional.length > 0 ? 'warning' : 'pass';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found: `${checks.filter((c) => c.captured).length}/${checks.length} UTM parameters captured`,
        expected: 'utm_source, utm_medium, utm_campaign, utm_content, utm_term are all read',
        evidence: checks.map((c) => `${c.param}: ${
          c.captured
            ? c.tier === 'exact' ? 'captured' : `captured (as "${c.matchedKey}")`
            : c.inUrl ? 'in URL but not captured' : 'not injected'
        }`),
      },
    };
  },
};

// ── L2.9 / L2.10 — Redirect behavior around the landing sequence ─────────────
//
// Both read landing_final_url (journeySimulator's page.url() after the
// landing navigation settles) against urlParams (what Atlas sent) to see
// which synthetic params, if any, a redirect stripped before the page
// itself could act on them.

function missingParamsAfterRedirect(auditData: AuditData): string[] {
  const finalUrl = auditData.landing_final_url;
  if (!finalUrl) return [];
  let finalParams: URLSearchParams;
  try {
    finalParams = new URL(finalUrl).searchParams;
  } catch {
    return [];
  }
  return SYNTHETIC_PARAMS.filter((p) => {
    const sent = auditData.urlParams?.[p];
    return !!sent && finalParams.get(p) !== sent;
  });
}

export const LANDING_REDIRECT_PRESERVES_QUERY_STRING: ValidationRule = {
  id: 'L2.9',
  rule_id: 'LANDING_REDIRECT_PRESERVES_QUERY_STRING',
  layer: 'click_id_capture',
  check: 'Landing redirect preserves query string',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: (result) => {
    const strippedLine = result.technical_details.evidence.find((e) => e.startsWith('Stripped:'));
    const stripped = strippedLine ? strippedLine.replace('Stripped: ', '') : 'the affected parameter(s)';
    return `Check the redirect chain on entry (www/non-www, HTTP→HTTPS, a marketing-page or CDN redirect, a CMP/consent interstitial) for one that rewrites the URL without forwarding its query string. Preserve ${stripped} through every hop, or capture them before the first redirect fires.`;
  },

  test(auditData: AuditData): ValidationResult {
    if (!auditData.landing_final_url) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No final landing URL was captured for this run',
          expected: 'Query parameters survive any redirect chain on entry',
          evidence: ['Rule skipped — nothing to compare against'],
        },
      };
    }

    const missing = missingParamsAfterRedirect(auditData);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: missing.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: missing.length > 0
          ? `${missing.length} param(s) stripped by the time navigation settled: ${missing.join(', ')}`
          : 'All injected query parameters survived to the final landing URL',
        expected: 'Query parameters survive any redirect chain on entry',
        evidence: [`Final URL: ${auditData.landing_final_url}`, `Stripped: ${missing.length > 0 ? missing.join(', ') : 'none'}`],
      },
    };
  },
};

export const CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES: ValidationRule = {
  id: 'L2.10',
  rule_id: 'CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES',
  layer: 'click_id_capture',
  check: 'Capture occurs before redirect completes',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: (result) => {
    const strippedLine = result.technical_details.evidence.find((e) => e.startsWith('Stripped by redirect:'));
    const stripped = strippedLine ? strippedLine.replace('Stripped by redirect: ', '') : 'the affected click ID(s)';
    return `Capture ${stripped} on the very first response the browser receives — before any redirect fires — rather than waiting for the page that finally renders. A script tag or edge/middleware read at the entry point, ahead of the redirect chain, fixes this.`;
  },

  test(auditData: AuditData): ValidationResult {
    if (!auditData.landing_final_url) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No final landing URL was captured for this run',
          expected: 'Click ID is read on the first response, not only after the final hop',
          evidence: ['Rule skipped — nothing to compare against'],
        },
      };
    }

    const missing = missingParamsAfterRedirect(auditData);

    if (missing.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'The full query string survived to the final landing URL — nothing was lost to test capture timing against',
          expected: 'Click ID is read on the first response, not only after the final hop',
          evidence: ['Rule skipped — see LANDING_REDIRECT_PRESERVES_QUERY_STRING (L2.9)'],
        },
      };
    }

    const rescued = missing.filter((p) => checkParamCapture(auditData, p).captured);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: rescued.length > 0 ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: rescued.length > 0
          ? `${rescued.length} of ${missing.length} param(s) stripped from the final URL were still captured (${rescued.join(', ')}) — capture ran before the redirect completed`
          : `${missing.length} param(s) stripped from the final URL (${missing.join(', ')}) and none were captured — the identifier was lost`,
        expected: 'Click ID is read on the first response, not only after the final hop',
        evidence: [`Stripped by redirect: ${missing.join(', ')}`, `Still captured despite stripping: ${rescued.length > 0 ? rescued.join(', ') : 'none'}`],
      },
    };
  },
};

// ── L2.11 — Referrer preserved through entry ─────────────────────────────────

export const REFERRER_PRESERVED_THROUGH_ENTRY: ValidationRule = {
  id: 'L2.11',
  rule_id: 'REFERRER_PRESERVED_THROUGH_ENTRY',
  layer: 'click_id_capture',
  check: 'Referrer preserved through entry',
  severity: 'low',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  remediation: 'Avoid a client-side redirect or meta-refresh on entry that clears document.referrer — use a server-side (HTTP) redirect instead, which preserves it. This is a fallback attribution signal for visits with no click ID, so it\'s lower priority than the click-ID capture rules above.',

  test(auditData: AuditData): ValidationResult {
    const referrer = auditData.landing_referrer_captured;

    if (referrer === undefined) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'Referrer capture was not attempted for this run',
          expected: 'document.referrer survives the landing sequence',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const preserved = referrer.length > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: preserved ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: preserved ? `document.referrer = "${referrer}"` : 'document.referrer is empty on the landing page',
        expected: 'document.referrer survives the landing sequence as a fallback attribution signal when click IDs are absent',
        evidence: [`Referrer captured: ${preserved}`],
      },
    };
  },
};

export const L2_RULES: ValidationRule[] = [
  GCLID_CAPTURED_AT_LANDING,
  GBRAID_CAPTURED_AT_LANDING,
  WBRAID_CAPTURED_AT_LANDING,
  FBCLID_CAPTURED_AT_LANDING,
  TTCLID_CAPTURED_AT_LANDING,
  LI_FAT_ID_CAPTURED_AT_LANDING,
  MSCLKID_CAPTURED_AT_LANDING,
  UTM_PARAMETERS_CAPTURED,
  LANDING_REDIRECT_PRESERVES_QUERY_STRING,
  CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES,
  REFERRER_PRESERVED_THROUGH_ENTRY,
];
