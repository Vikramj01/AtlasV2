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

  // Regression coverage for PRD "Signal Health Report" Issue 2 — a handful
  // of rule_ids (GTM_CONTAINER_LOADED, GCLID_CAPTURED_AT_LANDING, ...) exist
  // in both the v1 RULE_INTERPRETATIONS dict above and the v2 Check
  // Register, with different implementations. Before this fix, any v2
  // result for one of these rule_ids silently got the v1 dict's static
  // business_impact text as why_it_matters instead of its own real
  // technical_details.found — which then disagreed with the same rule_id's
  // entry in journey_stages (buildV2LayerStages always uses the live
  // result). Found via the full-taxonomy regression fixture in
  // reporting/__tests__/evidenceConsistency.test.ts.
  describe('rule_id collisions between the v1 dict and the v2 register', () => {
    it('uses the live result\'s own evidence, not the v1 dict\'s static text, for a v2-originated result sharing a v1 rule_id', () => {
      const v2Result = makeResult('GCLID_CAPTURED_AT_LANDING', 'fail');
      v2Result.validation_layer = 'click_id_capture'; // L2.1's real declared layer
      v2Result.technical_details.found = 'gclid present in the landing URL but never read into storage, a cookie, or dataLayer';

      const [issue] = interpretResults([v2Result]);
      expect(issue.why_it_matters).toBe('gclid present in the landing URL but never read into storage, a cookie, or dataLayer');
      // recommended_owner still borrows the v1 entry — the register doesn't
      // carry that field. fix_summary comes from the v2 rule's own authored
      // remediation (L2.1's, not v1's) — now that every register rule has
      // one, it's more specific than v1's generic auto-tagging copy, which
      // describes a check the v2 rule doesn't even make.
      expect(issue.recommended_owner).toBe('Frontend Developer');
      expect(issue.fix_summary).toContain('Read the injected gclid URL parameter');
    });

    it('still uses the v1 dict\'s business_impact for a genuine v1 result on the same colliding rule_id', () => {
      const v1Result = makeResult('GCLID_CAPTURED_AT_LANDING', 'fail');
      v1Result.validation_layer = 'signal_initiation'; // v1's own layer for this rule — does not match L2.1's

      const [issue] = interpretResults([v1Result]);
      expect(issue.why_it_matters).toBe('Google Ads cannot attribute conversions to ad clicks. Attribution is completely broken.');
    });
  });
});

// ── generateBusinessSummary ───────────────────────────────────────────────────

describe('generateBusinessSummary', () => {
  it('returns the healthy message when nothing failed', () => {
    expect(generateBusinessSummary([])).toBe('All conversion signals are operating normally.');
  });

  it('returns the healthy message when results only pass/skip', () => {
    const results = [makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass'), makeResult('SOME_UNMAPPED_RULE', 'skipped')];
    expect(generateBusinessSummary(results)).toBe('All conversion signals are operating normally.');
  });

  it('synthesizes a summary input from severity + technical_details.found (the actual observed state) for a rule_id with no RULE_INTERPRETATIONS entry (e.g. the v2 register)', () => {
    const result: ValidationResult = {
      rule_id: 'SOME_V2_RULE',
      validation_layer: 'click_id_capture',
      status: 'fail',
      severity: 'critical',
      technical_details: { found: 'gclid missing', expected: 'gclid is captured at landing', evidence: [] },
    };
    const summary = generateBusinessSummary([result]);
    expect(summary).toContain('Your tracking has 1 critical issue.');
    expect(summary).toContain('gclid missing');
    expect(summary).not.toContain('gclid is captured at landing');
  });

  // Regression coverage for PRD "Signal Health Report" Issue 4 — the
  // narrator was reading technical_details.expected (the rule's
  // ideal/passing-state description) instead of .found (what actually
  // happened) for any rule with no v1 RULE_INTERPRETATIONS entry, which is
  // every v2 Check Register rule. These are the PRD's own two cited
  // examples, reproduced with the real register rules' actual .expected
  // text (both contain the exact wording PRD quoted as the bug).
  it('never describes DECLARED_PLATFORM_HAS_TAG\'s passing state ("every declared platform has its base tag") for a failing result', () => {
    const result: ValidationResult = {
      rule_id: 'DECLARED_PLATFORM_HAS_TAG',
      validation_layer: 'scope_configuration',
      status: 'fail',
      severity: 'critical',
      technical_details: {
        found: '1 of 2 declared platforms missing a base tag',
        expected: 'Every declared platform has its base tag/pixel firing on the site',
        evidence: ['meta: MISSING'],
      },
    };
    const summary = generateBusinessSummary([result]);
    expect(summary).toContain('1 of 2 declared platforms missing a base tag');
    expect(summary).not.toContain('Every declared platform has its base tag');
  });

  it('never ships GA4_CONFIG_TAG_PRESENT\'s unfilled-looking placeholder ID ("G-XXXXXXXXXX") for a failing result', () => {
    const result: ValidationResult = {
      rule_id: 'GA4_CONFIG_TAG_PRESENT',
      validation_layer: 'foundation_tags',
      status: 'fail',
      severity: 'critical',
      technical_details: {
        found: 'No GA4 collect request detected',
        expected: 'GA4 config fires and a measurement ID (G-XXXXXXXXXX) resolves',
        evidence: ['No requests to google-analytics.com/g/collect or analytics.google.com/g/collect'],
      },
    };
    const summary = generateBusinessSummary([result]);
    expect(summary).toContain('No GA4 collect request detected');
    expect(summary).not.toContain('G-XXXXXXXXXX');
  });

  it('leads with a critical count and the single most urgent full impact sentence', () => {
    const summary = generateBusinessSummary([makeResult('GA4_PURCHASE_EVENT_FIRED')]);
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
      makeResult('GA4_PURCHASE_EVENT_FIRED'), // affects 1 platform (GA4)
      makeResult('DATALAYER_POPULATED'),      // affects ['All'] — ranks first on breadth tiebreak
    ]);
    expect(summary).toContain('Your tracking has 2 critical issues.');
    // DATALAYER_POPULATED's ['All'] should outrank GA4's single-platform impact
    expect(summary).toContain('Your GTM has no data to work with.');
    expect(summary).toContain('Also affecting results:');
  });

  it('caps ranked issues without discarding the critical count', () => {
    const summary = generateBusinessSummary([
      makeResult('GA4_PURCHASE_EVENT_FIRED'),
      makeResult('META_PIXEL_PURCHASE_EVENT_FIRED'),
      makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRED'),
      makeResult('GTM_CONTAINER_LOADED'),
    ]);
    expect(summary).toContain('Your tracking has 4 critical issues.');
  });

  it('appends a high-priority clause when high-severity issues are present alongside criticals', () => {
    const summary = generateBusinessSummary([
      makeResult('GA4_PURCHASE_EVENT_FIRED'),               // critical
      makeResult('SGTM_SERVER_EVENT_FIRED', 'fail', 'high'), // high
    ]);
    expect(summary).toContain('Your tracking has 1 critical issue.');
    expect(summary).toContain('1 additional high-priority issue should be addressed next.');
  });

  it('leads with high-priority framing when there are no critical issues', () => {
    const summary = generateBusinessSummary([makeResult('SGTM_SERVER_EVENT_FIRED', 'fail', 'high')]);
    expect(summary).toContain('Your tracking is mostly working, but 1 high-priority issue is reducing optimization effectiveness.');
    expect(summary).toContain('Most significant:');
  });

  it('produces a minor-issues-only summary when nothing is critical or high', () => {
    const summary = generateBusinessSummary([makeResult('COUPON_CAPTURED_IF_USED', 'fail', 'low')]);
    expect(summary).toContain('1 minor issue detected:');
    expect(summary).toContain('Cannot measure coupon effectiveness');
    expect(summary).toContain('This has limited impact but is worth fixing when convenient.');
  });

  it('reads as a coherent sentence, not concatenated fragments (no double periods/spacing artifacts)', () => {
    const summary = generateBusinessSummary([
      makeResult('GA4_PURCHASE_EVENT_FIRED'),
      makeResult('SGTM_SERVER_EVENT_FIRED', 'fail', 'high'),
    ]);
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
  it('is healthy when there are no failures', () => {
    expect(determineOverallStatus([])).toBe('healthy');
    expect(determineOverallStatus([makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass')])).toBe('healthy');
  });

  it('is critical when any failure is critical severity, even with no RULE_INTERPRETATIONS entry', () => {
    expect(determineOverallStatus([makeResult('GA4_PURCHASE_EVENT_FIRED')])).toBe('critical');
    expect(determineOverallStatus([makeResult('SOME_V2_RULE', 'fail', 'critical')])).toBe('critical');
  });

  it('is partially_broken when the worst failure is high severity', () => {
    expect(determineOverallStatus([makeResult('SGTM_SERVER_EVENT_FIRED', 'fail', 'high')])).toBe('partially_broken');
  });

  it('prefers critical over partially_broken when both are present', () => {
    expect(
      determineOverallStatus([
        makeResult('SGTM_SERVER_EVENT_FIRED', 'fail', 'high'),
        makeResult('GA4_PURCHASE_EVENT_FIRED'),
      ]),
    ).toBe('critical');
  });
});
