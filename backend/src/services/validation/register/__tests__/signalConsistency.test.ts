/**
 * Cross-signal consistency checker tests (Pre-Connection Scan Confidence
 * Tiering PRD §6). CONF_05's cases are ported directly from the retired
 * contradictionGuard.test.ts (absorbed here — see signalConsistency.ts's
 * header for the absorption decision).
 */
import { describe, it, expect } from 'vitest';
import { detectSignalConflicts, partitionSignalConflicts } from '../signalConsistency';
import type { AuditData, DataLayerEvent, DetectedTagSignal, RuleStatus, SiteSetupSummary, ValidationResult } from '@/types/audit';

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: [],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

function makeGtagEvent(verb: string, target: string): DataLayerEvent {
  // gtag.js's own `dataLayer.push(arguments)` shape — no `event` key, args
  // captured positionally as '0'/'1' (see siteSetupDetector.ts's
  // displayNameForUnnamedEvent, which reads the identical shape).
  return { event: '', timestamp: Date.now(), step: 'landing', '0': verb, '1': target } as unknown as DataLayerEvent;
}

function makeTag(overrides: Partial<DetectedTagSignal> = {}): DetectedTagSignal {
  return { platform: 'ga4', detected: false, ids: [], hit_count: 0, evidence_urls: [], ...overrides };
}

function makeSiteSetup(tags: DetectedTagSignal[] = []): SiteSetupSummary {
  return {
    generated_at: new Date().toISOString(),
    datalayer_inventory: [],
    tags,
    gtm_container: { detected: false, container_ids: [], connected_container_id: null, ids_match: null },
    possible_server_side_gtm: { detected: false, confidence: 'low', candidate_hosts: [], matched_heuristics: [], evidence_urls: [], caveat: '' },
  };
}

function makeResult(rule_id: string, status: RuleStatus, evidence: string[] = []): ValidationResult {
  return {
    rule_id,
    validation_layer: 'foundation_tags',
    status,
    severity: 'critical',
    technical_details: { found: 'irrelevant for this test', expected: 'irrelevant for this test', evidence },
  };
}

describe('CONF_01 — GA4 config(G-*) in dataLayer vs a NET absence verdict', () => {
  it('fires when GA4_CONFIG_TAG_PRESENT fails while a config(G-*) call is in dataLayer', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'G-QYRJB9TLG7')] });
    const results = [makeResult('GA4_CONFIG_TAG_PRESENT', 'fail')];
    const conflicts = detectSignalConflicts(auditData, makeSiteSetup(), results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assertion_id).toBe('CONF_01');
    expect(conflicts[0].affected_rule_ids).toEqual(['GA4_CONFIG_TAG_PRESENT']);
    expect(conflicts[0].reading_a).toContain('G-QYRJB9TLG7');
  });

  it('does not fire when GA4_CONFIG_TAG_PRESENT passes', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'G-QYRJB9TLG7')] });
    const results = [makeResult('GA4_CONFIG_TAG_PRESENT', 'pass')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toEqual([]);
  });

  it('does not fire when no config(G-*) call is in dataLayer', () => {
    const auditData = makeAuditData({ dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }] });
    const results = [makeResult('GA4_CONFIG_TAG_PRESENT', 'fail')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toEqual([]);
  });

  it('does not fire on a config(AW-*) call — a different assertion (CONF_04)', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'AW-123456789')] });
    const results = [makeResult('GA4_CONFIG_TAG_PRESENT', 'fail')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toEqual([]);
  });
});

describe('CONF_02 — any gtag call in dataLayer vs a gtag-loader absence verdict', () => {
  it('fires on a set(developer_id.*) call while GTAG_LOADER_PRESENT fails', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('set', 'developer_id.abc123')] });
    const results = [makeResult('GTAG_LOADER_PRESENT', 'fail')];
    const conflicts = detectSignalConflicts(auditData, makeSiteSetup(), results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assertion_id).toBe('CONF_02');
  });

  it('fires on any other gtag call (e.g. config) while GTAG_LOADER_PRESENT fails', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'G-XXXX')] });
    const results = [makeResult('GTAG_LOADER_PRESENT', 'fail')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toHaveLength(1);
  });

  it('does not fire on an ordinary named GTM dataLayer push (not gtag.js\'s own shape)', () => {
    const auditData = makeAuditData({ dataLayer: [{ event: 'add_to_cart', timestamp: Date.now(), step: 'landing' }] });
    const results = [makeResult('GTAG_LOADER_PRESENT', 'fail')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toEqual([]);
  });
});

describe('CONF_04 — config(AW-*) in dataLayer vs a Google Ads AW- ID absence verdict', () => {
  it('fires when GOOGLE_ADS_AW_ID_PRESENT fails while a config(AW-*) call is in dataLayer', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'AW-123456789')] });
    const results = [makeResult('GOOGLE_ADS_AW_ID_PRESENT', 'fail')];
    const conflicts = detectSignalConflicts(auditData, makeSiteSetup(), results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assertion_id).toBe('CONF_04');
    expect(conflicts[0].reading_a).toContain('AW-123456789');
  });

  it('does not fire when GOOGLE_ADS_AW_ID_PRESENT passes', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'AW-123456789')] });
    const results = [makeResult('GOOGLE_ADS_AW_ID_PRESENT', 'pass')];
    expect(detectSignalConflicts(auditData, makeSiteSetup(), results)).toEqual([]);
  });
});

describe('CONF_03 — a platform named in a finding vs the tag inventory', () => {
  it('fires when the register detects Google Ads but the tag inventory does not (the OpenArt shape)', () => {
    // googleads.g.doubleclick.net is in platformDetection.ts's matcher but
    // NOT in trackingSignals.detectGoogleAds's narrower one — a genuine,
    // pre-existing divergence between the two independently-maintained lists.
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      networkRequests: [{ url: 'https://googleads.g.doubleclick.net/pagead/landing', method: 'GET', headers: {}, timestamp: Date.now(), step: 'landing' }],
    });
    const siteSetup = makeSiteSetup([makeTag({ platform: 'google_ads', detected: false })]);
    const results = [makeResult('DECLARED_PLATFORM_HAS_TAG', 'fail')];
    const conflicts = detectSignalConflicts(auditData, siteSetup, results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assertion_id).toBe('CONF_03');
    expect(conflicts[0].affected_rule_ids).toEqual(['DECLARED_PLATFORM_HAS_TAG']);
  });

  it('fires the Reddit-inventory-divergence shape via UNDECLARED_PLATFORM_TAG_DETECTED', () => {
    const auditData = makeAuditData({
      declared_platforms: [],
      networkRequests: [{ url: 'https://alb.reddit.com/rp.gif', method: 'GET', headers: {}, timestamp: Date.now(), step: 'landing' }],
    });
    // Reddit tag inventory entry present but reports not detected — a
    // real divergence against the register's own alb.reddit.com matcher.
    const siteSetup = makeSiteSetup([makeTag({ platform: 'reddit_pixel', detected: false })]);
    const results = [makeResult('UNDECLARED_PLATFORM_TAG_DETECTED', 'warning')];
    const conflicts = detectSignalConflicts(auditData, siteSetup, results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entity).toBe('Reddit');
    expect(conflicts[0].affected_rule_ids).toEqual(['UNDECLARED_PLATFORM_TAG_DETECTED']);
  });

  it('does not fire when the sources agree', () => {
    const auditData = makeAuditData({
      declared_platforms: ['meta'],
      networkRequests: [{ url: 'https://facebook.com/tr?id=123', method: 'GET', headers: {}, timestamp: Date.now(), step: 'landing' }],
    });
    const siteSetup = makeSiteSetup([makeTag({ platform: 'meta_pixel', detected: true })]);
    const results = [makeResult('DECLARED_PLATFORM_HAS_TAG', 'pass')];
    expect(detectSignalConflicts(auditData, siteSetup, results)).toEqual([]);
  });

  it('does not fire when the platform has no tag-inventory entry in this run', () => {
    const auditData = makeAuditData({ declared_platforms: ['google_ads'] });
    const siteSetup = makeSiteSetup([]); // no entries at all
    const results = [makeResult('DECLARED_PLATFORM_HAS_TAG', 'fail')];
    expect(detectSignalConflicts(auditData, siteSetup, results)).toEqual([]);
  });
});

describe('CONF_05 — a cookie implies platform X\'s tag ran (absorbed from contradictionGuard.ts)', () => {
  it('fires when GCLID_CAPTURED_AT_LANDING fails while GCL_AW_COOKIE_PRESENT passes', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    const conflicts = detectSignalConflicts(makeAuditData(), makeSiteSetup(), results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assertion_id).toBe('CONF_05');
    expect(conflicts[0].affected_rule_ids).toEqual(['GCLID_CAPTURED_AT_LANDING']);
  });

  it('fires for GBRAID/WBRAID_CAPTURED_AT_LANDING too — same Google family', () => {
    const results = [
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GCL_AW_COOKIE_PRESENT', 'pass'),
    ];
    const conflicts = detectSignalConflicts(makeAuditData(), makeSiteSetup(), results);
    expect(new Set(conflicts.flatMap((c) => c.affected_rule_ids))).toEqual(
      new Set(['GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING']),
    );
  });

  it('fires when FBCLID_CAPTURED_AT_LANDING fails while _fbc is specifically present, regardless of FBC_COOKIE_PRESENT\'s own status', () => {
    const results = [
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBC_COOKIE_PRESENT', 'skipped', ['_fbc present: true']),
    ];
    const conflicts = detectSignalConflicts(makeAuditData(), makeSiteSetup(), results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].affected_rule_ids).toEqual(['FBCLID_CAPTURED_AT_LANDING']);
  });

  it('does not fire on fbclid when FBC_COOKIE_PRESENT reports _fbc absent', () => {
    const results = [
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBC_COOKIE_PRESENT', 'skipped', ['_fbc present: false']),
    ];
    expect(detectSignalConflicts(makeAuditData(), makeSiteSetup(), results)).toEqual([]);
  });

  it('does not fire when the sibling rule also failed, or is absent from the run', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'fail')];
    expect(detectSignalConflicts(makeAuditData(), makeSiteSetup(), results)).toEqual([]);
    expect(detectSignalConflicts(makeAuditData(), makeSiteSetup(), [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail')])).toEqual([]);
  });

  it('does not fire on a consistent, correctly-instrumented run', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    expect(detectSignalConflicts(makeAuditData(), makeSiteSetup(), results)).toEqual([]);
  });
});

describe('partitionSignalConflicts', () => {
  it('routes a fired conflict to could_not_be_assessed with kind CONFLICT, never annotating in place', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    const { assessable, unassessable, conflicts } = partitionSignalConflicts(results, makeAuditData(), makeSiteSetup());

    expect(assessable.map((r) => r.rule_id)).toEqual(['GCL_AW_COOKIE_PRESENT']);
    expect(unassessable).toHaveLength(1);
    expect(unassessable[0].rule_id).toBe('GCLID_CAPTURED_AT_LANDING');
    expect(unassessable[0].kind).toBe('CONFLICT');
    expect(unassessable[0].reason).toContain('Signals disagree');
    expect(conflicts).toHaveLength(1);

    // Never mutated or annotated in place — the whole result moves out.
    expect(results[0].technical_details.evidence).toHaveLength(0);
  });

  it('returns every result assessable, an empty unassessable list, and no conflicts when nothing disagrees', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass')];
    const { assessable, unassessable, conflicts } = partitionSignalConflicts(results, makeAuditData(), makeSiteSetup());
    expect(assessable).toBe(results);
    expect(unassessable).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  it('routes only the specific affected rule(s), leaving unrelated results assessable', () => {
    const auditData = makeAuditData({ dataLayer: [makeGtagEvent('config', 'G-QYRJB9TLG7')] });
    const results = [
      makeResult('GA4_CONFIG_TAG_PRESENT', 'fail'),
      makeResult('META_PIXEL_PRESENT', 'pass'),
    ];
    const { assessable, unassessable } = partitionSignalConflicts(results, auditData, makeSiteSetup());
    expect(assessable.map((r) => r.rule_id)).toEqual(['META_PIXEL_PRESENT']);
    expect(unassessable.map((u) => u.rule_id)).toEqual(['GA4_CONFIG_TAG_PRESENT']);
  });
});
