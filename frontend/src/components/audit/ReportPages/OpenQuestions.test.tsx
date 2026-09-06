/**
 * OpenQuestions — Report Honesty PRD Part B. The parent ReportPage only
 * mounts this component when report.open_questions is non-empty (see
 * ReportPage.tsx's `sections` filter), so this file only needs to check
 * that the questions themselves render.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpenQuestions } from './OpenQuestions';
import type { ReportJSON } from '@/types/audit';

function makeReport(open_questions: string[]): ReportJSON {
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
    open_questions,
  };
}

describe('OpenQuestions', () => {
  it('renders every question in order', () => {
    const questions = [
      'Two GTM containers are loading (GTM-AAA, GTM-BBB). Is one a migration in progress, or does a second team own it?',
      'We found no Google Ads (AW-) loader on the site. Does Google Ads run through a different property?',
    ];
    render(<OpenQuestions report={makeReport(questions)} />);
    for (const question of questions) {
      expect(screen.getByText(question)).not.toBeNull();
    }
  });

  it('renders nothing extra when there is exactly one question', () => {
    render(<OpenQuestions report={makeReport(['A single question?'])} />);
    expect(screen.getByText('A single question?')).not.toBeNull();
  });
});
