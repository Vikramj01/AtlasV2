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
  collectClientQuestions,
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

    // Report Correctness Programme PRD Part B2/B3 — GCLID/FBCLID_CAPTURED_
    // AT_LANDING happen to collide with a v1 RULE_INTERPRETATIONS entry;
    // GBRAID/WBRAID/TTCLID_CAPTURED_AT_LANDING (same L2 factory, same
    // remediation shape) don't. Before the fix, that accident of naming
    // gave the colliding pair a full prose headline + 'low' effort while
    // the rest of the family got "Validation failed: RULE_ID" + a 'medium'
    // fallback — five members of one rule family, two renderings/efforts
    // (PRD's Birkenstock/OpenArt Items #5-#9).
    it('gives every L2 click-ID capture rule the same heading shape and the same effort, regardless of a v1 dict collision', () => {
      const colliding = makeResult('GCLID_CAPTURED_AT_LANDING', 'fail');
      colliding.validation_layer = 'click_id_capture';
      const nonColliding = makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail');
      nonColliding.validation_layer = 'click_id_capture';

      const [collidingIssue, nonCollidingIssue] = interpretResults([colliding, nonColliding]);

      // Neither ever falls back to the raw "Validation failed: RULE_ID" shape.
      expect(collidingIssue.problem).not.toMatch(/^Validation failed:/);
      expect(nonCollidingIssue.problem).not.toMatch(/^Validation failed:/);
      // Both headings come from the rule's own `check` label (capitalized),
      // not a v1-dict prose sentence — same shape for both.
      expect(collidingIssue.problem).toBe('Gclid captured at landing');
      expect(nonCollidingIssue.problem).toBe('Gbraid captured at landing');
      // Same factory, same remediation shape → same effort, not 'low' vs 'medium'.
      expect(collidingIssue.estimated_effort).toBe(nonCollidingIssue.estimated_effort);
      expect(collidingIssue.estimated_effort).toBe('low');
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

  // Regression coverage for PRD "Signal Health Report: Evidence Integrity &
  // Presentation" §3.8/W10 — technical_details.found strings (used
  // unconditionally for any v2 rule, per toSummaryInput) are authored as
  // fragments, not sentences, and were being concatenated raw: "...missing
  // a base tag Also affecting results: No GA4 collect request detected Fix
  // this first...". Every sentence boundary needs terminal punctuation.
  describe('sentence-terminal punctuation (W10)', () => {
    it('adds a period between an un-punctuated business_impact fragment and the sentence that follows it', () => {
      const top: ValidationResult = {
        rule_id: 'DECLARED_PLATFORM_HAS_TAG',
        validation_layer: 'scope_configuration',
        status: 'fail',
        severity: 'critical',
        technical_details: { found: '1 of 2 declared platforms missing a base tag', expected: '', evidence: [] },
      };
      const second: ValidationResult = {
        rule_id: 'GA4_CONFIG_TAG_PRESENT',
        validation_layer: 'foundation_tags',
        status: 'fail',
        severity: 'critical',
        technical_details: { found: 'No GA4 collect request detected', expected: '', evidence: [] },
      };
      const summary = generateBusinessSummary([top, second]);
      expect(summary).not.toMatch(/missing a base tag Also/);
      expect(summary).toContain('missing a base tag. Also affecting results: No GA4 collect request detected. Fix this first');
    });

    it('does not add a second period to a fragment that already ends with one', () => {
      // GA4_PURCHASE_EVENT_FIRED's v1 business_impact already ends in '.'
      const summary = generateBusinessSummary([makeResult('GA4_PURCHASE_EVENT_FIRED')]);
      expect(summary).not.toMatch(/\.\./);
    });
  });

  // Regression coverage for PRD §3.5/W4 — "reconcile the counts": the
  // narrator's total previously counted only 'fail' results, silently
  // excluding warnings, while the PDF's Rule Overview counts failed +
  // warnings together — leaving two different "totals" on the same page
  // with no stated relationship.
  describe('warning reconciliation (W4)', () => {
    it('states the combined failed+warning total when warnings are present alongside failures', () => {
      const summary = generateBusinessSummary([
        makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail'),
        makeResult('CURRENCY_PARAMETER_PRESENT', 'warning', 'high'),
      ]);
      expect(summary).toContain('Your tracking has 1 critical issue.');
      expect(summary).toContain('In total, 2 checks across this audit are failing or flagged as a warning.');
    });

    it('does not append the reconciliation clause when there are no warnings (every existing report is unaffected)', () => {
      const summary = generateBusinessSummary([makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail')]);
      expect(summary).not.toContain('In total,');
    });

    it('reports a warnings-only result set instead of falsely claiming "operating normally"', () => {
      const summary = generateBusinessSummary([makeResult('CURRENCY_PARAMETER_PRESENT', 'warning', 'high')]);
      expect(summary).not.toBe('All conversion signals are operating normally.');
      expect(summary).toContain('1 check');
      expect(summary).toContain('warning');
    });
  });

  // Signal vs Implementation PRD P0-03 — a raw fail/warning whose verdict
  // was demoted by the confidence lattice (e.g. gated on an unverified
  // conversion surface) must not count toward the critical total or the
  // "most urgent" slot — reproduces the PureBorn trigger scan's defect,
  // where three Needs-confirmation conversion-fires findings still drove
  // "5 critical issues" here even though scoring.ts and the Action Items
  // list already excluded them.
  describe('excludes demoted (non-FAIL-verdict) results from the summary — PRD P0-03', () => {
    it('reports "operating normally" when the only failures have a NOT_OBSERVED verdict', () => {
      const demoted = { ...makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRES'), verdict: 'NOT_OBSERVED' as const };
      expect(generateBusinessSummary([demoted])).toBe('All conversion signals are operating normally.');
    });

    it('excludes a demoted result from the critical count even when a genuine critical failure is also present', () => {
      const demoted = { ...makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRES'), verdict: 'NOT_OBSERVED' as const };
      const genuine = { ...makeResult('GTM_CONTAINER_LOADED', 'fail', 'critical'), verdict: 'FAIL' as const };
      const summary = generateBusinessSummary([demoted, genuine]);
      expect(summary).toContain('1 critical issue');
    });

    it('still counts a fail result with no verdict field at all (pre-lattice fixture) — unchanged legacy behavior', () => {
      const legacy = makeResult('SOME_V2_RULE', 'fail', 'critical');
      expect(legacy.verdict).toBeUndefined();
      expect(generateBusinessSummary([legacy])).toContain('1 critical issue');
    });
  });

  // Signal vs Implementation PRD P0-05 — reproduces the PureBorn trigger
  // scan's Business Summary shape end to end: a downgraded implementation-
  // mechanism finding (GTM, now 'warning'/'low' per P0-04), three demoted
  // Needs-confirmation conversion-fires findings (P0-03), and two genuine
  // critical signal failures (Google Ads, TikTok). Business Summary ranking
  // is untouched code (still severity-first via rankIssuesForSummary) —
  // this asserts the fix composes correctly with P0-03/P0-04 rather than
  // needing its own separate implementation-layer exclusion list.
  it('leads with the genuine signal failures, not the downgraded GTM finding or the demoted conversion-fires findings (P0-05)', () => {
    const withFound = (result: ValidationResult, found: string): ValidationResult => ({
      ...result,
      technical_details: { ...result.technical_details, found },
    });
    const gtmDowngraded = withFound(
      { ...makeResult('GTM_CONTAINER_LOADED', 'warning', 'low'), verdict: 'FAIL' as const },
      'No GTM container script (gtm.js) detected loading — GTM is not in use on this site.',
    );
    const demotedGoogleAdsFires = { ...makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRES'), verdict: 'NOT_OBSERVED' as const };
    const genuineGoogleAdsId = withFound(
      { ...makeResult('GOOGLE_ADS_AW_ID_PRESENT', 'fail', 'critical'), verdict: 'FAIL' as const },
      'No gtag.js loader detected, so no AW- conversion ID either',
    );
    const genuineTiktokPixel = withFound(
      { ...makeResult('TIKTOK_PIXEL_PRESENT', 'fail', 'critical'), verdict: 'FAIL' as const },
      'No TikTok pixel detected on any sampled page',
    );

    const summary = generateBusinessSummary([gtmDowngraded, demotedGoogleAdsFires, genuineGoogleAdsId, genuineTiktokPixel]);

    // Exactly the two genuine critical failures count — GTM (warning) and
    // the demoted conversion-fires result (NOT_OBSERVED) are both excluded.
    expect(summary).toContain('2 critical issue');
    // The "most urgent" slot names a real signal failure, never GTM's copy.
    expect(summary).not.toContain('GTM is not in use on this site');
    expect(summary).toMatch(/AW- conversion ID|TikTok pixel/);
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

  // Signal vs Implementation PRD P0-03 — a raw 'fail' status whose verdict
  // was demoted (conversion-event-fires rule gated on an unverified
  // conversion surface, per the verdict lattice) must not drive this to
  // 'critical' — previously the only place in the report that still did.
  it('is healthy, not critical, when the only failure has a NOT_OBSERVED verdict (unverified conversion surface)', () => {
    const result = { ...makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRES'), verdict: 'NOT_OBSERVED' as const };
    expect(determineOverallStatus([result])).toBe('healthy');
  });

  it('is still critical when a genuine, confidently-failed critical result exists alongside a demoted one', () => {
    const demoted = { ...makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRES'), verdict: 'NOT_OBSERVED' as const };
    const genuine = { ...makeResult('SOME_V2_RULE', 'fail', 'critical'), verdict: 'FAIL' as const };
    expect(determineOverallStatus([demoted, genuine])).toBe('critical');
  });
});

// ── collectClientQuestions (Report Honesty PRD Part B) ──────────────────────

describe('collectClientQuestions', () => {
  it('interpolates real observed evidence for a v2 rule whose client_question is a function', () => {
    // NO_DUPLICATE_CONTAINER is L1.11 (layer 'foundation_tags') — matching
    // rule_id + layer is what isV2Result() uses to recognise this as a real
    // register result, not a same-named v1 one.
    const result: ValidationResult = {
      rule_id: 'NO_DUPLICATE_CONTAINER',
      validation_layer: 'foundation_tags',
      status: 'fail',
      severity: 'high',
      technical_details: {
        found: '2 distinct GTM containers loading: GTM-KVJPJ9LF, GTM-KNXTBPDD',
        expected: 'Exactly one GTM container loads across the sampled pages',
        evidence: ['Container IDs observed: GTM-KVJPJ9LF, GTM-KNXTBPDD'],
      },
    };
    const questions = collectClientQuestions([result]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('GTM-KVJPJ9LF');
    expect(questions[0]).toContain('GTM-KNXTBPDD');
  });

  it('returns nothing for a v2 rule with no authored client_question', () => {
    const result: ValidationResult = {
      rule_id: 'GA4_PURCHASE_EVENT_FIRED', // v1-shaped rule_id, no v2 register entry at all
      validation_layer: 'parameter_completeness',
      status: 'fail',
      severity: 'critical',
      technical_details: { found: '', expected: '', evidence: [] },
    };
    expect(collectClientQuestions([result])).toEqual([]);
  });

  it('excludes passing and skipped results even when their rule carries client_question', () => {
    const base = {
      rule_id: 'NO_DUPLICATE_CONTAINER',
      validation_layer: 'foundation_tags' as const,
      severity: 'high' as const,
      technical_details: { found: '', expected: '', evidence: [] },
    };
    expect(collectClientQuestions([{ ...base, status: 'pass' }])).toEqual([]);
    expect(collectClientQuestions([{ ...base, status: 'skipped' }])).toEqual([]);
  });

  it("doesn't mistake a v1 result for v2 just because it reuses a rule_id — layer must match too", () => {
    const v1ShapedResult: ValidationResult = {
      rule_id: 'NO_DUPLICATE_CONTAINER',
      validation_layer: 'signal_initiation', // not L1.11's real layer ('foundation_tags')
      status: 'fail',
      severity: 'high',
      technical_details: { found: '', expected: '', evidence: [] },
    };
    expect(collectClientQuestions([v1ShapedResult])).toEqual([]);
  });
});
