/**
 * L11 disclosure section (GA4 Admin / L11 / Junk Gate PRD §B.5, AC B.7.3/4/5/6):
 * omitted when L11 was skipped, renders Part A's GA4 findings, topology wording
 * for all four verdicts, and every copy variant clears outputLint.
 */
import { describe, it, expect } from 'vitest';
import { buildReconciliationDisclosure, buildContextNotes, partitionReconciliation, lintSafe, RECONCILIATION_NOTICE } from '../reconciliationDisclosure';
import { lintReportOutput, BANNED_TOKENS } from '../outputLint';
import { generateReport } from '../generator';
import { runRegister } from '@/services/validation/register/engine';
import { FINDING_META } from '@/services/reconciliation/codes/findingCodes';
import type { AuditData, ReconciliationSummary, ReconciliationSummaryFinding, ReportJSON, SiteSetupSummary, ValidationResult } from '@/types/audit';

const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const finding = (over: Partial<ReconciliationSummaryFinding> = {}): ReconciliationSummaryFinding => ({
  platform: 'ga4', dimension: 'volume', severity: 'warning', finding_code: 'GA4_VOLUME_DIVERGENCE', resolved_at: null,
  narrative: 'GA4 recorded 90 "lead" events vs 120 recorded by google_ads.', ...over,
});
const summary = (over: Partial<ReconciliationSummary> = {}): ReconciliationSummary => ({ run_id: 'r', run_completed_at: daysAgo(1), findings: [], ...over });

const audit = (s?: ReconciliationSummary, linked = true): AuditData => ({
  audit_id: 'a1', website_url: 'https://shop.example.com', funnel_type: 'ecommerce', region: 'us', rule_set_version: 'v2', site_type: 'ecommerce',
  declared_platforms: ['google_ads'], dataLayer: [], networkRequests: [], cookieSnapshots: [], localStorageSnapshots: [], injected: { gclid: '', fbclid: '' },
  client_linked: linked, reconciliation_summary: s,
});
const l11Results = (a: AuditData) => partitionReconciliation(runRegister(a)).reconciliation;

describe('partitionReconciliation', () => {
  it('splits layer reconciliation out; everything else is untouched and in order', () => {
    const mk = (rule_id: string, validation_layer: ValidationResult['validation_layer']): ValidationResult => ({ rule_id, validation_layer, status: 'pass', severity: 'low', technical_details: { found: '', expected: '', evidence: [] } });
    const { core, reconciliation } = partitionReconciliation([mk('A', 'consent'), mk('B', 'reconciliation'), mk('C', 'hygiene_integrity')]);
    expect(core.map((r) => r.rule_id)).toEqual(['A', 'C']);
    expect(reconciliation.map((r) => r.rule_id)).toEqual(['B']);
  });
});

describe('buildReconciliationDisclosure — omitted when L11 is skipped (AC B.7.3)', () => {
  it('bare-URL / public scan: undefined', () => {
    const a = audit(undefined, false);
    expect(buildReconciliationDisclosure(l11Results(a), a.reconciliation_summary, NOW)).toBeUndefined();
  });
  it('client with no completed run: undefined', () => {
    const a = audit(undefined, true);
    expect(buildReconciliationDisclosure(l11Results(a), a.reconciliation_summary, NOW)).toBeUndefined();
  });
  it('no summary at all: undefined even if results were passed', () => {
    expect(buildReconciliationDisclosure(l11Results(audit(summary())), undefined, NOW)).toBeUndefined();
  });
});

describe('buildReconciliationDisclosure — content (AC B.7.4)', () => {
  const ga4Findings = [
    finding({ dimension: 'alignment', finding_code: 'GA4_ADS_LINK_MISSING', severity: 'error',
      narrative: FINDING_META.GA4_ADS_LINK_MISSING.narrative({ ads_customer_id: '1234567890', property_id: '123', linked_customers: 'none' }) }),
    finding({ dimension: 'config', finding_code: 'GA4_ADS_CURRENCY_MISMATCH', severity: 'warning',
      narrative: FINDING_META.GA4_ADS_CURRENCY_MISMATCH.narrative({ property_id: '123', ga4_currency: 'GBP', ads_currency: 'USD' }) }),
  ];

  it('renders Part A GA4 findings inside the L11 items, flagged first, with the fixed notice', () => {
    const a = audit(summary({ findings: ga4Findings }));
    const d = buildReconciliationDisclosure(l11Results(a), a.reconciliation_summary, NOW)!;
    expect(d.notice).toBe(RECONCILIATION_NOTICE);
    expect(d.items).toHaveLength(5);
    expect(d.items[0].outcome).toBe('flagged');
    const text = JSON.stringify(d.items);
    expect(text).toContain('does not list a Google Ads link');
    expect(text).toContain('reports in GBP');
    expect(d.items.filter((i) => i.outcome === 'clear').map((i) => i.rule_id)).toContain('RECONCILIATION_DELIVERY_HEALTHY');
  });

  it('flags a stale run', () => {
    const a = audit(summary({ run_completed_at: daysAgo(12) }));
    const d = buildReconciliationDisclosure(l11Results(a), a.reconciliation_summary, NOW)!;
    expect(d.stale).toBe(true);
    expect(d.run_age_days).toBe(12);
    expect(d.items.find((i) => i.rule_id === 'RECONCILIATION_RUN_RECENT')?.outcome).toBe('flagged');
  });
});

describe('topology wording — candidate explanation, never the cause (AC B.7.5, scoping doc §7)', () => {
  const diff = finding({ platform: 'ga4', dimension: 'volume' });
  const withTopology = (verdict: ReconciliationSummary['google_tag_topology'] extends infer T ? NonNullable<T>['verdict'] : never, strength: 'declared' | 'observed' | 'assumed' | 'none') =>
    buildContextNotes(summary({ findings: [diff], google_tag_topology: { verdict, strength } }));

  it('COMBINED: lists combination as a candidate explanation, not the cause', () => {
    const n = withTopology('COMBINED', 'observed').join(' ');
    expect(n).toContain('one candidate explanation');
    expect(n).toContain('has not been established as the cause');
    expect(n).not.toContain('needs confirmation');
    expect(n).not.toMatch(/\b(is|was) caused by\b|because of the shared/i);
  });
  it('COMBINED_ADS_PRIMARY: same, and names the Ads ID as primary', () => {
    const n = withTopology('COMBINED_ADS_PRIMARY', 'declared').join(' ');
    expect(n).toContain('Google Ads ID as its primary');
    expect(n).toContain('one candidate explanation');
  });
  it('an assumed or none strength carries "needs confirmation"', () => {
    expect(withTopology('COMBINED', 'assumed').join(' ')).toContain('needs confirmation');
    expect(withTopology('COMBINED_ADS_PRIMARY', 'none').join(' ')).toContain('needs confirmation');
  });
  it('SPLIT says nothing about combination', () => {
    expect(withTopology('SPLIT', 'observed')).toEqual([]);
  });
  it('UNKNOWN says nothing about combination', () => {
    expect(withTopology('UNKNOWN', 'none')).toEqual([]);
  });
  it('a combined tag is not mentioned when there is no GA4/Ads difference to explain', () => {
    expect(buildContextNotes(summary({ findings: [finding({ platform: 'meta', dimension: 'delivery' })], google_tag_topology: { verdict: 'COMBINED', strength: 'observed' } }))).toEqual([]);
    expect(buildContextNotes(summary({ findings: [], google_tag_topology: { verdict: 'COMBINED', strength: 'observed' } }))).toEqual([]);
  });
});

describe('tracking-change annotation', () => {
  it('annotates a known change on a platform with a volume/alignment difference as a change, not drift', () => {
    const n = buildContextNotes(summary({ findings: [finding()], tracking_changes: [{ platform: 'ga4', title: 'Google tag split', effective_date: '2026-10-01' }] }));
    expect(n).toHaveLength(1);
    expect(n[0]).toContain('took effect on 2026-10-01');
    expect(n[0]).toContain('may reflect the change rather than drift');
  });
  it('is not shown for a platform with no difference', () => {
    expect(buildContextNotes(summary({ findings: [finding({ platform: 'meta' })], tracking_changes: [{ platform: 'ga4', title: 't', effective_date: '2026-10-01' }] }))).toEqual([]);
  });
});

describe('outputLint (AC B.7.6)', () => {
  const siteSetup = { generated_at: '', datalayer_inventory: [], tags: [], gtm_container: { detected: false, container_ids: [], connected_container_id: null, ids_match: null }, possible_server_side_gtm: { detected: false, confidence: 'low', candidate_hosts: [], matched_heuristics: [], evidence_urls: [], caveat: '' } } as unknown as SiteSetupSummary;

  it('every Atlas-authored finding narrative stays clear of the banned vocabulary', () => {
    const ctx = new Proxy({} as Record<string, string>, { get: (_t, k) => `<${String(k)}>` });
    for (const [code, meta] of Object.entries(FINDING_META)) {
      const text = meta.narrative(ctx).toLowerCase();
      for (const token of BANNED_TOKENS) expect(text, `${code} contains "${token}"`).not.toContain(token.toLowerCase());
    }
  });

  it('a fully populated disclosure (every wording variant) passes lintReportOutput', () => {
    const s = summary({
      run_completed_at: daysAgo(12),
      findings: [
        finding({ dimension: 'alignment', platform: 'ga4' }), finding({ dimension: 'config', platform: 'google_ads' }),
        finding({ dimension: 'delivery', platform: 'meta' }), finding({ dimension: 'volume', platform: 'ga4' }),
      ],
      google_tag_topology: { verdict: 'COMBINED_ADS_PRIMARY', strength: 'assumed' },
      tracking_changes: [{ platform: 'ga4', title: 'GA4 property currency changed', effective_date: '2026-10-01' }],
    });
    const a = audit(s);
    const disclosure = buildReconciliationDisclosure(l11Results(a), s, NOW)!;
    const report = generateReport(a, { conversion_signal_health: null, attribution_risk_level: null, optimization_strength: null, data_consistency_score: null }, [], [], siteSetup, undefined, undefined, undefined, undefined, disclosure);
    expect(report.reconciliation_disclosure).toBeDefined();
    expect(lintReportOutput(report)).toEqual([]);
  });

  it('lintReportOutput does scan the disclosure (a banned word in a detail line is caught)', () => {
    const a = audit(summary());
    const disclosure = buildReconciliationDisclosure(l11Results(a), a.reconciliation_summary, NOW)!;
    disclosure.items[0].details.push('The tag is Missing');
    const report = { executive_summary: { business_summary: '' }, issues: [], journey_stages: [], platform_breakdown: [], technical_appendix: { validation_results: [] }, reconciliation_disclosure: disclosure } as unknown as ReportJSON;
    expect(lintReportOutput(report).map((v) => v.field).join(' ')).toContain('reconciliation_disclosure.items[0].details[');
  });

  it('a client-chosen name containing a banned word never reaches the report: the line is replaced, so the hard gate cannot fail the audit', () => {
    expect(lintSafe('Conversion action "Missing Leads" ... ')).not.toContain('Missing');
    const s = summary({ findings: [finding({ dimension: 'alignment', narrative: 'Conversion action "Broken checkout" is not primary.' })] });
    const a = audit(s);
    const d = buildReconciliationDisclosure(l11Results(a), s, NOW)!;
    const report = generateReport(a, { conversion_signal_health: null, attribution_risk_level: null, optimization_strength: null, data_consistency_score: null }, [], [], siteSetup, undefined, undefined, undefined, undefined, d);
    expect(lintReportOutput(report)).toEqual([]);
  });
});

describe('generateReport', () => {
  it('omits reconciliation_disclosure when none is passed (no empty heading)', () => {
    const a = audit(undefined, false);
    const report = generateReport(a, { conversion_signal_health: null, attribution_risk_level: null, optimization_strength: null, data_consistency_score: null }, [], [], {} as SiteSetupSummary);
    expect('reconciliation_disclosure' in report).toBe(false);
  });
});
