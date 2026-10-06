import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgainstConnectedPlatforms } from './AgainstConnectedPlatforms';
import type { ReportJSON, ReconciliationDisclosure } from '@/types/audit';

const disclosure = (over: Partial<ReconciliationDisclosure> = {}): ReconciliationDisclosure => ({
  run_completed_at: '2026-10-05T10:00:00Z',
  run_age_days: 1,
  stale: false,
  notice: 'These observations describe your connected ad platforms, not this scan.',
  items: [
    { rule_id: 'A', label: 'Connected platforms are aligned', outcome: 'flagged', severity: 'high', summary: '1 unresolved alignment gap', details: ['GA4 property 123 does not list a Google Ads link.'] },
    { rule_id: 'B', label: 'Delivery is healthy', outcome: 'clear', severity: 'high', summary: 'No unresolved delivery findings observed', details: [] },
  ],
  context_notes: ['A shared Google tag is one candidate explanation for differences between GA4 and Google Ads figures.'],
  ...over,
});

const report = (d?: ReconciliationDisclosure) => ({ reconciliation_disclosure: d }) as unknown as ReportJSON;

describe('AgainstConnectedPlatforms', () => {
  it('renders nothing when there is no disclosure — never an empty heading', () => {
    const { container } = render(<AgainstConnectedPlatforms report={report()} />);
    expect(container.textContent).toBe('');
  });

  it('renders the notice, each item with its outcome and details, and the context notes', () => {
    render(<AgainstConnectedPlatforms report={report(disclosure())} />);
    expect(screen.getByText('Against Your Connected Platforms')).not.toBeNull();
    expect(screen.getByText(/not this scan/)).not.toBeNull();
    expect(screen.getByText('Needs attention')).not.toBeNull();
    expect(screen.getByText('Nothing unresolved observed')).not.toBeNull();
    expect(screen.getByText('GA4 property 123 does not list a Google Ads link.')).not.toBeNull();
    expect(screen.getByText(/one candidate explanation/)).not.toBeNull();
  });

  it('notes a stale run', () => {
    render(<AgainstConnectedPlatforms report={report(disclosure({ stale: true, run_age_days: 12 }))} />);
    expect(screen.getByText(/older than a week/)).not.toBeNull();
  });

  it('omits the Context box when there are no context notes', () => {
    render(<AgainstConnectedPlatforms report={report(disclosure({ context_notes: [] }))} />);
    expect(screen.queryByText('Context')).toBeNull();
  });
});
