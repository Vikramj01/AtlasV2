/**
 * Layer L4 — Cross-Domain Continuity (4 of 9 rules — see note on L4.5-9
 * below).
 *
 * Everything up to L3 asked "does the identifier survive on this site."
 * This layer asks what happens when the journey crosses a real domain
 * boundary — marketing site to product/app subdomain, or to a hosted
 * checkout. journeySimulator.ts feeds this with two capture additions:
 *  - outboundCrossDomainLinks: a DOM scan of the landing page's <a href>
 *    tags pointing at the declared product/checkout domain, counting how
 *    many carry GA4's `_gl` linker parameter (L4.1/L4.2).
 *  - marketingGa4ClientId / productDomainGa4ClientId /
 *    productDomainSessionStartDetected: from an actual second visit to
 *    product_domain, in the same browser context, only when it's a
 *    genuinely distinct and reachable host (L4.3/L4.4).
 *
 * L4.3/L4.4 read whichever of product_domain's or checkout_domain's
 * captured continuity data journeySimulator.ts actually populated for this
 * site — an ecommerce site boundary-checks checkout_domain (hosted
 * checkout), a plg_saas/marketplace site boundary-checks product_domain
 * (app subdomain); a site with both set has product_domain take precedence.
 *
 * L4.5 ("referral exclusion configured") is Connector-detectable — it
 * lives in GA4's own admin settings, not observable from a crawl. L4.6
 * ("click ID readable inside the product"), L4.7 ("auth boundary does not
 * reset storage"), and L4.9 ("identity available at the conversion
 * moment") are Credentials-detectable — they require logging into the
 * authenticated app, which is out of scope for an unauthenticated crawl.
 * L4.8 ("payment host return preserves identity") is Second-pass
 * detectable. All five deferred, same as every other non-crawl detection
 * method so far. Not included in L4_RULES.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus } from '@/types/audit';

const CROSS_DOMAIN_SITE_TYPES = ['plg_saas', 'marketplace', 'ecommerce'] as const;

// ── L4.1 — Cross-domain linker configured ────────────────────────────────────
//
// "Any outbound link carries _gl" — proof the linker mechanism is active
// somewhere. L4.2 below asks the stricter question (applied consistently).

export const CROSS_DOMAIN_LINKER_CONFIGURED: ValidationRule = {
  id: 'L4.1',
  rule_id: 'CROSS_DOMAIN_LINKER_CONFIGURED',
  layer: 'cross_domain_continuity',
  check: 'Cross-domain linker configured',
  severity: 'critical',
  applies_to: [...CROSS_DOMAIN_SITE_TYPES],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const links = auditData.outboundCrossDomainLinks;

    if (!links || links.total === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No outbound links to the declared product/checkout domain were found on the landing page',
          expected: 'Linker is set for the declared product or checkout domain',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const active = links.withGl > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: active ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: active
          ? `${links.withGl} of ${links.total} outbound link(s) carry the _gl linker parameter`
          : `None of ${links.total} outbound link(s) to the product/checkout domain carry _gl`,
        expected: 'Without a configured linker, GA4 treats the app/checkout as a separate site and a new session',
        evidence: [`Outbound links to product/checkout domain: ${links.total}`, `Carrying _gl: ${links.withGl}`],
      },
    };
  },
};

// ── L4.2 — _gl parameter appended on outbound links ──────────────────────────
//
// The stricter twin of L4.1: not just "is the mechanism active somewhere"
// but "is it applied to every outbound link" — a partial rollout still
// loses attribution for whichever links were missed.

export const GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS: ValidationRule = {
  id: 'L4.2',
  rule_id: 'GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS',
  layer: 'cross_domain_continuity',
  check: '_gl parameter appended on outbound links',
  severity: 'critical',
  applies_to: [...CROSS_DOMAIN_SITE_TYPES],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const links = auditData.outboundCrossDomainLinks;

    if (!links || links.total === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No outbound links to the declared product/checkout domain were found on the landing page',
          expected: 'Links to the product domain carry the linker parameter',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const consistent = links.withGl === links.total;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: consistent ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: consistent
          ? `All ${links.total} outbound link(s) carry _gl`
          : `Only ${links.withGl} of ${links.total} outbound link(s) carry _gl — inconsistent application`,
        expected: '_gl is the transport mechanism for cross-domain identity — every outbound link to the product/checkout domain needs it',
        evidence: [`Outbound links to product/checkout domain: ${links.total}`, `Carrying _gl: ${links.withGl}`],
      },
    };
  },
};

// ── L4.3 — GA4 client_id persists across the boundary ────────────────────────

export const GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY: ValidationRule = {
  id: 'L4.3',
  rule_id: 'GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY',
  layer: 'cross_domain_continuity',
  check: 'GA4 client_id persists across the boundary',
  severity: 'critical',
  applies_to: ['plg_saas', 'marketplace', 'ecommerce'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const before = auditData.marketingGa4ClientId;
    const after = auditData.productDomainGa4ClientId ?? auditData.checkoutDomainGa4ClientId;
    const boundaryLabel = auditData.productDomainGa4ClientId !== undefined ? 'product domain' : 'checkout domain';

    if (!before || !after) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !before && !after
            ? 'No GA4 client_id observed on either side of the domain boundary'
            : !before
              ? 'No GA4 client_id observed on the marketing site'
              : `No GA4 client_id observed on the ${boundaryLabel} (unreachable, same-host, or GA4 not firing there)`,
          expected: 'Same client_id observed on marketing site and product/checkout domain',
          evidence: ['Rule skipped — nothing to compare'],
        },
      };
    }

    const matches = before === after;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: matches ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: matches ? `Same client_id (${before}) on both sides of the boundary` : `client_id changed: ${before} → ${after}`,
        expected: 'A new client_id means the journey is recorded as two unrelated users',
        evidence: [`Marketing site client_id: ${before}`, `${boundaryLabel} client_id: ${after}`],
      },
    };
  },
};

// ── L4.4 — Session not restarted at the boundary ─────────────────────────────

export const SESSION_NOT_RESTARTED_AT_BOUNDARY: ValidationRule = {
  id: 'L4.4',
  rule_id: 'SESSION_NOT_RESTARTED_AT_BOUNDARY',
  layer: 'cross_domain_continuity',
  check: 'Session not restarted at the boundary',
  severity: 'high',
  applies_to: ['plg_saas', 'marketplace', 'ecommerce'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const restarted = auditData.productDomainSessionStartDetected ?? auditData.checkoutDomainSessionStartDetected;
    const boundaryLabel = auditData.productDomainSessionStartDetected !== undefined ? 'product domain' : 'checkout domain';

    if (restarted === undefined) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No product/checkout-domain visit was made (unreachable, same-host, or not set)',
          expected: 'No new session_start on crossing to the product/checkout domain',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: restarted ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: restarted ? `A GA4 session_start hit fired on the ${boundaryLabel} visit` : `No session_start hit fired on the ${boundaryLabel} visit — the session continued`,
        expected: 'Self-referral session restarts inflate session counts and destroy funnel analysis',
        evidence: [`session_start detected on ${boundaryLabel}: ${restarted}`],
      },
    };
  },
};

export const L4_RULES: ValidationRule[] = [
  CROSS_DOMAIN_LINKER_CONFIGURED,
  GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS,
  GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY,
  SESSION_NOT_RESTARTED_AT_BOUNDARY,
];
