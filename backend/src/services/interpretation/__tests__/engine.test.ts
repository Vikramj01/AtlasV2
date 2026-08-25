/**
 * Interpretation Engine Tests
 * Locks down current behavior of RULE_INTERPRETATIONS, interpretResults,
 * generateBusinessSummary, and determineOverallStatus before the copy
 * layer is rewritten (Sprint: Audit Report Readability).
 */
import { describe, it, expect } from 'vitest';
import {
  interpretResults,
  generateBusinessSummary,
  determineOverallStatus,
  getIssueHeadline,
} from '../engine';
import type { ValidationResult } from '@/types/audit';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(
  rule_id: string,
  status: 'pass' | 'fail' | 'warning' | 'skipped' = 'fail',
  severity: 'critical' | 'high' | 'medium' | 'low' = 'critical',
): ValidationResult {
  return {
    rule_id,
    validation_layer: 'parameter_completeness',
    status,
    severity,
    technical_details: { found: 'found-val', expected: 'expected-val', evidence: [] },
  };
}

// ── interpretResults ──────────────────────────────────────────────────────────

describe('interpretResults', () => {
  it('returns an empty array when nothing failed or warned', () => {
    const results = [makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass')];
    expect(interpretResults(results)).toEqual([]);
  });

  it('excludes skipped results', () => {
    const results = [makeResult('GA4_PURCHASE_EVENT_FIRED', 'skipped')];
    expect(interpretResults(results)).toEqual([]);
  });

  it('includes both fail and warning statuses', () => {
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail'),
      makeResult('CURRENCY_PARAMETER_PRESENT', 'warning', 'high'),
    ];
    const issues = interpretResults(results);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.rule_id)).toEqual([
      'GA4_PURCHASE_EVENT_FIRED',
      'CURRENCY_PARAMETER_PRESENT',
    ]);
  });

  it('maps a known rule_id to its interpretation fields', () => {
    const [issue] = interpretResults([makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail')]);
    expect(issue.severity).toBe('critical');
    expect(issue.recommended_owner).toBe('Frontend Developer');
    expect(issue.estimated_effort).toBe('low');
    expect(issue.fix_summary).toContain('gtag');
    // problem uses the purpose-written headline, not a mechanical first-sentence split
    expect(issue.problem).toBe(
      "Google Analytics can't see your purchases — your entire dashboard is blind to conversions.",
    );
    expect(issue.why_it_matters).toContain('This breaks all conversion reporting');
  });

  it('falls back to a generic interpretation for unknown rule_ids', () => {
    const [issue] = interpretResults([makeResult('SOME_UNMAPPED_RULE', 'fail', 'medium')]);
    expect(issue.problem).toBe('Validation failed: SOME_UNMAPPED_RULE');
    expect(issue.recommended_owner).toBe('Frontend Developer');
    expect(issue.fix_summary).toBe('Contact support for details on this rule.');
    expect(issue.estimated_effort).toBe('medium');
    expect(issue.severity).toBe('medium'); // taken from the ValidationResult, not the (missing) interpretation
  });

  it('carries validation_layer through unchanged', () => {
    const [issue] = interpretResults([makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail')]);
    expect(issue.validation_layer).toBe('parameter_completeness');
  });
});

// ── generateBusinessSummary ───────────────────────────────────────────────────

describe('generateBusinessSummary', () => {
  it('returns the healthy message when nothing failed', () => {
    expect(generateBusinessSummary([])).toBe('All conversion signals are operating normally.');
  });

  it('ignores unmapped rule_ids entirely', () => {
    expect(generateBusinessSummary(['SOME_UNMAPPED_RULE'])).toBe(
      'All conversion signals are operating normally.',
    );
  });

  it('leads with a critical count and the single most urgent full impact sentence', () => {
    const summary = generateBusinessSummary(['GA4_PURCHASE_EVENT_FIRED']);
    expect(summary).toContain('Your tracking has 1 critical issue.');
    expect(summary).toContain('The most urgent:');
    // full sentence(s), not a mechanically truncated first-sentence fragment
    expect(summary).toContain(
      'Google Analytics is not tracking your conversions. Your entire analytics dashboard is blind to purchases.',
    );
    expect(summary).toContain('Fix this first');
  });

  it('names a second critical issue when two or more are present, ranked by platform breadth', () => {
    const summary = generateBusinessSummary([
      'GA4_PURCHASE_EVENT_FIRED',           // affects 1 platform (GA4)
      'DATALAYER_POPULATED',                // affects ['All'] — ranks first on breadth tiebreak
    ]);
    expect(summary).toContain('Your tracking has 2 critical issues.');
    // DATALAYER_POPULATED's ['All'] should outrank GA4's single-platform impact
    expect(summary).toContain('Your GTM has no data to work with.');
    expect(summary).toContain('Also affecting results:');
  });

  it('caps ranked issues without discarding the critical count', () => {
    const summary = generateBusinessSummary([
      'GA4_PURCHASE_EVENT_FIRED',
      'META_PIXEL_PURCHASE_EVENT_FIRED',
      'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
      'GTM_CONTAINER_LOADED',
    ]);
    expect(summary).toContain('Your tracking has 4 critical issues.');
  });

  it('appends a high-priority clause when high-severity issues are present alongside criticals', () => {
    const summary = generateBusinessSummary([
      'GA4_PURCHASE_EVENT_FIRED', // critical
      'SGTM_SERVER_EVENT_FIRED',  // high
    ]);
    expect(summary).toContain('Your tracking has 1 critical issue.');
    expect(summary).toContain('1 additional high-priority issue should be addressed next.');
  });

  it('leads with high-priority framing when there are no critical issues', () => {
    const summary = generateBusinessSummary(['SGTM_SERVER_EVENT_FIRED']); // high severity
    expect(summary).toContain('Your tracking is mostly working, but 1 high-priority issue is reducing optimization effectiveness.');
    expect(summary).toContain('Most significant:');
  });

  it('produces a minor-issues-only summary when nothing is critical or high', () => {
    const summary = generateBusinessSummary(['COUPON_CAPTURED_IF_USED']); // low severity
    expect(summary).toContain('1 minor issue detected:');
    expect(summary).toContain('Cannot measure coupon effectiveness');
    expect(summary).toContain('This has limited impact but is worth fixing when convenient.');
  });

  it('reads as a coherent sentence, not concatenated fragments (no double periods/spacing artifacts)', () => {
    const summary = generateBusinessSummary(['GA4_PURCHASE_EVENT_FIRED', 'SGTM_SERVER_EVENT_FIRED']);
    expect(summary).not.toMatch(/\.\./);
    expect(summary).not.toMatch(/\s{2,}/);
  });
});

// ── getIssueHeadline ───────────────────────────────────────────────────────────

describe('getIssueHeadline', () => {
  it('returns the purpose-written headline for a known rule_id', () => {
    expect(getIssueHeadline('GTM_CONTAINER_LOADED')).toBe(
      "Google Tag Manager isn't loading — nothing tracks at all without it.",
    );
  });

  it('falls back to a title-cased rule_id for unknown rules', () => {
    expect(getIssueHeadline('SOME_UNMAPPED_RULE')).toBe('SOME UNMAPPED RULE');
  });
});

// ── determineOverallStatus ────────────────────────────────────────────────────

describe('determineOverallStatus', () => {
  it('is healthy when there are no mapped failures', () => {
    expect(determineOverallStatus([])).toBe('healthy');
    expect(determineOverallStatus(['SOME_UNMAPPED_RULE'])).toBe('healthy');
  });

  it('is critical when any failure is critical severity', () => {
    expect(determineOverallStatus(['GA4_PURCHASE_EVENT_FIRED'])).toBe('critical');
  });

  it('is partially_broken when the worst failure is high severity', () => {
    expect(determineOverallStatus(['SGTM_SERVER_EVENT_FIRED'])).toBe('partially_broken');
  });

  it('prefers critical over partially_broken when both are present', () => {
    expect(
      determineOverallStatus(['SGTM_SERVER_EVENT_FIRED', 'GA4_PURCHASE_EVENT_FIRED']),
    ).toBe('critical');
  });
});
