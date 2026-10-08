/**
 * L11 Reconciliation rules (GA4 Admin / L11 / Junk Gate PRD §B.4, AC B.7.3-4).
 * Disclosure-only: these tests also pin that the layer never scores and is
 * skipped — not failed — for any audit without client + reconciliation data.
 */
import { describe, it, expect } from 'vitest';
import {
  L11_RULES, RECONCILIATION_RUN_RECENT, RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT, RECONCILIATION_NO_ALIGNMENT_GAPS,
  RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT, RECONCILIATION_DELIVERY_HEALTHY, mapFindingSeverity, isVolumeAnnotated,
} from '../L11';
import { runRegister, REGISTER } from '../engine';
import { calculateV2Scores } from '../scoring';
import { REGISTER_VERSION, SCORED_V2_LAYERS } from '../layers';
import type { AuditData, ReconciliationSummary, ReconciliationSummaryFinding } from '@/types/audit';

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const finding = (over: Partial<ReconciliationSummaryFinding> = {}): ReconciliationSummaryFinding => ({
  platform: 'ga4', dimension: 'config', severity: 'error', finding_code: 'GA4_STREAM_ID_NOT_IN_PROPERTY',
  resolved_at: null, narrative: 'The GA4 measurement ID G-X is not a stream on the connected property.', ...over,
});

const summary = (over: Partial<ReconciliationSummary> = {}): ReconciliationSummary => ({
  run_id: 'run-1', run_completed_at: daysAgo(1), findings: [], ...over,
});

const audit = (over: Partial<AuditData> = {}): AuditData => ({
  audit_id: 'a1', website_url: 'https://shop.example.com', funnel_type: 'ecommerce', region: 'us',
  rule_set_version: 'v2', site_type: 'ecommerce', declared_platforms: ['google_ads'],
  dataLayer: [], networkRequests: [], cookieSnapshots: [], localStorageSnapshots: [], injected: { gclid: '', fbclid: '' },
  client_linked: true, reconciliation_summary: summary(), ...over,
});

describe('the register', () => {
  it('ships five L11 rules, all disclosure-only inputs (client_linked + reconciliation_data_available)', () => {
    expect(L11_RULES).toHaveLength(5);
    for (const r of L11_RULES) {
      expect(r.layer).toBe('reconciliation');
      expect(r.requires).toEqual(['client_linked', 'reconciliation_data_available']);
      expect(REGISTER).toContain(r);
    }
  });

  it('REGISTER_VERSION is bumped to 1.5.0', () => {
    expect(REGISTER_VERSION).toBe('1.5.0');
  });
});

describe('preconditions — skipped, never failed', () => {
  const l11 = (a: AuditData) => runRegister(a).filter((r) => r.validation_layer === 'reconciliation');

  it('a bare-URL / public scan (no client) skips every L11 rule', () => {
    const results = l11(audit({ client_linked: false, reconciliation_summary: undefined }));
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('a client-linked audit with no completed reconciliation run skips every L11 rule', () => {
    const results = l11(audit({ client_linked: true, reconciliation_summary: undefined }));
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
    expect(results[0].technical_details.evidence).toContain('No completed reconciliation run exists for the linked client');
  });

  it('a summary without client_linked is still skipped', () => {
    expect(l11(audit({ client_linked: false })).every((r) => r.status === 'skipped')).toBe(true);
  });

  it('with client + data the rules run and carry a verdict', () => {
    const results = l11(audit());
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    expect(results.every((r) => r.verdict === 'PASS')).toBe(true);
  });
});

describe('RECONCILIATION_RUN_RECENT', () => {
  it('passes for a run within 7 days', () => {
    expect(RECONCILIATION_RUN_RECENT.test(audit({ reconciliation_summary: summary({ run_completed_at: daysAgo(7) }) })).status).toBe('pass');
  });
  it('warns (stale is disclosed, not read as clean) for an older run', () => {
    const r = RECONCILIATION_RUN_RECENT.test(audit({ reconciliation_summary: summary({ run_completed_at: daysAgo(10) }) }));
    expect(r.status).toBe('warning');
    expect(r.technical_details.found).toContain('10 days ago');
  });
});

describe('RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT', () => {
  it('flags an unresolved config finding, with severity from the finding', () => {
    const r = RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT.test(audit({ reconciliation_summary: summary({ findings: [finding()] }) }));
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('high');
    expect(r.technical_details.evidence[0]).toContain('GA4 measurement ID G-X');
  });
  it('includes Part A\'s warning-level GA4 config codes (currency mismatch), not only error/critical', () => {
    const r = RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT.test(audit({ reconciliation_summary: summary({ findings: [finding({ finding_code: 'GA4_ADS_CURRENCY_MISMATCH', severity: 'warning' })] }) }));
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('medium');
  });
  it('takes the highest severity across findings', () => {
    const r = RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT.test(audit({ reconciliation_summary: summary({ findings: [finding({ severity: 'info' }), finding({ severity: 'critical' })] }) }));
    expect(r.severity).toBe('critical');
  });
  it('ignores resolved findings and other dimensions', () => {
    const r = RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT.test(audit({ reconciliation_summary: summary({ findings: [finding({ resolved_at: daysAgo(1) }), finding({ dimension: 'delivery' })] }) }));
    expect(r.status).toBe('pass');
  });
});

describe('RECONCILIATION_NO_ALIGNMENT_GAPS', () => {
  it('flags unresolved alignment findings incl. Part A\'s GA4 alignment codes', () => {
    const findings = ['GA4_ADS_LINK_MISSING', 'GA4_SIGNAL_NOT_KEY_EVENT', 'GA4_ENHANCED_FORM_DOUBLE_COUNT'].map((finding_code) => finding({ dimension: 'alignment', finding_code, severity: 'warning' }));
    const r = RECONCILIATION_NO_ALIGNMENT_GAPS.test(audit({ reconciliation_summary: summary({ findings }) }));
    expect(r.status).toBe('fail');
    expect(r.technical_details.evidence).toHaveLength(3);
  });
  it('passes with none', () => {
    expect(RECONCILIATION_NO_ALIGNMENT_GAPS.test(audit()).status).toBe('pass');
  });
});

describe('RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT', () => {
  const vol = finding({ dimension: 'volume', platform: 'ga4', severity: 'warning', finding_code: 'VOLUME_DELTA_EXCEEDED' });

  it('flags a volume finding with no known change on that platform', () => {
    expect(RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT.test(audit({ reconciliation_summary: summary({ findings: [vol] }) })).status).toBe('fail');
  });
  it('does not flag one annotated by a client-scoped tracking change near the run', () => {
    const s = summary({ findings: [vol], tracking_changes: [{ platform: 'ga4', title: 'GA4 property currency changed', effective_date: daysAgo(3).slice(0, 10) }] });
    const r = RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT.test(audit({ reconciliation_summary: s }));
    expect(r.status).toBe('pass');
    expect(r.technical_details.found).toContain('coincide with a known change');
  });
  it('does not flag one annotated by a platform discontinuity finding on the same platform', () => {
    const s = summary({ findings: [vol, finding({ dimension: 'discontinuity', platform: 'ga4', severity: 'info', finding_code: 'KNOWN_PLATFORM_DISCONTINUITY' })] });
    expect(RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT.test(audit({ reconciliation_summary: s })).status).toBe('pass');
  });
  it('a change on a DIFFERENT platform, or far from the run, does not annotate it', () => {
    expect(isVolumeAnnotated(vol, summary({ tracking_changes: [{ platform: 'meta', title: 't', effective_date: daysAgo(1).slice(0, 10) }] }))).toBe(false);
    expect(isVolumeAnnotated(vol, summary({ tracking_changes: [{ platform: 'ga4', title: 't', effective_date: daysAgo(60).slice(0, 10) }] }))).toBe(false);
  });
});

describe('RECONCILIATION_DELIVERY_HEALTHY', () => {
  it('flags unresolved delivery findings', () => {
    const s = summary({ findings: [finding({ dimension: 'delivery', platform: 'meta', severity: 'critical', finding_code: 'CONNECTION_EXPIRED' })] });
    const r = RECONCILIATION_DELIVERY_HEALTHY.test(audit({ reconciliation_summary: s }));
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('critical');
  });
  it('passes with none', () => {
    expect(RECONCILIATION_DELIVERY_HEALTHY.test(audit()).status).toBe('pass');
  });
});

describe('severity mapping', () => {
  it('maps finding severity to register severity', () => {
    expect([mapFindingSeverity('critical'), mapFindingSeverity('error'), mapFindingSeverity('warning'), mapFindingSeverity('info')]).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

describe('never scored (disclosure-only)', () => {
  it('L11 is outside the scored layers', () => {
    expect(SCORED_V2_LAYERS).not.toContain('reconciliation');
  });
  it('failing L11 results leave calculateV2Scores output identical, even if they reach it', () => {
    const l11Fails = runRegister(audit({ reconciliation_summary: summary({ findings: [finding(), finding({ dimension: 'delivery', severity: 'critical' })] }) }))
      .filter((r) => r.validation_layer === 'reconciliation' && r.status === 'fail');
    expect(l11Fails.length).toBeGreaterThan(0);
    const core = runRegister(audit({ client_linked: false, reconciliation_summary: undefined })).filter((r) => r.validation_layer !== 'reconciliation');
    expect(calculateV2Scores([...core, ...l11Fails])).toEqual(calculateV2Scores(core));
  });
});
