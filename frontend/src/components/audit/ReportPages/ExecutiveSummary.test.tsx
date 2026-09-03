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
        { layer: 'event_firing', label: 'Event Firing', reason: 'x' },
        { layer: 'parameter_completeness', label: 'Parameter Completeness', reason: 'x' },
      ],
      rules_tested: 41,
      rules_not_tested: 42,
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    expect(screen.queryByText('Limited scan coverage')).not.toBeNull();
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toContain('1 of 4 requested pages');
    expect(banner.textContent).toContain('Event Firing, Parameter Completeness');
    expect(banner.textContent).toContain('42 checks were skipped');
  });

  it('renders no fabricated layer/rule copy when coverage is partial but every layer was still exercised', () => {
    const coverage: ReportCoverage = {
      pages_requested: 2,
      pages_distinct: 1,
      steps: [],
      layers_not_tested: [],
      rules_tested: 83,
      rules_not_tested: 0,
    };
    render(<ExecutiveSummary report={makeReport(coverage)} />);
    const banner = screen.getByText(/This scan examined/);
    expect(banner.textContent).toBe('This scan examined 1 of 2 requested pages.');
  });
});
