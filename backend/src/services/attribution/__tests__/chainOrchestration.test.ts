import { describe, expect, it } from 'vitest';
import { deriveAttributionChain, detectRealAdPlatforms } from '../chainOrchestration';
import type { AuditData } from '@/types/audit';

const GOOGLE_ADS_TAG_REQUEST = { url: 'https://www.googleadservices.com/pagead/conversion/123', method: 'GET', headers: {}, timestamp: 0, step: 'landing' };
const META_TAG_REQUEST = { url: 'https://www.facebook.com/tr?id=123', method: 'GET', headers: {}, timestamp: 0, step: 'landing' };

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'lead_gen',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'lead_gen',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: {},
    ...overrides,
  };
}

describe('detectRealAdPlatforms', () => {
  it('returns an empty array when no ad platform tag fired', () => {
    expect(detectRealAdPlatforms(makeAuditData())).toEqual([]);
  });

  it('detects google_ads from a real googleadservices.com request', () => {
    expect(detectRealAdPlatforms(makeAuditData({ networkRequests: [GOOGLE_ADS_TAG_REQUEST] }))).toEqual(['google_ads']);
  });

  it('detects multiple platforms independently', () => {
    const platforms = detectRealAdPlatforms(makeAuditData({ networkRequests: [GOOGLE_ADS_TAG_REQUEST, META_TAG_REQUEST] }));
    expect(platforms.sort()).toEqual(['google_ads', 'meta']);
  });

  it('excludes reddit/pinterest even if their tag fires — no click-id capture rule exists for them', () => {
    const redditRequest = { url: 'https://alb.reddit.com/rp.gif', method: 'GET', headers: {}, timestamp: 0, step: 'landing' };
    expect(detectRealAdPlatforms(makeAuditData({ networkRequests: [redditRequest] }))).toEqual([]);
  });
});

describe('deriveAttributionChain — no_paid_traffic', () => {
  it('returns no_paid_traffic when no ad platform tag fired at all, regardless of form state', () => {
    const auditData = makeAuditData({
      attribution_form_carriage: { verdict: 'PASS', evidence: 'irrelevant — should never be read' },
    });
    const result = deriveAttributionChain(auditData);
    expect(result.not_observed_reason).toBe('no_paid_traffic');
    expect(result.break_at).toBeNull();
    expect(result.links.arrival).toBe('NOT_OBSERVED');
    expect(result.links.persistence).toBe('NOT_OBSERVED');
    expect(result.links.form_carriage).toBe('NOT_OBSERVED');
  });

  it('takes priority over a form that could not be reached (both conditions true at once)', () => {
    const auditData = makeAuditData({
      attribution_form_carriage: { verdict: 'NOT_OBSERVED', evidence: 'no submit control found' },
    });
    expect(deriveAttributionChain(auditData).not_observed_reason).toBe('no_paid_traffic');
  });
});

describe('deriveAttributionChain — no_conversion_surface', () => {
  it('returns no_conversion_surface when an ad platform is detected but the form was never reachable', () => {
    const auditData = makeAuditData({
      networkRequests: [GOOGLE_ADS_TAG_REQUEST],
      attribution_form_carriage: { verdict: 'NOT_OBSERVED', evidence: 'The form submit control could not be reached.' },
    });
    const result = deriveAttributionChain(auditData);
    expect(result.not_observed_reason).toBe('no_conversion_surface');
    expect(result.break_at).toBeNull();
  });

  it('also applies when attribution_form_carriage was never resolved at all', () => {
    const auditData = makeAuditData({ networkRequests: [GOOGLE_ADS_TAG_REQUEST] });
    expect(deriveAttributionChain(auditData).not_observed_reason).toBe('no_conversion_surface');
  });
});

describe('deriveAttributionChain — real link derivation', () => {
  function readyAuditData(overrides: Partial<AuditData> = {}): AuditData {
    return makeAuditData({
      networkRequests: [GOOGLE_ADS_TAG_REQUEST],
      attribution_form_carriage: { verdict: 'PASS', evidence: 'The submitted form request to forms.hubspot.com carried the injected gclid value in its body.' },
      landing_final_url: 'https://example.com/?gclid=test_gclid_1700000000000',
      urlParams: { gclid: 'test_gclid_1700000000000' },
      injected: { gclid: 'test_gclid_1700000000000' },
      ...overrides,
    });
  }

  it('a fully healthy chain returns break_at: null with scope pre_connection', () => {
    const auditData = readyAuditData({ storage: { gclid: 'test_gclid_1700000000000' } });
    const result = deriveAttributionChain(auditData);
    expect(result.not_observed_reason).toBeNull();
    expect(result.break_at).toBeNull();
    expect(result.links).toEqual({ arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' });
    expect(result.scope).toBe('pre_connection');
  });

  it('breaks at arrival when a redirect strips the injected param', () => {
    const auditData = readyAuditData({
      landing_final_url: 'https://example.com/landing', // gclid stripped
      storage: { gclid: 'test_gclid_1700000000000' },
    });
    const result = deriveAttributionChain(auditData);
    expect(result.break_at).toBe('arrival');
    expect(result.links.persistence).toBe('NOT_OBSERVED');
    expect(result.links.form_carriage).toBe('NOT_OBSERVED');
  });

  it('breaks at persistence when the detected platform\'s click id never made it into storage/cookie/dataLayer', () => {
    const auditData = readyAuditData({ storage: {}, cookies: {} });
    const result = deriveAttributionChain(auditData);
    expect(result.break_at).toBe('persistence');
    expect(result.links.form_carriage).toBe('NOT_OBSERVED');
  });

  it('breaks at form_carriage when persistence is fine but the form never carries the value', () => {
    const auditData = readyAuditData({
      storage: { gclid: 'test_gclid_1700000000000' },
      attribution_form_carriage: { verdict: 'FAIL', evidence: 'The form submission fired 1 request(s) to www.example.com, but none carried the click id captured at arrival.' },
    });
    const result = deriveAttributionChain(auditData);
    expect(result.break_at).toBe('form_carriage');
    expect(result.remedy_tier).toBe(3);
  });

  it('a single failing detected platform breaks persistence even when another detected platform is healthy', () => {
    const auditData = readyAuditData({
      networkRequests: [GOOGLE_ADS_TAG_REQUEST, META_TAG_REQUEST],
      injected: { gclid: 'test_gclid_1700000000000', fbclid: 'test_fbclid_1700000000000' },
      urlParams: { gclid: 'test_gclid_1700000000000', fbclid: 'test_fbclid_1700000000000' },
      landing_final_url: 'https://example.com/?gclid=test_gclid_1700000000000&fbclid=test_fbclid_1700000000000',
      storage: { gclid: 'test_gclid_1700000000000' }, // fbclid never captured
    });
    const result = deriveAttributionChain(auditData);
    expect(result.break_at).toBe('persistence');
    expect(result.break_evidence).toMatch(/meta/);
  });
});
