import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyMetricsRow } from './KeyMetricsRow';
import { normaliseGtgStatus, gtgTone } from '@/lib/gtgStatus';
import type { HealthScore } from '@/types/health';

function score(over: Partial<HealthScore>): HealthScore {
  return {
    id: 's', user_id: 'u', website_url: null, overall_score: 80, signal_health: 80,
    capi_delivery_rate: 90, consent_coverage: 100, tag_firing_rate: 80,
    platform_acceptance_score: null, gtg_active: false, gtg_status: 'unknown',
    dma_coverage_score: null, last_audit_id: null, last_audit_at: null,
    computed_at: '', created_at: '', ...over,
  };
}

describe('KeyMetricsRow GTG cell', () => {
  it('never claims an uplift figure, whatever the status', () => {
    for (const gtg_status of ['verified', 'verified_no_geo', 'unknown', 'not_detected'] as const) {
      const { container, unmount } = render(<KeyMetricsRow score={score({ gtg_status, gtg_active: gtg_status === 'verified' })} />);
      expect(container.textContent).not.toMatch(/11\s*%|uplift/i);
      unmount();
    }
  });

  it('shows Verified for a verified gateway', () => {
    render(<KeyMetricsRow score={score({ gtg_status: 'verified', gtg_active: true })} />);
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('does not show a legacy GTM-connection boolean as Active (AC 1)', () => {
    render(<KeyMetricsRow score={score({ gtg_active: true, gtg_status: null, consent_coverage: 0 })} />); // consent 0 so its own 'Active' label is absent
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByText('Not checked')).toBeTruthy();
  });

  it('shows Not detected only for an observed absence', () => {
    render(<KeyMetricsRow score={score({ gtg_status: 'not_detected' })} />);
    expect(screen.getByText('Not detected')).toBeTruthy();
  });
});

describe('gtgStatus helpers', () => {
  it('normalises junk to unknown', () => {
    expect(normaliseGtgStatus('toString')).toBe('unknown');
    expect(normaliseGtgStatus(undefined)).toBe('unknown');
  });
  it('unknown is neutral, not a warning', () => {
    expect(gtgTone('unknown')).toBe('neutral');
  });
});
