/**
 * PDF Generator Tests
 * Validates that generatePDF produces a valid PDF buffer for various
 * ReportJSON inputs — from minimal to full 26-rule reports.
 */
import { describe, it, expect } from 'vitest';
import {
  generatePDF,
  computeRuleOverviewStats,
  formatWarningsLabel,
  computeIssueTotals,
  orderEvidenceByRelevance,
  selectDisplayedEvidence,
  smartTruncateEvidence,
  isPartialCoverage,
  EVIDENCE_CAP,
} from '../pdfGenerator';
import type { ReportJSON, ValidationResult, ReportIssue, UnassessableFinding } from '@/types/audit';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeValidationResult(
  rule_id: string,
  status: 'pass' | 'fail' | 'warning' = 'pass',
): ValidationResult {
  return {
    rule_id,
    validation_layer: 'parameter_completeness',
    status,
    severity: 'high',
    technical_details: { found: 'found', expected: 'expected', evidence: [] },
  };
}

function makeIssue(overrides?: Partial<ReportIssue>): ReportIssue {
  return {
    rule_id: 'GA4_PURCHASE_EVENT_FIRED',
    severity: 'critical',
    problem: 'GA4 purchase event is not firing on the confirmation page.',
    fix_summary: 'Add a push to dataLayer with event: "purchase" on order confirmation.',
    recommended_owner: 'Frontend Developer',
    estimated_effort: 'low',
    affected_platforms: ['ga4'],
    ...overrides,
  };
}

function makeMinimalReport(overrides?: Partial<ReportJSON>): ReportJSON {
  return {
    audit_id: 'test-audit-pdf-001',
    website_url: 'https://example.com',
    generated_at: new Date().toISOString(),
    executive_summary: {
      overall_status: 'healthy',
      business_summary: 'All conversion signals are firing correctly.',
      scores: {
        conversion_signal_health: 100,
        attribution_risk_level: 'Low',
        optimization_strength: 'Strong',
        data_consistency_score: 'High',
      },
    },
    journey_stages: [
      { stage: 'Landing', status: 'pass', issues: [] },
      { stage: 'Product', status: 'pass', issues: [] },
      { stage: 'Checkout', status: 'pass', issues: [] },
      { stage: 'Confirmation', status: 'pass', issues: [] },
      { stage: 'Platforms', status: 'pass', issues: [] },
    ],
    platform_breakdown: [
      { platform: 'ga4', status: 'healthy', risk_explanation: 'All GA4 checks passed.', failed_rules: [], failed_rule_details: [] },
      { platform: 'google_ads', status: 'healthy', risk_explanation: 'All Google Ads checks passed.', failed_rules: [], failed_rule_details: [] },
      { platform: 'meta_ads', status: 'healthy', risk_explanation: 'All Meta checks passed.', failed_rules: [], failed_rule_details: [] },
      { platform: 'gtm', status: 'healthy', risk_explanation: 'GTM loaded correctly.', failed_rules: [], failed_rule_details: [] },
      { platform: 'sgtm', status: 'healthy', risk_explanation: 'sGTM firing correctly.', failed_rules: [], failed_rule_details: [] },
    ],
    issues: [],
    technical_appendix: {
      validation_results: [],
      raw_network_requests: [],
      raw_datalayer_events: [],
    },
    ...overrides,
  };
}

// ── computeRuleOverviewStats ────────────────────────────────────────────────────
// Regression coverage for the "N rules validated" headline being sourced from
// the raw (skipped-inclusive) results array instead of the same active set the
// Technical Appendix table renders — e.g. a saas audit where 8 ecommerce-only
// rules never run (excluded, not 'skipped') and 17 tag_configuration/
// implementation_drift rules return 'skipped' (no GTM container connected):
// 35 results in the array, but only 18 are "validated" (5 passed + 13 failed),
// matching what the appendix actually lists.

describe('computeRuleOverviewStats', () => {
  it('excludes skipped results from the validated count', () => {
    const results: ValidationResult[] = [
      makeValidationResult('A', 'pass'),
      makeValidationResult('B', 'fail'),
      makeValidationResult('C', 'warning'),
      { ...makeValidationResult('D'), status: 'skipped' },
      { ...makeValidationResult('E'), status: 'skipped' },
    ];
    const stats = computeRuleOverviewStats(results);
    expect(stats.validated).toHaveLength(3);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.warnings).toBe(1);
  });

  it('validated count matches passed + failed + warnings, not the raw array length', () => {
    const results: ValidationResult[] = [
      ...Array.from({ length: 5 }, (_, i) => makeValidationResult(`P${i}`, 'pass')),
      ...Array.from({ length: 13 }, (_, i) => makeValidationResult(`F${i}`, 'fail')),
      ...Array.from({ length: 17 }, (_, i) => ({ ...makeValidationResult(`S${i}`), status: 'skipped' as const })),
    ];
    expect(results).toHaveLength(35);
    const stats = computeRuleOverviewStats(results);
    expect(stats.validated).toHaveLength(18);
    expect(stats.validated.length).toBe(stats.passed + stats.failed + stats.warnings);
  });

  it('returns an empty validated set when every result is skipped', () => {
    const results: ValidationResult[] = [
      { ...makeValidationResult('A'), status: 'skipped' },
    ];
    const stats = computeRuleOverviewStats(results);
    expect(stats.validated).toHaveLength(0);
    expect(stats.passed + stats.failed + stats.warnings).toBe(0);
  });
});

// ── formatWarningsLabel ──────────────────────────────────────────────────────
// Regression coverage for PRD Issue 6: the Rule Overview headline hardcoded
// "warnings" regardless of count, rendering "1 warnings" for a single warning.

describe('formatWarningsLabel', () => {
  it('uses the singular for exactly 1 warning', () => {
    expect(formatWarningsLabel(1)).toBe('1 warning');
  });

  it('uses the plural for 0 warnings', () => {
    expect(formatWarningsLabel(0)).toBe('0 warnings');
  });

  it('uses the plural for more than 1 warning', () => {
    expect(formatWarningsLabel(2)).toBe('2 warnings');
  });
});

// PDF magic bytes: %PDF-
const PDF_MAGIC = Buffer.from('%PDF-');

function isPdfBuffer(buf: Buffer): boolean {
  return buf.slice(0, 5).equals(PDF_MAGIC);
}

// ── Core contract ──────────────────────────────────────────────────────────────

describe('generatePDF — core contract', () => {
  it('returns a Buffer', async () => {
    const result = await generatePDF(makeMinimalReport());
    expect(result).toBeInstanceOf(Buffer);
  });

  it('returned buffer starts with PDF magic bytes (%PDF-)', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('buffer is larger than 5KB (not empty/trivial)', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(buf.byteLength).toBeGreaterThan(5_000);
  });

  it('resolves (does not reject) for a minimal report', async () => {
    await expect(generatePDF(makeMinimalReport())).resolves.toBeInstanceOf(Buffer);
  });
});

// ── Status variants ────────────────────────────────────────────────────────────

describe('generatePDF — overall status variants', () => {
  for (const status of ['healthy', 'partially_broken', 'critical'] as const) {
    it(`renders without error for overall_status="${status}"`, async () => {
      const report = makeMinimalReport({
        executive_summary: {
          overall_status: status,
          business_summary: `Summary for ${status}`,
          scores: {
            conversion_signal_health: status === 'healthy' ? 100 : status === 'partially_broken' ? 60 : 20,
            attribution_risk_level: status === 'healthy' ? 'Low' : status === 'partially_broken' ? 'Medium' : 'Critical',
            optimization_strength: status === 'healthy' ? 'Strong' : 'Weak',
            data_consistency_score: status === 'healthy' ? 'High' : 'Low',
          },
        },
      });
      const buf = await generatePDF(report);
      expect(isPdfBuffer(buf)).toBe(true);
    });
  }
});

// ── Score card variants ────────────────────────────────────────────────────────

describe('generatePDF — score card boundary values', () => {
  it('handles conversion_signal_health = 0 (all failing)', async () => {
    const report = makeMinimalReport();
    report.executive_summary.scores.conversion_signal_health = 0;
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('handles conversion_signal_health = 100 (all passing)', async () => {
    const report = makeMinimalReport();
    report.executive_summary.scores.conversion_signal_health = 100;
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders correctly for each attribution_risk_level value', async () => {
    for (const level of ['Low', 'Medium', 'High', 'Critical'] as const) {
      const report = makeMinimalReport();
      report.executive_summary.scores.attribution_risk_level = level;
      const buf = await generatePDF(report);
      expect(isPdfBuffer(buf)).toBe(true);
    }
  });
});

// ── Issues page ────────────────────────────────────────────────────────────────

describe('generatePDF — issues page', () => {
  it('renders with zero issues', async () => {
    const buf = await generatePDF(makeMinimalReport({ issues: [] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders with a single issue', async () => {
    const buf = await generatePDF(makeMinimalReport({ issues: [makeIssue()] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders with many issues (pagination stress test)', async () => {
    const issues: ReportIssue[] = Array.from({ length: 20 }, (_, i) =>
      makeIssue({
        rule_id: `RULE_${i}`,
        severity: i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low',
        estimated_effort: i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high',
      }),
    );
    const buf = await generatePDF(makeMinimalReport({ issues }));
    expect(isPdfBuffer(buf)).toBe(true);
    // With 20 issues the buffer will be larger than a no-issue report
    expect(buf.byteLength).toBeGreaterThan(12_000);
  });

  it('renders issues with all severity levels', async () => {
    const issues: ReportIssue[] = (['critical', 'high', 'medium', 'low'] as const).map(
      (severity) => makeIssue({ severity }),
    );
    const buf = await generatePDF(makeMinimalReport({ issues }));
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('truncates very long problem/fix text gracefully', async () => {
    const longText = 'A'.repeat(500);
    const issue = makeIssue({ problem: longText, fix_summary: longText });
    const buf = await generatePDF(makeMinimalReport({ issues: [issue] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Technical appendix (validation results table) ─────────────────────────────

describe('generatePDF — technical appendix', () => {
  it('renders with no validation results', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders all 26 rules in the appendix table', async () => {
    const ALL_RULES = [
      'GA4_PURCHASE_EVENT_FIRED', 'META_PIXEL_PURCHASE_EVENT_FIRED', 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
      'SGTM_SERVER_EVENT_FIRED', 'DATALAYER_POPULATED', 'GTM_CONTAINER_LOADED',
      'PAGE_VIEW_EVENT_FIRED', 'ADD_TO_CART_EVENT_FIRED', 'TRANSACTION_ID_PRESENT',
      'VALUE_PARAMETER_PRESENT', 'CURRENCY_PARAMETER_PRESENT', 'GCLID_CAPTURED_AT_LANDING',
      'FBCLID_CAPTURED_AT_LANDING', 'EVENT_ID_GENERATED', 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
      'PHONE_CAPTURED_FOR_CAPI', 'ITEMS_ARRAY_POPULATED', 'USER_ID_PRESENT',
      'COUPON_CAPTURED_IF_USED', 'SHIPPING_CAPTURED', 'GCLID_PERSISTS_TO_CONVERSION',
      'FBCLID_PERSISTS_TO_CONVERSION', 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
      'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER', 'USER_DATA_NORMALIZED_CONSISTENTLY', 'PII_PROPERLY_HASHED',
    ];
    const results = ALL_RULES.map((id, i) =>
      makeValidationResult(id, i % 3 === 0 ? 'fail' : i % 3 === 1 ? 'warning' : 'pass'),
    );
    const report = makeMinimalReport({
      technical_appendix: {
        validation_results: results,
        raw_network_requests: [],
        raw_datalayer_events: [],
      },
    });
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Journey stage variants ─────────────────────────────────────────────────────

describe('generatePDF — journey stage variants', () => {
  it('renders a stage with many issues without crashing', async () => {
    const stageWithIssues = {
      stage: 'Confirmation',
      status: 'fail' as const,
      issues: Array.from({ length: 10 }, (_, i) => `Issue ${i + 1}: something is broken here`),
    };
    const report = makeMinimalReport({
      journey_stages: [stageWithIssues],
    });
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders a stage with very long stage name gracefully', async () => {
    const report = makeMinimalReport({
      journey_stages: [
        { stage: 'A Very Long Stage Name That Should Be Truncated', status: 'pass', issues: [] },
      ],
    });
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Platform breakdown variants ────────────────────────────────────────────────

describe('generatePDF — platform breakdown variants', () => {
  it('renders a broken platform with more than 4 failed rules', async () => {
    const report = makeMinimalReport({
      platform_breakdown: [
        {
          platform: 'ga4',
          status: 'broken',
          risk_explanation: 'GA4 is completely broken.',
          failed_rules: [
            'GA4_PURCHASE_EVENT_FIRED', 'DATALAYER_POPULATED', 'GTM_CONTAINER_LOADED',
            'PAGE_VIEW_EVENT_FIRED', 'TRANSACTION_ID_PRESENT', 'ITEMS_ARRAY_POPULATED',
          ],
          failed_rule_details: [],
        },
      ],
    });
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('generatePDF — edge cases', () => {
  it('handles empty business summary', async () => {
    const report = makeMinimalReport();
    report.executive_summary.business_summary = '';
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('handles very long business summary (> 100 chars, triggers truncation in banner)', async () => {
    const report = makeMinimalReport();
    report.executive_summary.business_summary = 'B'.repeat(300);
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('handles empty journey stages list', async () => {
    const buf = await generatePDF(makeMinimalReport({ journey_stages: [] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('handles empty platform breakdown list', async () => {
    const buf = await generatePDF(makeMinimalReport({ platform_breakdown: [] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('produces different-sized buffers for reports with vs without issues', async () => {
    const noIssues = await generatePDF(makeMinimalReport({ issues: [] }));
    const withIssues = await generatePDF(
      makeMinimalReport({ issues: Array.from({ length: 5 }, () => makeIssue()) }),
    );
    expect(withIssues.byteLength).toBeGreaterThan(noIssues.byteLength);
  });
});

// ── Scan Coverage section (Site Evaluation Coverage & Honesty PRD §6.4) ─────

describe('generatePDF — scan coverage section', () => {
  it('renders without the section when coverage is absent (existing reports, Journey-Builder mode)', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders the section when coverage is present', async () => {
    const report = makeMinimalReport();
    report.executive_summary.coverage = {
      pages_requested: 4,
      pages_distinct: 1,
      steps: [
        { step: 'landing', requested_url: 'https://example.com', final_url: 'https://example.com', source: 'user_supplied', distinct_from_landing: false, navigation_success: true },
        { step: 'product', requested_url: 'https://example.com', source: 'fallback_landing', distinct_from_landing: false, navigation_success: true },
        { step: 'checkout', requested_url: 'https://example.com', source: 'fallback_landing', distinct_from_landing: false, navigation_success: true },
        { step: 'confirmation', requested_url: 'https://example.com/order-confirmed', source: 'user_supplied', distinct_from_landing: true, navigation_success: false, error: 'net::ERR_NAME_NOT_RESOLVED' },
      ],
      layers_not_tested: [
        { layer: 'event_firing', label: 'Event Firing', reason: 'The crawl never reached a page distinct from the landing page', state: 'not_scanned' },
        { layer: 'parameter_completeness', label: 'Parameter Completeness', reason: 'The crawl never reached a page distinct from the landing page', state: 'not_scanned' },
        { layer: 'cross_domain_continuity', label: 'Cross-Domain Continuity', reason: "Not applicable — nothing in this layer applies to this site's declared configuration", state: 'not_applicable' },
      ],
      rules_tested: 41,
      rules_not_tested: 42,
      partial: false,
      degraded_steps: [],
    };
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders correctly with full coverage and zero not-tested layers', async () => {
    const report = makeMinimalReport();
    report.executive_summary.coverage = {
      pages_requested: 4,
      pages_distinct: 4,
      steps: [
        { step: 'landing', requested_url: 'https://example.com', source: 'user_supplied', distinct_from_landing: false, navigation_success: true },
        { step: 'product', requested_url: 'https://example.com/product', source: 'nav_link', distinct_from_landing: true, navigation_success: true },
        { step: 'checkout', requested_url: 'https://example.com/checkout', source: 'sitemap', distinct_from_landing: true, navigation_success: true },
        { step: 'confirmation', requested_url: 'https://example.com/order-confirmed', source: 'user_supplied', distinct_from_landing: true, navigation_success: true },
      ],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: false,
      degraded_steps: [],
    };
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('produces a larger buffer with coverage present than without, for otherwise identical reports', async () => {
    const withoutCoverage = await generatePDF(makeMinimalReport());
    const withCoverage = await generatePDF(makeMinimalReport({
      executive_summary: {
        ...makeMinimalReport().executive_summary,
        coverage: {
          pages_requested: 4,
          pages_distinct: 1,
          steps: [
            { step: 'landing', requested_url: 'https://example.com', source: 'user_supplied', distinct_from_landing: false, navigation_success: true },
            { step: 'product', requested_url: 'https://example.com', source: 'fallback_landing', distinct_from_landing: false, navigation_success: true },
          ],
          layers_not_tested: [{ layer: 'event_firing', label: 'Event Firing', reason: 'x', state: 'not_scanned' }],
          rules_tested: 41,
          rules_not_tested: 42,
          partial: false,
          degraded_steps: [],
        },
      },
    }));
    expect(withCoverage.byteLength).toBeGreaterThan(withoutCoverage.byteLength);
  });

  // Platform Attribution & Determinism PRD B-W3 — surfaced the same way
  // layers_not_tested already is. PDFKit compresses content streams by
  // default, so this asserts via buffer size (same technique the "produces
  // a larger buffer" test above uses) rather than searching for literal
  // text in the raw bytes.
  it('renders a partial-run caveat when a step degraded, producing a larger buffer than an otherwise-identical settled run', async () => {
    const baseCoverage = {
      pages_requested: 2,
      pages_distinct: 2,
      steps: [
        { step: 'landing', requested_url: 'https://example.com', source: 'user_supplied' as const, distinct_from_landing: false, navigation_success: true, settle_outcome: 'settled' as const, degraded: false },
        {
          step: 'confirmation', requested_url: 'https://example.com/order-confirmed', source: 'user_supplied' as const,
          distinct_from_landing: true, navigation_success: true,
        },
      ],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
    };

    const settled = await generatePDF({
      ...makeMinimalReport(),
      executive_summary: {
        ...makeMinimalReport().executive_summary,
        coverage: { ...baseCoverage, partial: false, degraded_steps: [] },
      },
    });
    const partial = await generatePDF({
      ...makeMinimalReport(),
      executive_summary: {
        ...makeMinimalReport().executive_summary,
        coverage: {
          ...baseCoverage,
          steps: [baseCoverage.steps[0], { ...baseCoverage.steps[1], settle_outcome: 'quiet_period_cap_reached' as const, degraded: true }],
          partial: true,
          degraded_steps: ['confirmation'],
        },
      },
    });

    expect(isPdfBuffer(settled)).toBe(true);
    expect(isPdfBuffer(partial)).toBe(true);
    expect(partial.byteLength).toBeGreaterThan(settled.byteLength);
  });
});

// ── Evidence integrity (Signal Health Report: Evidence Integrity & ─────────────
// Presentation PRD §3.1/W1) — evidence is never silently truncated to 3
// items, and when evidence must be capped, the item the failure message
// names by key is never the one left out.

describe('orderEvidenceByRelevance', () => {
  it('puts the evidence item named in the failure message first, however deep it started', () => {
    const found = '4 cookie(s) shorter than their attribution window: ttclid (1d, needs 7d)';
    const evidence = [
      'gclid: 90d (needs 90d)',
      'gbraid: 90d (needs 90d)',
      'wbraid: 90d (needs 90d)',
      '_gcl_au: 90d (needs 90d)',
      '_gcl_aw: 90d (needs 90d)',
      'ttclid: 1d (needs 7d)', // 6th item, and the only violation named in `found`
    ];
    const ordered = orderEvidenceByRelevance(found, evidence);
    expect(ordered[0]).toBe('ttclid: 1d (needs 7d)');
    // nothing lost — just reordered
    expect(ordered).toHaveLength(evidence.length);
    expect(new Set(ordered)).toEqual(new Set(evidence));
  });

  it('is a no-op (stable original order) when the failure message names no specific evidence key', () => {
    const found = '0/5 UTM parameters captured';
    const evidence = [
      'utm_source: not injected',
      'utm_medium: not injected',
      'utm_campaign: not injected',
      'utm_content: not injected',
      'utm_term: not injected',
    ];
    expect(orderEvidenceByRelevance(found, evidence)).toEqual(evidence);
  });
});

describe('selectDisplayedEvidence', () => {
  it('renders all evidence when the count is at or under the cap', () => {
    const evidence = Array.from({ length: EVIDENCE_CAP }, (_, i) => `item-${i}: ok`);
    const { shown, hiddenCount } = selectDisplayedEvidence('', evidence);
    expect(shown).toHaveLength(EVIDENCE_CAP);
    expect(hiddenCount).toBe(0);
  });

  it('never silently drops items past the cap — reports exactly how many were hidden', () => {
    const evidence = Array.from({ length: 8 }, (_, i) => `item-${i}: ok`);
    const { shown, hiddenCount } = selectDisplayedEvidence('', evidence);
    expect(shown).toHaveLength(EVIDENCE_CAP);
    expect(hiddenCount).toBe(8 - EVIDENCE_CAP);
    expect(hiddenCount).toBeGreaterThan(0);
  });

  it('keeps the item the failure message names among the shown set even when evidence exceeds the cap', () => {
    const found = 'the ttclid cookie is 1d, needs 7d';
    const evidence = [
      ...Array.from({ length: EVIDENCE_CAP }, (_, i) => `filler-${i}: 90d (needs 90d)`),
      'ttclid: 1d (needs 7d)',
    ];
    const { shown } = selectDisplayedEvidence(found, evidence);
    expect(shown).toContain('ttclid: 1d (needs 7d)');
  });
});

describe('smartTruncateEvidence', () => {
  it('leaves short text untouched', () => {
    expect(smartTruncateEvidence('gclid: captured')).toBe('gclid: captured');
  });

  it('leaves a long non-URL string untouched (left to wrap, not cut)', () => {
    const text = 'A'.repeat(400);
    expect(smartTruncateEvidence(text)).toBe(text);
  });

  it('truncates a long URL keeping its informative tail (query string), not its first N characters', () => {
    const url = `https://example.com/${'a'.repeat(150)}?utm_source=test&gclid=abc123&tail=THE_END`;
    const text = `Requested: ${url}`;
    const result = smartTruncateEvidence(text, 100);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('THE_END'); // the informative end survives
    expect(result).toContain('…');
  });
});

// ── computeIssueTotals (PRD §3.5/W4 — reconcile the counts) ────────────────────

describe('computeIssueTotals', () => {
  it('counts total issues and the critical subset', () => {
    const issues = [
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'high' }),
    ];
    expect(computeIssueTotals(issues)).toEqual({ total: 3, critical: 2 });
  });

  it('handles zero issues', () => {
    expect(computeIssueTotals([])).toEqual({ total: 0, critical: 0 });
  });
});

// ── isPartialCoverage (PRD §3.6/W5 — coverage-aware composite scores) ─────────

describe('isPartialCoverage', () => {
  it('is false when coverage is absent', () => {
    expect(isPartialCoverage(undefined)).toBe(false);
  });

  it('is false when every constituent layer ran', () => {
    expect(isPartialCoverage({ layers_tested: 2, layers_total: 2 })).toBe(false);
  });

  it('is true when only some constituent layers ran', () => {
    expect(isPartialCoverage({ layers_tested: 1, layers_total: 2 })).toBe(true);
  });
});

// ── Could Not Be Assessed (PRD §5/W3 — suppress, do not annotate) ─────────────

describe('generatePDF — could not be assessed section', () => {
  it('renders without the section when nothing was suppressed', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders a larger buffer when could_not_be_assessed is present', async () => {
    const finding: UnassessableFinding = {
      rule_id: 'JAVASCRIPT_ERRORS_ON_CONVERSION_SURFACE',
      step: 'onboarding',
      reason: 'The scan could not reach "onboarding" and used the landing page instead, so this result isn\'t evidence about that step.',
    };
    const without = await generatePDF(makeMinimalReport());
    const withFinding = await generatePDF(makeMinimalReport({ could_not_be_assessed: [finding] }));
    expect(isPdfBuffer(withFinding)).toBe(true);
    expect(withFinding.byteLength).toBeGreaterThan(without.byteLength);
  });
});

// ── Coverage-aware score cards (PRD §3.6/W5) ──────────────────────────────────

describe('generatePDF — coverage-aware scores', () => {
  it('renders without crashing when a score has partial layer coverage', async () => {
    const report = makeMinimalReport();
    report.executive_summary.scores.optimization_strength_coverage = { layers_tested: 1, layers_total: 2 };
    report.executive_summary.scores.attribution_risk_coverage = { layers_tested: 2, layers_total: 2 };
    report.executive_summary.scores.data_consistency_coverage = { layers_tested: 1, layers_total: 1 };
    report.executive_summary.scores.conversion_signal_health_coverage = { layers_tested: 7, layers_total: 11 };
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders without crashing when a declared platform is broken alongside a Strong/Low score', async () => {
    const report = makeMinimalReport();
    report.executive_summary.scores.optimization_strength = 'Strong';
    report.executive_summary.scores.attribution_risk_level = 'Low';
    report.platform_breakdown = [
      { platform: 'meta_ads', status: 'broken', risk_explanation: 'No pixel found.', failed_rules: ['META_PIXEL_PURCHASE_EVENT_FIRED'], failed_rule_details: [] },
    ];
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Coverage Gate panel (Scoring & Coverage Gate PRD §9.1.5/§9.2) ─────────────

describe('generatePDF — withheld scores (Coverage Gate)', () => {
  it('renders a larger buffer with a Coverage Gate panel when the overall score is withheld', async () => {
    const withScore = await generatePDF(makeMinimalReport());

    const withheldReport = makeMinimalReport();
    withheldReport.executive_summary.scores.conversion_signal_health = null;
    withheldReport.executive_summary.scores.score_withheld_reason = 'INSUFFICIENT_LAYER_COVERAGE';
    withheldReport.executive_summary.scores.conversion_signal_health_coverage = { layers_tested: 5, layers_total: 13 };
    const withheld = await generatePDF(withheldReport);

    expect(isPdfBuffer(withheld)).toBe(true);
    expect(withheld.byteLength).toBeGreaterThan(withScore.byteLength);
  });

  it('renders without crashing when every sub-score is withheld (null) alongside the overall score', async () => {
    const report = makeMinimalReport();
    report.executive_summary.scores.conversion_signal_health = null;
    report.executive_summary.scores.score_withheld_reason = 'INSUFFICIENT_LAYER_COVERAGE';
    report.executive_summary.scores.attribution_risk_level = null;
    report.executive_summary.scores.optimization_strength = null;
    report.executive_summary.scores.data_consistency_score = null;
    report.executive_summary.scores.conversion_signal_health_coverage = { layers_tested: 2, layers_total: 13 };
    report.executive_summary.scores.attribution_risk_coverage = { layers_tested: 0, layers_total: 2 };
    report.executive_summary.scores.optimization_strength_coverage = { layers_tested: 0, layers_total: 2 };
    report.executive_summary.scores.data_consistency_coverage = { layers_tested: 0, layers_total: 1 };
    const buf = await generatePDF(report);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders no Coverage Gate panel when the overall score is present, even with a withheld sub-score', async () => {
    const withoutSubWithheld = await generatePDF(makeMinimalReport());

    const report = makeMinimalReport();
    report.executive_summary.scores.attribution_risk_level = null;
    report.executive_summary.scores.attribution_risk_coverage = { layers_tested: 0, layers_total: 2 };
    const buf = await generatePDF(report);

    expect(isPdfBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(withoutSubWithheld.byteLength);
  });
});

// ── Report rename + new sections (Pre-Connection Scan Confidence Tiering PRD §11/§12) ──

describe('generatePDF — Signal Observation Report rename', () => {
  it('titles a v2 report "Signal Observation Report"', async () => {
    const report = makeMinimalReport({ rule_set_version: 'v2' });
    const buf = await generatePDF(report);
    expect(buf.toString('latin1')).toContain('Signal Observation Report');
  });

  it('titles a v1-legacy (or version-less) report "Signal Health Report"', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(buf.toString('latin1')).toContain('Signal Health Report');
  });
});

describe('generatePDF — Signals in Conflict section', () => {
  it('renders a larger buffer with the section when signal_conflicts is present', async () => {
    const without = await generatePDF(makeMinimalReport());
    const report = makeMinimalReport({
      signal_conflicts: [
        { assertion_id: 'CONF_01', entity: 'GA4', source_a: 'DL', reading_a: 'config call observed', source_b: 'NET', reading_b: 'no collect request found', affected_rule_ids: ['GA4_CONFIG_TAG_PRESENT'] },
      ],
    });
    const withConflict = await generatePDF(report);
    expect(isPdfBuffer(withConflict)).toBe(true);
    expect(withConflict.byteLength).toBeGreaterThan(without.byteLength);
  });

  it('renders without the section when signal_conflicts is absent', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

describe('generatePDF — With Access section', () => {
  it('renders a larger buffer with the section when with_access is present', async () => {
    const without = await generatePDF(makeMinimalReport());
    const report = makeMinimalReport({
      with_access: [
        { check: 'Platform reconciliation', requires_connection: ['google_ads', 'meta'], answers_question_for: ['DECLARED_PLATFORM_HAS_TAG'], reveals: 'Whether platform-reported conversions match what this scan observed.' },
      ],
    });
    const withAccess = await generatePDF(report);
    expect(isPdfBuffer(withAccess)).toBe(true);
    expect(withAccess.byteLength).toBeGreaterThan(without.byteLength);
  });
});

// ── Real page numbering (PRD §3.3/W6) ─────────────────────────────────────────

describe('generatePDF — real page numbering', () => {
  it('renders a long, many-issue report spanning several pages without crashing', async () => {
    const issues: ReportIssue[] = Array.from({ length: 40 }, (_, i) =>
      makeIssue({
        rule_id: `RULE_${i}`,
        problem: `Problem statement number ${i} describing a specific measurement gap in detail. `.repeat(3),
        fix_summary: `Detailed remediation step ${i} explaining exactly what to change and why, at real authored length. `.repeat(4),
        severity: i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low',
      }),
    );
    const buf = await generatePDF(makeMinimalReport({ issues }));
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Remediation copy is never truncated mid-word (PRD §3.2/W2) ────────────────

describe('generatePDF — long remediation copy', () => {
  it('renders a 400-character fix_summary and problem without crashing', async () => {
    const longProblem = 'This is a detailed problem statement. '.repeat(12); // > 400 chars
    const longFix = 'This is a detailed, fully authored remediation instruction with real substance. '.repeat(8); // > 400 chars
    expect(longProblem.length).toBeGreaterThan(400);
    expect(longFix.length).toBeGreaterThan(400);
    const issue = makeIssue({ problem: longProblem, fix_summary: longFix });
    const buf = await generatePDF(makeMinimalReport({ issues: [issue] }));
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

// ── Report Honesty PRD — Open Questions, confidence, How to Read ─────────────

describe('generatePDF — Open Questions section', () => {
  it('renders with no open_questions (section omitted)', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it('renders a larger buffer when open_questions are present', async () => {
    const without = await generatePDF(makeMinimalReport());
    const withQuestions = await generatePDF(makeMinimalReport({
      open_questions: [
        'Two GTM containers are loading (GTM-AAA111, GTM-BBB222). Is one a migration in progress, or does a second team own it?',
      ],
    }));
    expect(isPdfBuffer(withQuestions)).toBe(true);
    expect(withQuestions.byteLength).toBeGreaterThan(without.byteLength);
  });

  it('renders with several open_questions without crashing', async () => {
    const buf = await generatePDF(makeMinimalReport({
      open_questions: [
        'Two GTM containers are loading (GTM-AAA111, GTM-BBB222). Is one a migration in progress, or does a second team own it?',
        'We found no Google Ads (AW-) loader on the site. Does Google Ads run through a different property, a server-side container we could not see from a client-side crawl, or is it not yet implemented?',
        'We could not confirm your order confirmation page, so checks that depend on it are inconclusive. Can you supply its URL, or a test-order route we can use?',
      ],
    }));
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

describe('generatePDF — How to Read This Report section', () => {
  it('always renders the static section, regardless of report content', async () => {
    const buf = await generatePDF(makeMinimalReport());
    expect(isPdfBuffer(buf)).toBe(true);
  });
});

describe('generatePDF — confidence chip and appendix column', () => {
  it("renders a larger buffer for an action item whose result carries confidence: 'confirm'", async () => {
    const issue = makeIssue({ rule_id: 'CONFIRM_RULE' });
    const highConfidenceResult: ValidationResult = { ...makeValidationResult('CONFIRM_RULE', 'fail'), confidence: 'high' };
    const confirmResult: ValidationResult = { ...makeValidationResult('CONFIRM_RULE', 'fail'), confidence: 'confirm' };

    const highBuf = await generatePDF(makeMinimalReport({
      issues: [issue],
      technical_appendix: { validation_results: [highConfidenceResult], raw_network_requests: [], raw_datalayer_events: [] },
    }));
    const confirmBuf = await generatePDF(makeMinimalReport({
      issues: [issue],
      technical_appendix: { validation_results: [confirmResult], raw_network_requests: [], raw_datalayer_events: [] },
    }));

    expect(isPdfBuffer(highBuf)).toBe(true);
    expect(isPdfBuffer(confirmBuf)).toBe(true);
    expect(confirmBuf.byteLength).toBeGreaterThan(highBuf.byteLength);
  });

  it('renders the technical appendix table for a mix of confidence values without crashing', async () => {
    const results: ValidationResult[] = [
      makeValidationResult('A', 'pass'),
      { ...makeValidationResult('B', 'fail'), confidence: 'high' },
      { ...makeValidationResult('C', 'fail'), confidence: 'confirm' },
      { ...makeValidationResult('D', 'warning') }, // no confidence set (v1-originated) — must not throw
    ];
    const buf = await generatePDF(makeMinimalReport({
      technical_appendix: { validation_results: results, raw_network_requests: [], raw_datalayer_events: [] },
    }));
    expect(isPdfBuffer(buf)).toBe(true);
  });
});
