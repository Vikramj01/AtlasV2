import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotAssessed } from './NotAssessed';
import type { ReportJSON, UnassessableFinding } from '@/types/audit';

function makeReport(could_not_be_assessed?: UnassessableFinding[]): ReportJSON {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    generated_at: new Date().toISOString(),
    executive_summary: {
      overall_status: 'partially_broken',
      business_summary: 'Some signals are working.',
      scores: { conversion_signal_health: 55, attribution_risk_level: 'Medium', optimization_strength: 'Moderate', data_consistency_score: 'Medium' },
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
    could_not_be_assessed,
  };
}

describe('NotAssessed', () => {
  it('renders each finding\'s rule_id (underscores replaced) and reason', () => {
    const finding: UnassessableFinding = {
      rule_id: 'JAVASCRIPT_ERRORS_ON_CONVERSION_SURFACE',
      step: 'onboarding',
      reason: 'The scan could not reach "onboarding" and used the landing page instead.',
    };
    render(<NotAssessed report={makeReport([finding])} />);
    expect(screen.getByText('JAVASCRIPT ERRORS ON CONVERSION SURFACE')).not.toBeNull();
    expect(screen.getByText(finding.reason)).not.toBeNull();
  });

  it('renders no list items when could_not_be_assessed is absent', () => {
    const { container } = render(<NotAssessed report={makeReport(undefined)} />);
    expect(screen.getByText('Not Assessed, and Why')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
