/**
 * Regression guard for PRD "Signal Health Report · Accuracy and Output
 * Fixes" Issue 2 — contradictory evidence for the same rule across report
 * sections.
 *
 * Investigation (see docs/atlas-sprint-plan-signal-health-report-fixes.md,
 * Sprint 2) traced every render path and confirmed `journey_stages` and
 * `issues` are both built from one `ValidationResult[]` in one synchronous
 * call (orchestrator.ts), saved as a single JSON blob, and read by both the
 * web view and PDF export with no recomputation — so there is no live path
 * today where these two sections can disagree for a given rule. Querying
 * the actual openart.ai audit's stored report (audit_id
 * 9d95cf3f-b94a-4487-8ce1-c771907e8b54) confirmed this directly: its L3
 * funnel-breakdown evidence and its Issues & Fixes evidence for
 * STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW are byte-identical strings.
 * Issue 2 as described does not reproduce against live data.
 *
 * This fixture exists as the standing guard the PRD's §7 testing note asks
 * for regardless — if a future change gives `journey_stages` and `issues`
 * two different evidence sources for the same rule_id, this test catches
 * it immediately rather than waiting for a human to notice a contradiction
 * in a shipped report.
 */
import { describe, it, expect } from 'vitest';
import { runRegister } from '@/services/validation/register/engine';
import { buildV2LayerStages } from '@/services/validation/register/reporting';
import { interpretResults } from '@/services/interpretation/engine';
import type { AuditData, JourneyStage, ReportIssue } from '@/types/audit';

/**
 * A mostly-unconfigured ecommerce AuditData across five declared platforms —
 * deliberately sparse so the register produces a large number of failures
 * spanning many layers, maximising the set of rule_ids this test can check
 * for cross-section evidence agreement (a fixture with few failures would
 * only prove the guard works for the handful of rules that happened to fail).
 */
function makeSparseAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-evidence-consistency',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'ecommerce',
    declared_platforms: ['google_ads', 'meta', 'tiktok', 'linkedin', 'microsoft'],
    declared_conversions: [{ name: 'purchase', kind: 'primary' }],
    dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    detailedCookies: [
      { name: 'gclid', value: 'abc', domain: '.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 90 * 86_400, secure: true, sameSite: 'Lax' },
      { name: 'fbclid', value: 'def', domain: '.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 1 * 86_400, secure: true, sameSite: 'Lax' },
    ],
    injected: { gclid: 'abc', fbclid: 'def' },
    urlParams: { gclid: 'abc', fbclid: 'def' },
    cookies: {},
    ...overrides,
  };
}

/** Every rule_id that appears in both the layer breakdown and the issues list, with the two evidence strings side by side. */
function collectSharedRuleEvidence(
  journeyStages: JourneyStage[],
  issues: ReportIssue[],
): { rule_id: string; stageLabel: string; issueText: string }[] {
  const stageLabelByRule = new Map<string, string>();
  for (const stage of journeyStages) {
    for (const issue of stage.issues) {
      stageLabelByRule.set(issue.rule_id, issue.label);
    }
  }

  const shared: { rule_id: string; stageLabel: string; issueText: string }[] = [];
  for (const issue of issues) {
    const stageLabel = stageLabelByRule.get(issue.rule_id);
    if (stageLabel !== undefined) {
      shared.push({ rule_id: issue.rule_id, stageLabel, issueText: issue.why_it_matters });
    }
  }
  return shared;
}

describe('evidence consistency across report sections (PRD Issue 2 regression guard)', () => {
  const auditData = makeSparseAuditData();
  const results = runRegister(auditData);
  const journeyStages = buildV2LayerStages(results);
  const issues = interpretResults(results);

  it('exercises a meaningful number of failing rules — otherwise this guard would be checking nothing', () => {
    const shared = collectSharedRuleEvidence(journeyStages, issues);
    expect(shared.length).toBeGreaterThan(10);
  });

  it('every rule appearing in both the layer breakdown and the issues list has identical evidence in both places', () => {
    const shared = collectSharedRuleEvidence(journeyStages, issues);
    const mismatches = shared.filter((s) => s.stageLabel !== s.issueText);
    expect(mismatches).toEqual([]);
  });

  it('the comparison itself correctly flags a deliberately mismatched fixture — proves the guard above is not vacuous', () => {
    const mismatchedStages: JourneyStage[] = [
      { stage: 'L3 · Storage Durability', status: 'fail', issues: [{ rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW', label: 'gclid, gbraid, wbraid, _gcl_au, _gcl_aw, ttclid' }] },
    ];
    const mismatchedIssues: ReportIssue[] = [
      {
        rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW',
        validation_layer: 'storage_durability',
        severity: 'critical',
        problem: 'Storage lifetime does not meet attribution window',
        why_it_matters: 'gclid, fbclid, msclkid',
        recommended_owner: 'Frontend Developer',
        fix_summary: 'n/a',
        estimated_effort: 'low',
      },
    ];
    const shared = collectSharedRuleEvidence(mismatchedStages, mismatchedIssues);
    const mismatches = shared.filter((s) => s.stageLabel !== s.issueText);
    expect(mismatches).toEqual([
      { rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW', stageLabel: 'gclid, gbraid, wbraid, _gcl_au, _gcl_aw, ttclid', issueText: 'gclid, fbclid, msclkid' },
    ]);
  });
});
