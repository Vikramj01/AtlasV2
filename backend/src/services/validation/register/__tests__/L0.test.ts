/**
 * Layer L0 — Scope & Configuration rule tests.
 *
 * Covers each of the 4 rules' pass/fail/skipped/warning branches.
 */
import { describe, it, expect } from 'vitest';
import {
  DECLARED_PLATFORM_HAS_TAG,
  UNDECLARED_PLATFORM_TAG_DETECTED,
  CONVERSION_SURFACE_IDENTIFIED,
  PRODUCT_DOMAIN_REACHABLE,
  conversionSurfaceReached,
  isVerifiedStep,
  L0_RULES,
} from '../L0';
import type { AuditData, NetworkRequest, StepCoverage } from '@/types/audit';

function makeStep(overrides: Partial<StepCoverage> = {}): StepCoverage {
  return {
    step: 'product',
    requested_url: 'https://example.com/product',
    final_url: 'https://example.com/product',
    source: 'user_supplied',
    distinct_from_landing: true,
    navigation_success: true,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/whatever',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'landing',
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L0.1 — Declared platform has a tag present ──────────────────────────────

describe('DECLARED_PLATFORM_HAS_TAG (L0.1)', () => {
  it('passes when every declared platform has a tag present', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      networkRequests: [
        makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' }),
        makeRequest({ url: 'https://www.facebook.com/tr?id=123' }),
      ],
    });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.rule_id).toBe('DECLARED_PLATFORM_HAS_TAG');
  });

  it('fails when a declared platform has no tag detected', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      networkRequests: [makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' })],
    });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.some((e) => e.includes('Meta') && e.includes('no tag observed'))).toBe(true);
  });

  it('is skipped when no platforms are declared', () => {
    const result = DECLARED_PLATFORM_HAS_TAG.test(makeAuditData({ declared_platforms: [] }));
    expect(result.status).toBe('skipped');
  });

  // Pre-Connection Scan Confidence Tiering PRD §8 — severity ceiling by
  // declaration_source. A missing-tag fail rests entirely on a declaration
  // that may simply be wrong, so its severity shouldn't outrank how
  // confident Atlas is that the declaration itself is correct.
  describe('severity ceiling by declaration_source (§8)', () => {
    const failingAuditData = (declaration_source?: 'CLIENT_CONFIRMED' | 'OPERATOR_ASSUMED' | 'INFERRED_FROM_SITE') =>
      makeAuditData({ declared_platforms: ['meta'], networkRequests: [], declaration_source });

    it('defaults to OPERATOR_ASSUMED when unset, capping severity to medium', () => {
      const result = DECLARED_PLATFORM_HAS_TAG.test(failingAuditData(undefined));
      expect(result.severity).toBe('medium');
      expect(result.severity_capped_from).toBe('critical');
    });

    it('CLIENT_CONFIRMED applies no cap — stays at the declared critical severity', () => {
      const result = DECLARED_PLATFORM_HAS_TAG.test(failingAuditData('CLIENT_CONFIRMED'));
      expect(result.severity).toBe('critical');
      expect(result.severity_capped_from).toBeUndefined();
    });

    it('OPERATOR_ASSUMED caps at medium', () => {
      const result = DECLARED_PLATFORM_HAS_TAG.test(failingAuditData('OPERATOR_ASSUMED'));
      expect(result.severity).toBe('medium');
      expect(result.severity_capped_from).toBe('critical');
    });

    it('INFERRED_FROM_SITE caps at low', () => {
      const result = DECLARED_PLATFORM_HAS_TAG.test(failingAuditData('INFERRED_FROM_SITE'));
      expect(result.severity).toBe('low');
      expect(result.severity_capped_from).toBe('critical');
    });

    it('a passing result carries no severity cap regardless of declaration_source', () => {
      const auditData = makeAuditData({
        declared_platforms: ['meta'],
        networkRequests: [makeRequest({ url: 'https://www.facebook.com/tr?id=123' })],
        declaration_source: 'OPERATOR_ASSUMED',
      });
      const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
      expect(result.status).toBe('pass');
      expect(result.severity_capped_from).toBeUndefined();
    });
  });
});

// ── L0.2 — Undeclared platform tag detected ─────────────────────────────────

describe('UNDECLARED_PLATFORM_TAG_DETECTED (L0.2)', () => {
  it('passes when no undeclared platform tags are found', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      networkRequests: [makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' })],
    });
    const result = UNDECLARED_PLATFORM_TAG_DETECTED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('warns when an undeclared platform tag is detected', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      networkRequests: [
        makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' }),
        makeRequest({ url: 'https://analytics.tiktok.com/i18n/pixel/events.js' }),
      ],
    });
    const result = UNDECLARED_PLATFORM_TAG_DETECTED.test(auditData);
    expect(result.status).toBe('warning');
    expect(result.technical_details.found).toContain('TikTok');
  });
});

// ── L0.3 — Conversion surface identified ────────────────────────────────────

describe('CONVERSION_SURFACE_IDENTIFIED (L0.3)', () => {
  it('passes when a non-landing dataLayer step was reached', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'purchase', timestamp: Date.now(), step: 'conversion' }],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('passes when a non-landing network request step was reached', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ step: 'checkout' })],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('fails when the crawl never progressed past landing/init', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }],
      networkRequests: [makeRequest({ step: 'init' })],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('fail');
  });

  // ── step_coverage truth table (Site Evaluation Coverage & Honesty PRD §6.2) ──
  // Takes priority over the label-based check above whenever present — these
  // cases exist specifically because the label-based check could be fooled
  // by a step relabelled 'checkout' that never actually left the homepage.

  describe('with step_coverage present', () => {
    it('fails when every non-landing step fell back to the landing URL', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'product', distinct_from_landing: false, source: 'fallback_landing' }),
          makeStep({ step: 'checkout', distinct_from_landing: false, source: 'fallback_landing' }),
        ],
        // Old label-based signal would have passed this — dataLayer/network
        // events are still tagged with the (misleading) step name.
        dataLayer: [{ event: 'purchase', timestamp: Date.now(), step: 'checkout' }],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('fail');
      expect(result.technical_details.evidence.join(' ')).toContain('product, checkout');
    });

    it('passes when at least one step is both distinct from landing and successfully navigated', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'product', distinct_from_landing: false, source: 'fallback_landing' }),
          makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'user_supplied' }),
        ],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('pass');
      expect(result.technical_details.found).toContain('checkout');
    });

    it('fails when the only distinct step is a redirect back to the landing page (distinct_from_landing already false)', () => {
      // journeySimulator computes distinct_from_landing off final_url, so a
      // site-side redirect back to the homepage is already reflected here —
      // this case documents that the rule doesn't need its own redirect logic.
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({
            step: 'checkout',
            requested_url: 'https://example.com/checkout',
            final_url: 'https://example.com/', // redirected back to landing
            distinct_from_landing: false,
            navigation_success: true,
            source: 'user_supplied',
          }),
        ],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('fail');
    });

    it('fails when the only distinct step failed to navigate', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({
            step: 'confirmation',
            distinct_from_landing: true,
            navigation_success: false,
            error: 'net::ERR_NAME_NOT_RESOLVED',
            source: 'user_supplied',
          }),
        ],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('fail');
    });

    it('ignores dataLayer/networkRequests step labels entirely once step_coverage is present', () => {
      // Same shape as the old-logic 'passes' tests above, but with
      // step_coverage now saying every step fell back — proves the new
      // path takes priority and isn't fooled by relabelled requests.
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'checkout', distinct_from_landing: false, source: 'fallback_landing' }),
        ],
        networkRequests: [makeRequest({ step: 'checkout' })],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('fail');
    });
  });

  it('falls back to label-based logic when step_coverage is absent (Journey-Builder mode, legacy fixtures)', () => {
    const auditData = makeAuditData({
      step_coverage: undefined,
      networkRequests: [makeRequest({ step: 'checkout' })],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('pass');
  });

  // ── Verify guessed steps (Report Correctness Programme PRD Part C2) ────────
  // A step_coverage entry with source: 'heuristic' (stepUrlResolver.ts's
  // path-guess strategy) must be verified — HTTP 2xx, plus its declared
  // confirmation signal if one exists — before it counts as the conversion
  // surface; an unverified guess must not make this rule pass.

  describe('unverified heuristic (guessed) steps', () => {
    it('fails when the only distinct step is an unverified heuristic guess (no http_status captured)', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'heuristic' }),
        ],
      });
      const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
      expect(result.status).toBe('fail');
      expect(result.technical_details.evidence.join(' ')).toContain('unverified guess');
    });

    it('fails when a heuristic guess returned a non-2xx status', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'heuristic', http_status: 404 }),
        ],
      });
      expect(CONVERSION_SURFACE_IDENTIFIED.test(auditData).status).toBe('fail');
    });

    it('fails when a heuristic guess 200s but its declared confirmation signal never matched', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({
            step: 'checkout', distinct_from_landing: true, navigation_success: true,
            source: 'heuristic', http_status: 200, wait_for_outcome: 'timed_out',
          }),
        ],
      });
      expect(CONVERSION_SURFACE_IDENTIFIED.test(auditData).status).toBe('fail');
    });

    it('passes when a heuristic guess 200s and has no declared confirmation signal to check', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({
            step: 'checkout', distinct_from_landing: true, navigation_success: true,
            source: 'heuristic', http_status: 200, wait_for_outcome: 'not_declared',
          }),
        ],
      });
      expect(CONVERSION_SURFACE_IDENTIFIED.test(auditData).status).toBe('pass');
    });

    it('passes when a heuristic guess 200s and its declared confirmation signal matched', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({
            step: 'checkout', distinct_from_landing: true, navigation_success: true,
            source: 'heuristic', http_status: 200, wait_for_outcome: 'matched',
          }),
        ],
      });
      expect(CONVERSION_SURFACE_IDENTIFIED.test(auditData).status).toBe('pass');
    });

    it('never requires verification for a non-heuristic source (sitemap/nav_link/user_supplied/fallback_landing)', () => {
      const auditData = makeAuditData({
        step_coverage: [
          makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
          makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'sitemap' }),
        ],
      });
      expect(CONVERSION_SURFACE_IDENTIFIED.test(auditData).status).toBe('pass');
    });
  });
});

describe('conversionSurfaceReached (engine.ts\'s conversion_surface precondition)', () => {
  // Report Correctness Programme PRD Part C4 — "accept now": when the
  // conversion step is only an unverified heuristic guess, this returns
  // false, so engine.ts's precondition gate routes every L5/L7/L4.3/L4.4
  // rule requiring conversion_surface to 'skipped' (inconclusive) rather
  // than letting them run against a page that might not be the real
  // conversion surface at all.
  it('is false when the only distinct step is an unverified heuristic guess', () => {
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
        makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'heuristic' }),
      ],
    });
    expect(conversionSurfaceReached(auditData)).toBe(false);
  });

  it('is true when the heuristic guess is verified', () => {
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', distinct_from_landing: false, source: 'user_supplied' }),
        makeStep({ step: 'checkout', distinct_from_landing: true, navigation_success: true, source: 'heuristic', http_status: 200, wait_for_outcome: 'matched' }),
      ],
    });
    expect(conversionSurfaceReached(auditData)).toBe(true);
  });
});

describe('isVerifiedStep', () => {
  it('trusts any non-heuristic source unconditionally', () => {
    expect(isVerifiedStep({ source: 'user_supplied' })).toBe(true);
    expect(isVerifiedStep({ source: 'sitemap' })).toBe(true);
    expect(isVerifiedStep({ source: 'nav_link' })).toBe(true);
    expect(isVerifiedStep({ source: 'fallback_landing' })).toBe(true);
  });

  it('requires a 2xx http_status for a heuristic step', () => {
    expect(isVerifiedStep({ source: 'heuristic', http_status: 200 })).toBe(true);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 299 })).toBe(true);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 404 })).toBe(false);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 500 })).toBe(false);
    expect(isVerifiedStep({ source: 'heuristic' })).toBe(false); // no http_status captured at all
  });

  it('additionally requires a declared confirmation signal to have matched', () => {
    expect(isVerifiedStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'matched' })).toBe(true);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'not_declared' })).toBe(true);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'timed_out' })).toBe(false);
    expect(isVerifiedStep({ source: 'heuristic', http_status: 200 })).toBe(true); // wait_for_outcome absent — nothing declared to confirm
  });
});

// ── L0.4 — Product domain reachable ─────────────────────────────────────────

describe('PRODUCT_DOMAIN_REACHABLE (L0.4)', () => {
  it('is skipped when product_domain_reachable was never resolved', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(makeAuditData({ product_domain_reachable: undefined }));
    expect(result.status).toBe('skipped');
  });

  it('passes when the product domain was reachable', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(
      makeAuditData({ product_domain: 'https://app.example.com', product_domain_reachable: true }),
    );
    expect(result.status).toBe('pass');
  });

  it('fails when the product domain was not reachable', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(
      makeAuditData({ product_domain: 'https://app.example.com', product_domain_reachable: false }),
    );
    expect(result.status).toBe('fail');
  });
});

describe('L0_RULES', () => {
  it('exports all 4 L0 rules', () => {
    expect(L0_RULES).toHaveLength(4);
    expect(L0_RULES.map((r) => r.id)).toEqual(['L0.1', 'L0.2', 'L0.3', 'L0.4']);
  });
});
