import { describe, expect, it } from 'vitest';
import { buildChainCopy, allChainCopyVariants } from '../chainCopy';
import { lintChainCopy } from '../chainCopyLint';
import type { AttributionChainResult } from '../chainModel';

function baseChain(overrides: Partial<AttributionChainResult> = {}): AttributionChainResult {
  return {
    links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
    break_at: null,
    break_evidence: '',
    remedy_tier: null,
    not_observed_reason: null,
    scope: 'pre_connection',
    ...overrides,
  };
}

describe('buildChainCopy — not_observed_reason', () => {
  it('renders a neutral, distinct headline for no_paid_traffic', () => {
    const copy = buildChainCopy(baseChain({ not_observed_reason: 'no_paid_traffic' }));
    expect(copy.headline).toMatch(/not yet exercised/i);
    expect(copy.remedy).toBeUndefined();
    expect(copy.unverified_note).toBeUndefined();
  });

  it('renders a distinct headline for no_conversion_surface', () => {
    const copy = buildChainCopy(baseChain({ not_observed_reason: 'no_conversion_surface' }));
    expect(copy.headline).toMatch(/no lead-gen form reached/i);
  });
});

describe('buildChainCopy — clean result (break_at: null)', () => {
  it('states explicitly that Links 4-5 remain unverified pre-connection', () => {
    const copy = buildChainCopy(baseChain());
    expect(copy.break_at as unknown).toBeUndefined();
    expect(copy.unverified_note).toMatch(/CRM arrival and real population/);
    expect(copy.unverified_note).toMatch(/unverified/);
    expect(copy.remedy).toBeUndefined();
  });
});

describe('buildChainCopy — break cases', () => {
  it('names the break link in the headline and includes the remedy shape, never a price', () => {
    const copy = buildChainCopy(baseChain({
      break_at: 'form_carriage',
      break_evidence: 'The form submission fired 1 request(s) to www.example.com, but none carried the click id captured at arrival.',
      remedy_tier: 3,
    }));
    expect(copy.headline).toMatch(/Form carriage/);
    expect(copy.body).toBe('The form submission fired 1 request(s) to www.example.com, but none carried the click id captured at arrival.');
    expect(copy.remedy?.label).toMatch(/Tier 3/);
    expect(copy.remedy?.shape_of_work).not.toMatch(/\$\d/);
    expect(copy.remedy?.typical_cause).toBeTruthy();
  });

  it('never renders a percentage anywhere in any branch', () => {
    for (const text of allChainCopyVariants()) {
      expect(text).not.toMatch(/\d+%/);
      expect(text).not.toMatch(/\d+\/\d+/);
    }
  });
});

describe('lintChainCopy / outputLint discipline', () => {
  it('every copy variant this module can produce passes the shared banned-token lint', () => {
    const violations = lintChainCopy(allChainCopyVariants());
    expect(violations).toEqual([]);
  });

  it('lintChainCopy actually catches a banned token when one is present (proves the check is live)', () => {
    const violations = lintChainCopy(['This tag is Missing from the page.']);
    expect(violations).toEqual([{ text: 'This tag is Missing from the page.', token: 'Missing' }]);
  });

  it('is case-insensitive', () => {
    expect(lintChainCopy(['this feature is broken today'])).toHaveLength(1);
  });
});
