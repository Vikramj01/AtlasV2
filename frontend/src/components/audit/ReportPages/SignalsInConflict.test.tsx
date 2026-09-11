import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignalsInConflict } from './SignalsInConflict';
import type { ReportJSON, SignalConflict } from '@/types/audit';

function makeReport(signal_conflicts?: SignalConflict[]): ReportJSON {
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
    signal_conflicts,
  };
}

describe('SignalsInConflict', () => {
  it('renders the entity and both readings for a conflict', () => {
    const conflict: SignalConflict = {
      assertion_id: 'CONF_01',
      entity: 'GA4',
      source_a: 'DL',
      reading_a: "gtag('config', 'G-XXXX') observed in dataLayer",
      source_b: 'NET',
      reading_b: 'GA4_CONFIG_TAG_PRESENT found no collect request',
      affected_rule_ids: ['GA4_CONFIG_TAG_PRESENT'],
    };
    render(<SignalsInConflict report={makeReport([conflict])} />);
    expect(screen.getByText('GA4')).not.toBeNull();
    expect(screen.getByText(/gtag\('config', 'G-XXXX'\) observed in dataLayer/)).not.toBeNull();
    expect(screen.getByText(/found no collect request/)).not.toBeNull();
  });

  it('renders no conflict rows when signal_conflicts is absent', () => {
    render(<SignalsInConflict report={makeReport(undefined)} />);
    expect(screen.getByText('Signals in Conflict')).not.toBeNull();
    expect(screen.queryByText('GA4')).toBeNull();
  });
});
