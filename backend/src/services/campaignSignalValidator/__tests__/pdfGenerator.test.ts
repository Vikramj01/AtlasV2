/**
 * Smoke tests for generateSignalValidatorPdf — this module had no test
 * coverage at all before the Attribution Chain Check PRD's Sprint 4 added
 * the chain section, matching every other file in this directory
 * (orchestrator.ts/eventVerdict.ts/checkoutService.ts are likewise
 * untested). Scoped to what Sprint 4 actually touched: proving the PDF
 * still generates cleanly with and without a chain result, and that the
 * chain copy embedded in it passes the banned-token lint — not a full
 * pdfkit layout test suite disproportionate to this module's existing
 * coverage.
 */
import { describe, expect, it } from 'vitest';
import { generateSignalValidatorPdf } from '../pdfGenerator';
import type { EventVerdict } from '../eventVerdict';
import { buildChainCopy } from '@/services/attribution/chainCopy';
import { lintChainCopy } from '@/services/attribution/chainCopyLint';
import type { AttributionChainResult } from '@/services/attribution/chainModel';

function baseVerdict(overrides: Partial<EventVerdict> = {}): EventVerdict {
  return {
    rating: 'moderate',
    score: 55,
    ai_max_risk: 'medium',
    reasons: [{ code: 'NO_GTM_DETECTED', severity: 'high', headline: 'No tag manager detected', detail: 'detail text' }],
    remediation: ['Install GTM.'],
    summary: 'Found 1 issue.',
    ...overrides,
  };
}

describe('generateSignalValidatorPdf', () => {
  it('generates a non-empty PDF buffer with no chain result at all', async () => {
    const buf = await generateSignalValidatorPdf({ url: 'https://example.com', verdict: baseVerdict(), generatedAt: new Date('2026-09-20') });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('generates a non-empty PDF buffer with a clean (break_at: null) chain result', async () => {
    const chain: AttributionChainResult = {
      links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
      break_at: null,
      break_evidence: '',
      remedy_tier: null,
      not_observed_reason: null,
      scope: 'pre_connection',
    };
    const buf = await generateSignalValidatorPdf({ url: 'https://example.com', verdict: baseVerdict({ attribution_chain: chain }), generatedAt: new Date('2026-09-20') });
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generates a non-empty PDF buffer with a broken chain result (remedy section)', async () => {
    const chain: AttributionChainResult = {
      links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'FAIL', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
      break_at: 'form_carriage',
      break_evidence: 'The form submission fired 1 request(s) to www.example.com, but none carried the click id captured at arrival.',
      remedy_tier: 3,
      not_observed_reason: null,
      scope: 'pre_connection',
    };
    const buf = await generateSignalValidatorPdf({ url: 'https://example.com', verdict: baseVerdict({ attribution_chain: chain }), generatedAt: new Date('2026-09-20') });
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generates a non-empty PDF buffer for both not_observed_reason states', async () => {
    for (const reason of ['no_paid_traffic', 'no_conversion_surface'] as const) {
      const chain: AttributionChainResult = {
        links: { arrival: 'NOT_OBSERVED', persistence: 'NOT_OBSERVED', form_carriage: 'NOT_OBSERVED', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
        break_at: null,
        break_evidence: '',
        remedy_tier: null,
        not_observed_reason: reason,
        scope: 'pre_connection',
      };
      const buf = await generateSignalValidatorPdf({ url: 'https://example.com', verdict: baseVerdict({ attribution_chain: chain }), generatedAt: new Date('2026-09-20') });
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  it('the chain copy this PDF renders passes the shared banned-token lint for a representative break', () => {
    const chain: AttributionChainResult = {
      links: { arrival: 'PASS', persistence: 'FAIL', form_carriage: 'NOT_OBSERVED', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
      break_at: 'persistence',
      break_evidence: 'The click id for google_ads reached the landing page but was never read into storage, a cookie, or the dataLayer.',
      remedy_tier: 2,
      not_observed_reason: null,
      scope: 'pre_connection',
    };
    const copy = buildChainCopy(chain);
    const violations = lintChainCopy([copy.headline, copy.body, copy.remedy?.typical_cause ?? '', copy.remedy?.shape_of_work ?? '']);
    expect(violations).toEqual([]);
  });
});
