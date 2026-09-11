/**
 * ExecutiveSummary — coverage banner render tests (Site Evaluation Coverage
 * & Honesty PRD §6.4). Plain DOM assertions, not jest-dom matchers — see
 * EvaluateSiteCard.test.tsx's docstring for why.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutiveSummary } from './ExecutiveSummary';
import type { ReportJSON, ReportCoverage } from '@/types/audit';

function makeReport(coverage?: ReportCoverage): ReportJSON {
  return {
    audit_id: 'audit-1',
    website_url: 'https://shop.example.com',
    generated_at: new Date().toISOString(),
    executive_summary: {
      overall_status: 'partially_broken',
      business_summary: 'Some signals are working.',
      scores: {
        conversion_signal_health: 55,
        attribution_risk_level: 'Medium',
        optimization_strength: 'Moderate',
        data_consistency_score: 'Medium',
      },
      coverage,
    },
    journey_stages: [],
    platform_breakdown: [],
    issues: [],
    site_setup: {
      generated_at: new Date().toISOString(),
      datalayer_inventory: [],
      tags: [],
      gtm_container: { detected: false, container_ids: [], connected_container_id: null, ids_match: null },
      possible_server_side_gtm: { detected: false, confidence: 'low', candidate_hosts: [], matched_heuristics: [], evidence_urls: [], caveat: '' },
    },
    technical_appendix: { validation_results: [], raw_network_requests: [], raw_datalayer_events: [] },
  };
}

describe('ExecutiveSummary — coverage banner', () => {
  it('renders no banner when coverage is undefined', () => {
    render(<ExecutiveSummary report={makeReport(undefined)} />);
    expect(screen.queryByText('Limited scan coverage')).toBeNull();
  });

  it('renders no banner when pages_distinct equals pages_requested (full coverage)', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 4,
      steps: [],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: false,
      degraded_steps: [],
      run_quality: 'COMPLETE',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Limited scan coverage')).toBeNull();
  });

  it('renders the banner with page counts and not-tested layers when coverage is partial', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 1,
      steps: [],
      layers_not_tested: [
        { layer: 'event_firing', label: 'Event Firing', reason: 'x', state: 'not_scanned' },
        { layer: 'parameter_completeness', label: 'Parameter Completeness', reason: 'x', state: 'not_scanned' },
      ],
      rules_tested: 41,
      rules_not_tested: 42,
      partial: false,
      degraded_steps: [],
      run_quality: 'COMPLETE',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Limited scan coverage')).not.toBeNull();
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toContain('1 of 4 requested pages');
    expect(banner.textContent).toContain('Event Firing, Parameter Completeness');
    expect(banner.textContent).toContain('42 checks were skipped');
  });

  // Report Correctness Programme PRD Part D2 — "not applicable" must be
  // visibly distinct from "not scanned": a not_applicable layer must never
  // appear inside the alarming "Limited scan coverage" warning, and must
  // never trigger that warning on its own.
  it('renders a separate, non-alarming disclosure for not_applicable layers, never inside the Limited scan coverage warning', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 4, // full page coverage — nothing "limited" here
      steps: [],
      layers_not_tested: [
        { layer: 'cross_domain_continuity', label: 'Cross-Domain Continuity', reason: 'x', state: 'not_applicable' },
      ],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: false,
      degraded_steps: [],
      run_quality: 'COMPLETE',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Limited scan coverage')).toBeNull(); // not_applicable alone never triggers the warning
    expect(screen.getByText(/Not applicable to this site/).textContent).toContain('Cross-Domain Continuity');
  });

  it('separates not_scanned (inside the warning) from not_applicable (outside it) when both are present', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 1,
      steps: [],
      layers_not_tested: [
        { layer: 'event_firing', label: 'Event Firing', reason: 'x', state: 'not_scanned' },
        { layer: 'cross_domain_continuity', label: 'Cross-Domain Continuity', reason: 'x', state: 'not_applicable' },
      ],
      rules_tested: 41,
      rules_not_tested: 42,
      partial: false,
      degraded_steps: [],
      run_quality: 'COMPLETE',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toContain('Event Firing');
    expect(banner.textContent).not.toContain('Cross-Domain Continuity');
    expect(screen.getByText(/Not applicable to this site/).textContent).toContain('Cross-Domain Continuity');
  });

  it('renders no fabricated layer/rule copy when coverage is partial but every layer was still exercised', () => {
    const coverage: ReportCoverage = {
      pages_requested: 2,
      pages_distinct: 1,
      steps: [],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: false,
      degraded_steps: [],
      run_quality: 'COMPLETE',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toBe('This scan examined 1 of 2 requested pages.');
  });

  // Platform Attribution & Determinism PRD B-W3 — a scan that reached every
  // page can still not have fully settled on one of them.
  it('renders the banner for a settle-partial run even when every page was reached', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 4,
      steps: [],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: true,
      degraded_steps: ['confirmation'],
      run_quality: 'PROVISIONAL',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Limited scan coverage')).not.toBeNull();
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toContain("didn't fully settle on 1 step (confirmation)");
  });

  // Pre-Connection Scan Confidence Tiering PRD §7.3 — an INSUFFICIENT run
  // gets its own prominent, distinct notice ahead of the ordinary "Limited
  // scan coverage" banner.
  it('renders the Insufficient run quality notice when run_quality is INSUFFICIENT', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 1,
      steps: [],
      layers_not_tested: [],
      rules_tested: 10,
      rules_not_tested: 73,
      partial: true,
      degraded_steps: ['checkout'],
      run_quality: 'INSUFFICIENT',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Insufficient run quality — export blocked')).not.toBeNull();
  });

  it('does not render the Insufficient run quality notice for a PROVISIONAL run', () => {
    const coverage: ReportCoverage = {
      pages_requested: 4,
      pages_distinct: 4,
      steps: [],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
      partial: true,
      degraded_steps: ['confirmation'],
      run_quality: 'PROVISIONAL',
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Insufficient run quality — export blocked')).toBeNull();
  });
});

// Scoring & Coverage Gate PRD §9.1.5/§9.2 — a withheld overall score
// renders as a dedicated panel, and each withheld sub-score renders "Not
// assessed" rather than a fabricated default label.
describe('ExecutiveSummary — Coverage Gate', () => {
  it('renders the Coverage Gate panel and "Not assessed" when the overall score is withheld', () => {
    const report = makeReport();
    report.executive_summary.scores = {
      conversion_signal_health: null,
      score_withheld_reason: 'INSUFFICIENT_LAYER_COVERAGE',
      attribution_risk_level: 'Medium',
      optimization_strength: 'Moderate',
      data_consistency_score: 'Medium',
      conversion_signal_health_coverage: { layers_tested: 5, layers_total: 13 },
    };
    render(<ExecutiveSummary report={report} />);
    expect(screen.queryByText('Coverage Gate — Signal Health score withheld')).not.toBeNull();
    const panel = screen.getByText(/This scan assessed/);
    expect(panel.textContent).toContain('5 of 13 signal layers');
    expect(screen.getByText('Not assessed')).not.toBeNull();
  });

  it('renders no Coverage Gate panel when the overall score is present', () => {
    render(<ExecutiveSummary report={makeReport()} />);
    expect(screen.queryByText('Coverage Gate — Signal Health score withheld')).toBeNull();
  });

  it('renders "Not assessed" for a withheld sub-score without withholding the overall score or panel', () => {
    const report = makeReport();
    report.executive_summary.scores = {
      conversion_signal_health: 55,
      attribution_risk_level: null,
      optimization_strength: 'Moderate',
      data_consistency_score: 'Medium',
      attribution_risk_coverage: { layers_tested: 0, layers_total: 2 },
    };
    render(<ExecutiveSummary report={report} />);
    expect(screen.queryByText('Coverage Gate — Signal Health score withheld')).toBeNull();
    expect(screen.getByText('Not assessed')).not.toBeNull();
    expect(screen.getByText('55 / 100')).not.toBeNull();
  });
});
