/**
 * PDF Generator Tests
 * Validates that generatePDF produces a valid PDF buffer for various
 * ReportJSON inputs — from minimal to full 26-rule reports.
 */
import { describe, it, expect } from 'vitest';
import { generatePDF } from '../pdfGenerator';
import type { ReportJSON, ValidationResult, ReportIssue } from '@/types/audit';

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
      { platform: 'ga4', status: 'healthy', risk_explanation: 'All GA4 checks passed.', failed_rules: [] },
      { platform: 'google_ads', status: 'healthy', risk_explanation: 'All Google Ads checks passed.', failed_rules: [] },
      { platform: 'meta_ads', status: 'healthy', risk_explanation: 'All Meta checks passed.', failed_rules: [] },
      { platform: 'gtm', status: 'healthy', risk_explanation: 'GTM loaded correctly.', failed_rules: [] },
      { platform: 'sgtm', status: 'healthy', risk_explanation: 'sGTM firing correctly.', failed_rules: [] },
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
