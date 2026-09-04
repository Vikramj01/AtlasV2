/**
 * Layer L3 — Storage Durability (6 of 9 rules — see note on L3.7-9 below).
 *
 * L2 (Click ID Capture) asked "did the page read the identifier at all."
 * This layer asks the harder question: is where it landed durable enough
 * to survive to conversion. Reads AuditData.detailedCookies (full
 * domain/expires/secure/sameSite attributes — see its docstring in
 * types/audit.ts) and .sessionStorage (captured separately from
 * localStorage specifically so "written to sessionStorage only" is
 * distinguishable from real durability).
 *
 * L3.7 ("survives a new session"), L3.8 ("no overwrite by later organic
 * visit"), and L3.9 ("not blocked by ITP/ETP") are all Detectable by:
 * Second pass in the Check Register — each requires a second crawl (a
 * fresh session, a follow-up organic visit, a tracking-prevention
 * browser profile) to compare against. Out of scope for this phase, same
 * as every other non-crawl detection method deferred so far. Not
 * included in L3_RULES.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus, DetailedCookie } from '@/types/audit';

const SYNTHETIC_PARAMS = ['gclid', 'fbclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'msclkid'] as const;
const KNOWN_DURABLE_COOKIE_NAMES = ['_gcl_aw', '_gcl_au', '_fbc', '_fbp'] as const;

/** Every cookie relevant to click-ID durability: our synthetic params plus the real platform cookies they end up in. */
function relevantCookies(auditData: AuditData): DetailedCookie[] {
  const names = new Set<string>([...SYNTHETIC_PARAMS, ...KNOWN_DURABLE_COOKIE_NAMES]);
  return (auditData.detailedCookies ?? []).filter((c) => names.has(c.name));
}

const SECONDS_PER_DAY = 86_400;

/** Google's own linker cookies get a 90-day window; everything else defaults to Meta's 7-day click window unless it's clearly Meta already. */
function requiredWindowDays(cookieName: string): number {
  if (cookieName === '_gcl_aw' || cookieName === '_gcl_au' || cookieName === 'gclid' || cookieName === 'gbraid' || cookieName === 'wbraid') return 90;
  return 7;
}

function maxAgeDays(cookie: DetailedCookie, nowSeconds: number): number {
  if (cookie.expires < 0) return 0; // session cookie — no max-age at all
  return (cookie.expires - nowSeconds) / SECONDS_PER_DAY;
}

// ── L3.1 — Click ID written to durable storage ───────────────────────────────

export const CLICK_ID_WRITTEN_TO_DURABLE_STORAGE: ValidationRule = {
  id: 'L3.1',
  rule_id: 'CLICK_ID_WRITTEN_TO_DURABLE_STORAGE',
  layer: 'storage_durability',
  check: 'Click ID written to durable storage',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const checks = SYNTHETIC_PARAMS.map((param) => {
      const sent = auditData.urlParams?.[param];
      const cookieHit = !!sent && auditData.cookies?.[param] === sent;
      const sessionOnly = !!sent && !cookieHit && auditData.sessionStorage?.[param] === sent;
      return { param, sent: !!sent, cookieHit, sessionOnly };
    }).filter((c) => c.sent);

    if (checks.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No click ID was injected for this run',
          expected: 'Identifier is written to a cookie, not only sessionStorage',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const sessionOnlyParams = checks.filter((c) => c.sessionOnly);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: sessionOnlyParams.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: sessionOnlyParams.length > 0
          ? `${sessionOnlyParams.length} identifier(s) written to sessionStorage only: ${sessionOnlyParams.map((c) => c.param).join(', ')}`
          : 'No identifiers found written to sessionStorage only',
        expected: 'Identifier is written to a cookie, not only sessionStorage — sessionStorage is destroyed on tab close',
        evidence: checks.map((c) => `${c.param}: ${c.cookieHit ? 'in a cookie (durable)' : c.sessionOnly ? 'sessionStorage only — lost on tab close' : 'not captured'}`),
      },
    };
  },
};

// ── L3.2 — Storage lifetime meets attribution window ─────────────────────────

export const STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW: ValidationRule = {
  id: 'L3.2',
  rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW',
  layer: 'storage_durability',
  check: 'Storage lifetime meets attribution window',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const cookies = relevantCookies(auditData);

    if (cookies.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No click-ID-carrying cookie was found',
          expected: 'Cookie max-age is at least as long as the platform window (90d Google, 7d Meta click)',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const nowSeconds = Date.now() / 1000;
    // Rounded to whole days before comparing — maxAgeDays() measures remaining
    // lifetime at scan time, so a cookie set with exactly a 90-day Max-Age
    // always reads as fractionally under 90 by the time this runs. Comparing
    // on the same rounded value shown in the evidence keeps "displays as 90d"
    // and "needs 90d" from disagreeing with each other.
    const roundedDays = (c: DetailedCookie) => Math.max(0, Math.round(maxAgeDays(c, nowSeconds)));
    const violations = cookies
      .map((c) => ({ cookie: c, days: roundedDays(c), required: requiredWindowDays(c.name) }))
      .filter((c) => c.days < c.required);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} cookie(s) shorter than their attribution window: ${violations.map((v) => `${v.cookie.name} (${v.days}d, needs ${v.required}d)`).join(', ')}`
          : 'All click-ID cookies meet their platform attribution window',
        expected: 'Cookie max-age is at least as long as the platform window (90d Google, 7d Meta click)',
        evidence: cookies.map((c) => `${c.name}: ${roundedDays(c) <= 0 ? 'session cookie (0d)' : `${roundedDays(c)}d`} (needs ${requiredWindowDays(c.name)}d)`),
      },
    };
  },
};

// ── L3.3 — _gcl_aw cookie present and populated ───────────────────────────────

export const GCL_AW_COOKIE_PRESENT: ValidationRule = {
  id: 'L3.3',
  rule_id: 'GCL_AW_COOKIE_PRESENT',
  layer: 'storage_durability',
  check: '_gcl_aw cookie present and populated',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: ['google_ads'],
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const value = auditData.cookies?.['_gcl_aw'];
    const present = !!value;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: present ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: present ? '_gcl_aw cookie is present and populated' : '_gcl_aw cookie not found',
        expected: "Google's own linker cookie (_gcl_aw) exists after an ad click — the mechanism Google itself relies on for Enhanced Conversions",
        evidence: [`_gcl_aw present: ${present}`],
      },
    };
  },
};

// ── L3.4 — _fbp and _fbc cookies present ──────────────────────────────────────

export const FBP_AND_FBC_COOKIES_PRESENT: ValidationRule = {
  id: 'L3.4',
  rule_id: 'FBP_AND_FBC_COOKIES_PRESENT',
  layer: 'storage_durability',
  check: '_fbp and _fbc cookies present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: ['meta'],
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const hasFbp = !!auditData.cookies?.['_fbp'];
    const hasFbc = !!auditData.cookies?.['_fbc'];

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: hasFbp && hasFbc ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasFbp && hasFbc ? 'Both _fbp and _fbc are present' : `Missing: ${[!hasFbp && '_fbp', !hasFbc && '_fbc'].filter(Boolean).join(', ')}`,
        expected: 'Both Meta browser (_fbp) and click (_fbc) cookies are set — match rate collapses without them',
        evidence: [`_fbp present: ${hasFbp}`, `_fbc present: ${hasFbc}`],
      },
    };
  },
};

// ── L3.5 — Cookie scoped to parent domain ─────────────────────────────────────
//
// Applies only to site types where an app/product subdomain is expected
// (PLG SaaS, marketplace, subscription media) — the register's own
// applicability list. Host-only cookies vanish the moment the journey
// crosses from the marketing domain to an app subdomain.

export const COOKIE_SCOPED_TO_PARENT_DOMAIN: ValidationRule = {
  id: 'L3.5',
  rule_id: 'COOKIE_SCOPED_TO_PARENT_DOMAIN',
  layer: 'storage_durability',
  check: 'Cookie scoped to parent domain',
  severity: 'critical',
  applies_to: ['plg_saas', 'marketplace', 'subscription_media'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const cookies = relevantCookies(auditData);

    if (cookies.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No click-ID-carrying cookie was found',
          expected: 'Cookie domain is .example.com, not host-only',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const hostOnly = cookies.filter((c) => !c.domain.startsWith('.'));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: hostOnly.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: hostOnly.length > 0
          ? `${hostOnly.length} cookie(s) are host-only, not parent-domain-scoped: ${hostOnly.map((c) => `${c.name} (${c.domain || 'no domain set'})`).join(', ')}`
          : 'All click-ID cookies are scoped to the parent domain',
        expected: 'Cookie domain is .example.com (parent-scoped), not host-only — host-only scoping means the identifier vanishes at the app subdomain',
        evidence: cookies.map((c) => `${c.name}: domain=${c.domain || '(host-only)'}`),
      },
    };
  },
};

// ── L3.6 — Cookie attributes correct ──────────────────────────────────────────
//
// SameSite=None without Secure is a hard browser requirement — such
// cookies are rejected outright, not just risky. SameSite=Strict is the
// register's explicit concern for cross-site return journeys (e.g. back
// from a payment host), so it's flagged too even though it isn't rejected
// by the browser the way an unsecured None cookie is.

export const COOKIE_ATTRIBUTES_CORRECT: ValidationRule = {
  id: 'L3.6',
  rule_id: 'COOKIE_ATTRIBUTES_CORRECT',
  layer: 'storage_durability',
  check: 'Cookie attributes correct',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const cookies = relevantCookies(auditData);

    if (cookies.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No click-ID-carrying cookie was found',
          expected: 'SameSite and Secure are set appropriately for cross-site return journeys',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const violations = cookies.filter(
      (c) => (c.sameSite === 'None' && !c.secure) || c.sameSite === 'Strict',
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} cookie(s) with risky attributes: ${violations.map((c) => `${c.name} (SameSite=${c.sameSite}, Secure=${c.secure})`).join(', ')}`
          : 'All click-ID cookies have correct SameSite/Secure attributes',
        expected: 'SameSite=None requires Secure (or browsers reject the cookie outright); SameSite=Strict drops the cookie on return from a third-party payment host',
        evidence: cookies.map((c) => `${c.name}: SameSite=${c.sameSite}, Secure=${c.secure}`),
      },
    };
  },
};

export const L3_RULES: ValidationRule[] = [
  CLICK_ID_WRITTEN_TO_DURABLE_STORAGE,
  STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW,
  GCL_AW_COOKIE_PRESENT,
  FBP_AND_FBC_COOKIES_PRESENT,
  COOKIE_SCOPED_TO_PARENT_DOMAIN,
  COOKIE_ATTRIBUTES_CORRECT,
];
