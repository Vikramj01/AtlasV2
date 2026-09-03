/**
 * Layer L3 — Storage Durability rule tests.
 *
 * Covers each of the 6 crawl-detectable rules' pass/fail/skipped branches.
 * L3.7-9 (second-pass detectable) are out of scope for this phase — not
 * tested here because they aren't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  CLICK_ID_WRITTEN_TO_DURABLE_STORAGE,
  STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW,
  GCL_AW_COOKIE_PRESENT,
  FBP_AND_FBC_COOKIES_PRESENT,
  COOKIE_SCOPED_TO_PARENT_DOMAIN,
  COOKIE_ATTRIBUTES_CORRECT,
  L3_RULES,
} from '../L3';
import type { AuditData, DetailedCookie } from '@/types/audit';

function makeCookie(overrides: Partial<DetailedCookie> = {}): DetailedCookie {
  return {
    name: '_gcl_aw',
    value: 'GCL.123.abc',
    domain: '.example.com',
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 90 * 86_400,
    secure: true,
    sameSite: 'Lax',
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

// ── L3.1 — Click ID written to durable storage ───────────────────────────────

describe('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE (L3.1)', () => {
  it('is skipped when no click ID was injected', () => {
    expect(CLICK_ID_WRITTEN_TO_DURABLE_STORAGE.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the click ID lands in a cookie', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc' }, cookies: { gclid: 'abc' } });
    expect(CLICK_ID_WRITTEN_TO_DURABLE_STORAGE.test(auditData).status).toBe('pass');
  });

  it('fails when the click ID is only in sessionStorage', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc' }, sessionStorage: { gclid: 'abc' } });
    expect(CLICK_ID_WRITTEN_TO_DURABLE_STORAGE.test(auditData).status).toBe('fail');
  });

  it('passes (not captured, not sessionOnly) when the click ID was not captured at all — that gap is L2\'s to report', () => {
    const auditData = makeAuditData({ urlParams: { gclid: 'abc' } });
    expect(CLICK_ID_WRITTEN_TO_DURABLE_STORAGE.test(auditData).status).toBe('pass');
  });
});

// ── L3.2 — Storage lifetime meets attribution window ─────────────────────────

describe('STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW (L3.2)', () => {
  it('is skipped when no relevant cookie is present', () => {
    expect(STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the Google cookie meets the 90-day window', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ name: '_gcl_aw', expires: Math.floor(Date.now() / 1000) + 91 * 86_400 })] });
    expect(STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test(auditData).status).toBe('pass');
  });

  it('fails when the Google cookie is shorter than 90 days', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ name: '_gcl_aw', expires: Math.floor(Date.now() / 1000) + 1 * 86_400 })] });
    expect(STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test(auditData).status).toBe('fail');
  });

  it('fails when the cookie is a session cookie (no max-age at all)', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ name: '_fbc', expires: -1 })] });
    expect(STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test(auditData).status).toBe('fail');
  });

  it('passes when the Meta cookie meets the shorter 7-day window', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ name: '_fbc', expires: Math.floor(Date.now() / 1000) + 8 * 86_400 })] });
    expect(STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test(auditData).status).toBe('pass');
  });
});

// ── L3.3 — _gcl_aw cookie present and populated ───────────────────────────────

describe('GCL_AW_COOKIE_PRESENT (L3.3)', () => {
  it('passes when _gcl_aw is present', () => {
    expect(GCL_AW_COOKIE_PRESENT.test(makeAuditData({ cookies: { _gcl_aw: 'GCL.1.2' } })).status).toBe('pass');
  });
  it('fails when _gcl_aw is absent', () => {
    expect(GCL_AW_COOKIE_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L3.4 — _fbp and _fbc cookies present ──────────────────────────────────────

describe('FBP_AND_FBC_COOKIES_PRESENT (L3.4)', () => {
  it('passes when both are present', () => {
    const auditData = makeAuditData({ cookies: { _fbp: 'fb.1.1.1', _fbc: 'fb.1.1.2' } });
    expect(FBP_AND_FBC_COOKIES_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when only _fbp is present', () => {
    const auditData = makeAuditData({ cookies: { _fbp: 'fb.1.1.1' } });
    expect(FBP_AND_FBC_COOKIES_PRESENT.test(auditData).status).toBe('fail');
  });

  it('fails when neither is present', () => {
    expect(FBP_AND_FBC_COOKIES_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L3.5 — Cookie scoped to parent domain ─────────────────────────────────────

describe('COOKIE_SCOPED_TO_PARENT_DOMAIN (L3.5)', () => {
  it('is skipped when no relevant cookie is present', () => {
    expect(COOKIE_SCOPED_TO_PARENT_DOMAIN.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the cookie is parent-domain scoped', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ domain: '.example.com' })] });
    expect(COOKIE_SCOPED_TO_PARENT_DOMAIN.test(auditData).status).toBe('pass');
  });

  it('fails when the cookie is host-only', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ domain: 'www.example.com' })] });
    expect(COOKIE_SCOPED_TO_PARENT_DOMAIN.test(auditData).status).toBe('fail');
  });
});

// ── L3.6 — Cookie attributes correct ──────────────────────────────────────────

describe('COOKIE_ATTRIBUTES_CORRECT (L3.6)', () => {
  it('is skipped when no relevant cookie is present', () => {
    expect(COOKIE_ATTRIBUTES_CORRECT.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes with SameSite=Lax', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ sameSite: 'Lax', secure: false })] });
    expect(COOKIE_ATTRIBUTES_CORRECT.test(auditData).status).toBe('pass');
  });

  it('passes with SameSite=None + Secure', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ sameSite: 'None', secure: true })] });
    expect(COOKIE_ATTRIBUTES_CORRECT.test(auditData).status).toBe('pass');
  });

  it('fails with SameSite=None and not Secure (browsers reject this outright)', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ sameSite: 'None', secure: false })] });
    expect(COOKIE_ATTRIBUTES_CORRECT.test(auditData).status).toBe('fail');
  });

  it('fails with SameSite=Strict (drops on cross-site return)', () => {
    const auditData = makeAuditData({ detailedCookies: [makeCookie({ sameSite: 'Strict', secure: true })] });
    expect(COOKIE_ATTRIBUTES_CORRECT.test(auditData).status).toBe('fail');
  });
});

describe('L3_RULES', () => {
  it('exports all 6 crawl-detectable L3 rules', () => {
    expect(L3_RULES).toHaveLength(6);
    expect(new Set(L3_RULES.map((r) => r.id)).size).toBe(6);
    expect(new Set(L3_RULES.map((r) => r.rule_id)).size).toBe(6);
  });

  it('excludes the 3 second-pass-detectable rules (L3.7-9)', () => {
    expect(L3_RULES.some((r) => ['L3.7', 'L3.8', 'L3.9'].includes(r.id))).toBe(false);
  });
});
