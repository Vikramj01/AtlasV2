/**
 * GA4 Admin / L11 / Junk Gate PRD §A.4 (AC 2): fire and no-fire cases for each
 * of the seven findings, using snapshots shaped like Sprint 0's verified schema,
 * plus the wording rule (observed-not-caused; outputLint banned tokens).
 */
import { describe, it, expect } from 'vitest';
import { evaluateGa4ConfigRules, normaliseHost, type Ga4RuleInput } from '../ga4ConfigRules';
import { FINDING_META, type FindingCode } from '../../codes/findingCodes';
import { BANNED_TOKENS } from '@/services/reporting/outputLint';
import type { Ga4ConfigSnapshot } from '../../sync/ga4ConfigSync';

const snapshot = (over: Partial<Ga4ConfigSnapshot> = {}): Ga4ConfigSnapshot => ({
  property_id: '123',
  currency_code: 'GBP',
  time_zone: 'Europe/London',
  web_streams: [{
    stream_id: '9', measurement_id: 'G-ABC123', default_uri: 'https://www.shop.example.com',
    enhanced_measurement: { stream_enabled: true, form_interactions_enabled: false },
  }],
  ads_links: [{ customer_id: '1234567890', ads_personalization_enabled: true }],
  data_retention: null,
  ...over,
});

const input = (over: Partial<Ga4RuleInput> = {}): Ga4RuleInput => ({
  snapshot: snapshot(),
  containerMeasurementIds: ['G-ABC123'],
  clientHosts: ['shop.example.com'],
  adsCustomerIds: ['1234567890'],
  adsManagerIds: [],
  adsCustomer: { currency_code: 'GBP', time_zone: 'Europe/London' },
  leadSignalEvents: [],
  conversionEvents: ['generate_lead'],
  keyEventNames: ['generate_lead'],
  ...over,
});

const codes = (i: Ga4RuleInput) => evaluateGa4ConfigRules(i).map((f) => f.code);

describe('a clean configuration', () => {
  it('produces no findings', () => {
    expect(codes(input())).toEqual([]);
  });
});

describe('GA4_STREAM_ID_NOT_IN_PROPERTY', () => {
  it('fires per container ID that is not a stream on the property', () => {
    const f = evaluateGa4ConfigRules(input({ containerMeasurementIds: ['G-ABC123', 'G-OTHER9'] }));
    expect(f.map((x) => x.code)).toEqual(['GA4_STREAM_ID_NOT_IN_PROPERTY']);
    expect(f[0].context.measurement_id).toBe('G-OTHER9');
  });
  it('is case-insensitive on the ID', () => {
    expect(codes(input({ containerMeasurementIds: ['g-abc123'] }))).toEqual([]);
  });
  it('does not fire when no container is known', () => {
    expect(codes(input({ containerMeasurementIds: null }))).toEqual([]);
  });
});

describe('GA4_STREAM_DOMAIN_MISMATCH', () => {
  it('fires when no stream host lines up with any client host', () => {
    expect(codes(input({ clientHosts: ['unrelated.org'] }))).toEqual(['GA4_STREAM_DOMAIN_MISMATCH']);
  });
  it('does not fire when a stream matches the client primary domain (www ignored)', () => {
    expect(codes(input())).not.toContain('GA4_STREAM_DOMAIN_MISMATCH');
  });
  it('does not fire when a stream matches a secondary domain', () => {
    expect(codes(input({ clientHosts: ['unrelated.org', 'shop.example.com'] }))).not.toContain('GA4_STREAM_DOMAIN_MISMATCH');
  });
  it('does not fire without known client hosts or stream URLs', () => {
    expect(codes(input({ clientHosts: [] }))).toEqual([]);
    expect(codes(input({ snapshot: snapshot({ web_streams: [{ stream_id: '9', measurement_id: 'G-ABC123', default_uri: null, enhanced_measurement: null }] }) }))).toEqual([]);
  });
});

describe('GA4_ENHANCED_FORM_DOUBLE_COUNT', () => {
  const formsOn = snapshot({
    web_streams: [{ stream_id: '9', measurement_id: 'G-ABC123', default_uri: 'https://shop.example.com', enhanced_measurement: { stream_enabled: true, form_interactions_enabled: true } }],
  });
  it('fires when form interactions are on and a lead event is sent to GA4', () => {
    expect(codes(input({ snapshot: formsOn, leadSignalEvents: ['generate_lead'] }))).toEqual(['GA4_ENHANCED_FORM_DOUBLE_COUNT']);
  });
  it('does not fire when form interactions are off', () => {
    expect(codes(input({ leadSignalEvents: ['generate_lead'] }))).toEqual([]);
  });
  it('does not fire without a lead/form signal (purchase alone is not a form event)', () => {
    expect(codes(input({ snapshot: formsOn, leadSignalEvents: ['purchase'] }))).toEqual([]);
  });
  it('does not fire when enhanced measurement was not observed (v1alpha unavailable)', () => {
    const unobserved = snapshot({ web_streams: [{ stream_id: '9', measurement_id: 'G-ABC123', default_uri: 'https://shop.example.com', enhanced_measurement: null }] });
    expect(codes(input({ snapshot: unobserved, leadSignalEvents: ['generate_lead'] }))).toEqual([]);
  });
  it('does not fire when enhanced measurement is off for the stream even if forms are flagged', () => {
    const off = snapshot({ web_streams: [{ stream_id: '9', measurement_id: 'G-ABC123', default_uri: 'https://shop.example.com', enhanced_measurement: { stream_enabled: false, form_interactions_enabled: true } }] });
    expect(codes(input({ snapshot: off, leadSignalEvents: ['generate_lead'] }))).toEqual([]);
  });
});

describe('GA4_ADS_LINK_MISSING', () => {
  it('fires when the client has an Ads account and the property lists no link to it', () => {
    expect(codes(input({ snapshot: snapshot({ ads_links: [{ customer_id: '999', ads_personalization_enabled: false }] }) }))).toEqual(['GA4_ADS_LINK_MISSING']);
    expect(codes(input({ snapshot: snapshot({ ads_links: [] }) }))).toEqual(['GA4_ADS_LINK_MISSING']);
  });
  it('does not fire when the link matches the client customer ID', () => {
    expect(codes(input())).toEqual([]);
  });
  it('treats a link to the manager account as linked', () => {
    expect(codes(input({ snapshot: snapshot({ ads_links: [{ customer_id: '5550001111', ads_personalization_enabled: true }] }), adsManagerIds: ['5550001111'] }))).not.toContain('GA4_ADS_LINK_MISSING');
  });
  it('does not fire when the client has no Ads account, or links were not observed', () => {
    expect(codes(input({ adsCustomerIds: [], snapshot: snapshot({ ads_links: [] }) }))).toEqual([]);
    expect(codes(input({ snapshot: snapshot({ ads_links: null }) }))).toEqual([]);
  });
});

describe('GA4_ADS_CURRENCY_MISMATCH / GA4_ADS_TIMEZONE_MISMATCH', () => {
  it('currency fires when GA4 and the linked Ads account differ', () => {
    expect(codes(input({ adsCustomer: { currency_code: 'USD', time_zone: 'Europe/London' } }))).toEqual(['GA4_ADS_CURRENCY_MISMATCH']);
  });
  it('time zone fires (info) when they differ', () => {
    const f = evaluateGa4ConfigRules(input({ adsCustomer: { currency_code: 'GBP', time_zone: 'America/New_York' } }));
    expect(f.map((x) => x.code)).toEqual(['GA4_ADS_TIMEZONE_MISMATCH']);
    expect(FINDING_META.GA4_ADS_TIMEZONE_MISMATCH.severity).toBe('info');
  });
  it('neither fires on a match, case-insensitively', () => {
    expect(codes(input({ adsCustomer: { currency_code: 'gbp', time_zone: 'europe/london' } }))).toEqual([]);
  });
  it('neither fires when Ads settings are not observed or the property is not linked to the client', () => {
    expect(codes(input({ adsCustomer: null }))).toEqual([]);
    // Not linked: only the link finding fires, never a currency comparison against an unlinked account.
    expect(codes(input({ adsCustomer: { currency_code: 'USD', time_zone: 'UTC' }, snapshot: snapshot({ ads_links: [] }) }))).toEqual(['GA4_ADS_LINK_MISSING']);
  });
});

describe('GA4_SIGNAL_NOT_KEY_EVENT', () => {
  it('fires for a conversion event that is not a key event', () => {
    const f = evaluateGa4ConfigRules(input({ keyEventNames: ['purchase'] }));
    expect(f.map((x) => x.code)).toEqual(['GA4_SIGNAL_NOT_KEY_EVENT']);
    expect(f[0].context.event_name).toBe('generate_lead');
  });
  it('does not fire when it is a key event', () => {
    expect(codes(input())).toEqual([]);
  });
  it('does not fire before the key-event sync has run (keyEventNames null)', () => {
    expect(codes(input({ keyEventNames: null }))).toEqual([]);
  });
  it('de-duplicates repeated events', () => {
    expect(codes(input({ conversionEvents: ['generate_lead', 'generate_lead'], keyEventNames: [] }))).toEqual(['GA4_SIGNAL_NOT_KEY_EVENT']);
  });
});

describe('wording rule (PRD §A.4)', () => {
  const GA4_CODES: FindingCode[] = [
    'GA4_STREAM_ID_NOT_IN_PROPERTY', 'GA4_STREAM_DOMAIN_MISMATCH', 'GA4_ENHANCED_FORM_DOUBLE_COUNT',
    'GA4_ADS_LINK_MISSING', 'GA4_ADS_CURRENCY_MISMATCH', 'GA4_ADS_TIMEZONE_MISMATCH', 'GA4_SIGNAL_NOT_KEY_EVENT',
  ];
  const ctx = new Proxy({} as Record<string, string>, { get: (_t, k) => `<${String(k)}>` });

  it('every narrative and remediation avoids the outputLint banned tokens', () => {
    for (const code of GA4_CODES) {
      const text = `${FINDING_META[code].narrative(ctx)} ${FINDING_META[code].remediation(ctx)}`.toLowerCase();
      for (const token of BANNED_TOKENS) expect(text, `${code} contains "${token}"`).not.toContain(token.toLowerCase());
    }
  });

  it('the double-count finding says the configuration "can count" twice, never that it does', () => {
    const n = FINDING_META.GA4_ENHANCED_FORM_DOUBLE_COUNT.narrative(ctx);
    expect(n).toContain('can count the same form submission twice');
    expect(n).not.toMatch(/is double[- ]counting|are double[- ]counting/i);
  });

  it('severities and dimensions match the PRD table', () => {
    const expected: Record<string, [string, string]> = {
      GA4_STREAM_ID_NOT_IN_PROPERTY: ['config', 'error'],
      GA4_STREAM_DOMAIN_MISMATCH: ['config', 'warning'],
      GA4_ENHANCED_FORM_DOUBLE_COUNT: ['alignment', 'warning'],
      GA4_ADS_LINK_MISSING: ['alignment', 'error'],
      GA4_ADS_CURRENCY_MISMATCH: ['config', 'warning'],
      GA4_ADS_TIMEZONE_MISMATCH: ['config', 'info'],
      GA4_SIGNAL_NOT_KEY_EVENT: ['alignment', 'warning'],
    };
    for (const code of GA4_CODES) expect([FINDING_META[code].dimension, FINDING_META[code].severity]).toEqual(expected[code]);
  });
});

describe('normaliseHost', () => {
  it('strips scheme, www, port, path', () => {
    expect(normaliseHost('HTTPS://www.Shop.Example.com:8080/a?b#c')).toBe('shop.example.com');
  });
});
