import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WithAccess } from './WithAccess';
import type { ReportJSON, WithAccessEntry } from '@/types/audit';

function makeReport(with_access?: WithAccessEntry[]): ReportJSON {
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
    with_access,
  };
}

describe('WithAccess', () => {
  it('renders the check name, required connections (read-only), and what it reveals', () => {
    const entry: WithAccessEntry = {
      check: 'Platform reconciliation',
      requires_connection: ['google_ads', 'meta'],
      answers_question_for: ['DECLARED_PLATFORM_HAS_TAG'],
      reveals: 'Whether platform-reported conversions match what this scan observed.',
    };
    render(<WithAccess report={makeReport([entry])} />);
    expect(screen.getByText('Platform reconciliation')).not.toBeNull();
    expect(screen.getByText(/Google Ads, Meta \(read-only\)/)).not.toBeNull();
    expect(screen.getByText(entry.reveals)).not.toBeNull();
  });

  it('renders no entries when with_access is absent', () => {
    render(<WithAccess report={makeReport(undefined)} />);
    expect(screen.getByText('With Access — What a Connected Scan Adds')).not.toBeNull();
    expect(screen.queryByText('Platform reconciliation')).toBeNull();
  });
});
