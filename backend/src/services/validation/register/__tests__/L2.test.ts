/**
 * Layer L2 — Click ID Capture rule tests.
 *
 * Covers each of the 11 crawl-detectable rules' pass/fail/skipped/warning
 * branches. L2.12 (consent-gated capture) is second-pass-detectable and
 * out of scope for this phase — not tested here because it isn't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
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
  L2_RULES,
} from '../L2';
import type { AuditData } from '@/types/audit';

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta', 'tiktok', 'linkedin', 'microsoft'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L2.1-2.7 — Per-platform click ID capture (share one code path, so test
// the shared behavior once via gclid and spot-check the rest) ───────────────

describe('GCLID_CAPTURED_AT_LANDING (L2.1)', () => {
  it('is skipped when gclid was never injected into the landing URL', () => {
    expect(GCLID_CAPTURED_AT_LANDING.test(makeAuditData()).status).toBe('skipped');
  });

  it('fails when gclid is in the URL but never captured', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc123' } });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('fail');
  });

  it('passes when gclid is captured into localStorage', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc123' }, storage: { gclid: 'abc123' } });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });

  it('passes when gclid is captured into a cookie', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc123' }, cookies: { gclid: 'abc123' } });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });

  it('passes when gclid is echoed into a dataLayer event', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123' },
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing', gclid: 'abc123' }],
    });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

// ── Three-tier capture matching (Site Evaluation Coverage & Honesty PRD §8.4) ──
// Exercised via gclid — the matching logic (checkParamCapture) is shared by
// every rule in this layer, so this doesn't need repeating per-platform.

describe('checkParamCapture — three-tier matching (via GCLID_CAPTURED_AT_LANDING)', () => {
  it('tier 1 (exact key, exact value): passes — unchanged baseline behavior', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc123' }, storage: { gclid: 'abc123' } });
    const result = GCLID_CAPTURED_AT_LANDING.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.found).not.toContain('different key');
  });

  it('tier 2: passes when the value is stored under a differently-named localStorage key (e.g. "_atlas_gclid")', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'test_gclid_123' }, storage: { _atlas_gclid: 'test_gclid_123' } });
    const result = GCLID_CAPTURED_AT_LANDING.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.found).toContain('_atlas_gclid');
    expect(result.technical_details.evidence.some((e) => e.includes('_atlas_gclid'))).toBe(true);
  });

  it('tier 2: passes when the value is stored under a differently-named cookie', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'test_gclid_123' }, cookies: { gads_click_id: 'test_gclid_123' } });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });

  it('tier 2: passes when the value is echoed into a dataLayer event under a different key', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'test_gclid_123' },
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing', click_id: 'test_gclid_123' }],
    });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });

  it('tier 2: passes when the value is nested one level inside a JSON-encoded string value', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'test_gclid_123' },
      storage: { atlas_ids: JSON.stringify({ gclid: 'test_gclid_123', fbclid: 'test_fbclid_456' }) },
    });
    const result = GCLID_CAPTURED_AT_LANDING.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.found).toContain('atlas_ids.gclid');
  });

  it('tier 3: fails when the value is genuinely absent everywhere', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'test_gclid_123' },
      storage: { some_other_key: 'unrelated_value' },
    });
    expect(GCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('fail');
  });

  it('negative case: tier 2 cannot false-positive — two different synthetic values present, the matcher does not cross-match them', () => {
    // fbclid's real value lives under its own key; searching for gclid's
    // value must not find it just because *some* capture happened.
    const auditData = makeAuditData({
      urlParams: { gclid: 'test_gclid_AAA', fbclid: 'test_fbclid_BBB' },
      storage: { fbclid: 'test_fbclid_BBB' }, // only fbclid was actually captured
    });
    const gclidResult = GCLID_CAPTURED_AT_LANDING.test(auditData);
    expect(gclidResult.status).toBe('fail'); // gclid's own value was never captured anywhere
    const fbclidResult = FBCLID_CAPTURED_AT_LANDING.test(auditData);
    expect(fbclidResult.status).toBe('pass'); // fbclid's own value was
  });
});

describe('GBRAID_CAPTURED_AT_LANDING (L2.2)', () => {
  it('fails when gbraid is present but not captured', () => {
    expect(GBRAID_CAPTURED_AT_LANDING.test(makeAuditData({ urlParams: { gbraid: 'g1' } })).status).toBe('fail');
  });
  it('passes when captured', () => {
    const auditData = makeAuditData({ urlParams: { gbraid: 'g1' }, storage: { gbraid: 'g1' } });
    expect(GBRAID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

describe('WBRAID_CAPTURED_AT_LANDING (L2.3)', () => {
  it('passes when captured', () => {
    const auditData = makeAuditData({ urlParams: { wbraid: 'w1' }, storage: { wbraid: 'w1' } });
    expect(WBRAID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

describe('FBCLID_CAPTURED_AT_LANDING (L2.4)', () => {
  it('passes when captured into a cookie', () => {
    const auditData = makeAuditData({ urlParams: { fbclid: 'f1' }, cookies: { fbclid: 'f1' } });
    expect(FBCLID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

describe('TTCLID_CAPTURED_AT_LANDING (L2.5)', () => {
  it('fails when not captured', () => {
    expect(TTCLID_CAPTURED_AT_LANDING.test(makeAuditData({ urlParams: { ttclid: 't1' } })).status).toBe('fail');
  });
});

describe('LI_FAT_ID_CAPTURED_AT_LANDING (L2.6)', () => {
  it('passes when captured', () => {
    const auditData = makeAuditData({ urlParams: { li_fat_id: 'l1' }, storage: { li_fat_id: 'l1' } });
    expect(LI_FAT_ID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

describe('MSCLKID_CAPTURED_AT_LANDING (L2.7)', () => {
  it('passes when captured', () => {
    const auditData = makeAuditData({ urlParams: { msclkid: 'm1' }, storage: { msclkid: 'm1' } });
    expect(MSCLKID_CAPTURED_AT_LANDING.test(auditData).status).toBe('pass');
  });
});

// ── L2.8 — UTM parameters captured ────────────────────────────────────────────

describe('UTM_PARAMETERS_CAPTURED (L2.8)', () => {
  it('is skipped when no UTM params were injected', () => {
    expect(UTM_PARAMETERS_CAPTURED.test(makeAuditData()).status).toBe('skipped');
  });

  it('fails when a required UTM param (source/medium/campaign) is not captured', () => {
    const auditData = makeAuditData({
      urlParams: { utm_source: 's', utm_medium: 'm', utm_campaign: 'c' },
      storage: { utm_source: 's', utm_medium: 'm' },
    });
    expect(UTM_PARAMETERS_CAPTURED.test(auditData).status).toBe('fail');
  });

  it('warns when only an optional UTM param (content/term) is missing', () => {
    const auditData = makeAuditData({
      urlParams: { utm_source: 's', utm_medium: 'm', utm_campaign: 'c', utm_content: 'ct', utm_term: 'tm' },
      storage: { utm_source: 's', utm_medium: 'm', utm_campaign: 'c' },
    });
    expect(UTM_PARAMETERS_CAPTURED.test(auditData).status).toBe('warning');
  });

  it('passes when all 5 UTM params are captured', () => {
    const params = { utm_source: 's', utm_medium: 'm', utm_campaign: 'c', utm_content: 'ct', utm_term: 'tm' };
    const auditData = makeAuditData({ urlParams: params, storage: params });
    expect(UTM_PARAMETERS_CAPTURED.test(auditData).status).toBe('pass');
  });
});

// ── L2.9 — Landing redirect preserves query string ────────────────────────────

describe('LANDING_REDIRECT_PRESERVES_QUERY_STRING (L2.9)', () => {
  it('is skipped when no final landing URL was captured', () => {
    expect(LANDING_REDIRECT_PRESERVES_QUERY_STRING.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when every injected param survives to the final URL', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123' },
      landing_final_url: 'https://example.com/?gclid=abc123',
    });
    expect(LANDING_REDIRECT_PRESERVES_QUERY_STRING.test(auditData).status).toBe('pass');
  });

  it('fails when a redirect strips an injected param', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123', utm_source: 'atlas_audit' },
      landing_final_url: 'https://example.com/',
    });
    expect(LANDING_REDIRECT_PRESERVES_QUERY_STRING.test(auditData).status).toBe('fail');
  });
});

// ── L2.10 — Capture occurs before redirect completes ──────────────────────────

describe('CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES (L2.10)', () => {
  it('is skipped when no final landing URL was captured', () => {
    expect(CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when nothing was stripped by the redirect', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123' },
      landing_final_url: 'https://example.com/?gclid=abc123',
    });
    expect(CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES.test(auditData).status).toBe('skipped');
  });

  it('passes when a stripped param was still captured elsewhere', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123' },
      landing_final_url: 'https://example.com/',
      storage: { gclid: 'abc123' },
    });
    expect(CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES.test(auditData).status).toBe('pass');
  });

  it('fails when a stripped param was never captured anywhere', () => {
    const auditData = makeAuditData({
      urlParams: { gclid: 'abc123' },
      landing_final_url: 'https://example.com/',
    });
    expect(CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES.test(auditData).status).toBe('fail');
  });
});

// ── L2.11 — Referrer preserved through entry ─────────────────────────────────

describe('REFERRER_PRESERVED_THROUGH_ENTRY (L2.11)', () => {
  it('is skipped when referrer capture was not attempted', () => {
    expect(REFERRER_PRESERVED_THROUGH_ENTRY.test(makeAuditData()).status).toBe('skipped');
  });

  it('fails when document.referrer came back empty', () => {
    expect(REFERRER_PRESERVED_THROUGH_ENTRY.test(makeAuditData({ landing_referrer_captured: '' })).status).toBe('fail');
  });

  it('passes when document.referrer survived', () => {
    const auditData = makeAuditData({ landing_referrer_captured: 'https://www.google.com/' });
    expect(REFERRER_PRESERVED_THROUGH_ENTRY.test(auditData).status).toBe('pass');
  });
});

describe('L2_RULES', () => {
  it('exports all 11 crawl-detectable L2 rules', () => {
    expect(L2_RULES).toHaveLength(11);
    expect(new Set(L2_RULES.map((r) => r.id)).size).toBe(11);
    expect(new Set(L2_RULES.map((r) => r.rule_id)).size).toBe(11);
  });

  it('excludes L2.12 (second-pass detectable, deferred)', () => {
    expect(L2_RULES.some((r) => r.id === 'L2.12')).toBe(false);
  });
});
