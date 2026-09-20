import { describe, expect, it } from 'vitest';
import {
  computeAttributionChain,
  LINK_ORDER,
  REMEDY_TIER_BY_LINK,
  type ChainLink,
  type ComputeAttributionChainInput,
} from '../chainModel';

function basePreConnectionInput(overrides: Partial<ComputeAttributionChainInput> = {}): ComputeAttributionChainInput {
  return {
    scope: 'pre_connection',
    arrival: { verdict: 'PASS' },
    persistence: { verdict: 'PASS' },
    form_carriage: { verdict: 'PASS' },
    ...overrides,
  };
}

function basePostConnectionInput(overrides: Partial<ComputeAttributionChainInput> = {}): ComputeAttributionChainInput {
  return {
    scope: 'post_connection',
    arrival: { verdict: 'PASS' },
    persistence: { verdict: 'PASS' },
    form_carriage: { verdict: 'PASS' },
    crm_arrival: { verdict: 'PASS' },
    real_population: { verdict: 'PASS' },
    ...overrides,
  };
}

describe('computeAttributionChain — clean pass, no break', () => {
  it('resolves every link PASS with no break, no remedy tier, pre_connection scope', () => {
    const result = computeAttributionChain(basePreConnectionInput());

    expect(result.links).toEqual({
      arrival: 'PASS',
      persistence: 'PASS',
      form_carriage: 'PASS',
      crm_arrival: 'NOT_OBSERVED',
      real_population: 'NOT_OBSERVED',
    });
    expect(result.break_at).toBeNull();
    expect(result.break_evidence).toBe('');
    expect(result.remedy_tier).toBeNull();
    expect(result.not_observed_reason).toBeNull();
    expect(result.scope).toBe('pre_connection');
  });

  it('resolves every link PASS with no break, no remedy tier, post_connection scope', () => {
    const result = computeAttributionChain(basePostConnectionInput());

    expect(result.links).toEqual({
      arrival: 'PASS',
      persistence: 'PASS',
      form_carriage: 'PASS',
      crm_arrival: 'PASS',
      real_population: 'PASS',
    });
    expect(result.break_at).toBeNull();
    expect(result.remedy_tier).toBeNull();
    expect(result.scope).toBe('post_connection');
  });
});

describe('computeAttributionChain — pre_connection scope forcibly hides post-connection links', () => {
  it('forces crm_arrival/real_population to NOT_OBSERVED even if a caller mistakenly supplies them', () => {
    const result = computeAttributionChain(
      basePreConnectionInput({
        crm_arrival: { verdict: 'PASS' },
        real_population: { verdict: 'FAIL', evidence: 'should never be read' },
      }),
    );

    expect(result.links.crm_arrival).toBe('NOT_OBSERVED');
    expect(result.links.real_population).toBe('NOT_OBSERVED');
    expect(result.break_at).toBeNull();
  });
});

describe('computeAttributionChain — break-at permutations with cascade', () => {
  const breakCases: Array<{ link: ChainLink; input: ComputeAttributionChainInput }> = [
    {
      link: 'arrival',
      input: basePreConnectionInput({
        arrival: { verdict: 'FAIL', evidence: 'gclid absent from landing URL' },
      }),
    },
    {
      link: 'persistence',
      input: basePreConnectionInput({
        persistence: { verdict: 'FAIL', evidence: 'no durable storage write observed' },
      }),
    },
    {
      link: 'form_carriage',
      input: basePreConnectionInput({
        form_carriage: { verdict: 'FAIL', evidence: 'submit request carried no click-id value' },
      }),
    },
    {
      link: 'crm_arrival',
      input: basePostConnectionInput({
        crm_arrival: { verdict: 'FAIL', evidence: 'property absent on sampled records' },
      }),
    },
    {
      link: 'real_population',
      input: basePostConnectionInput({
        real_population: { verdict: 'FAIL', evidence: 'property present but empty on sampled records' },
      }),
    },
  ];

  for (const { link, input } of breakCases) {
    it(`breaks at ${link}: sets break_at, break_evidence, correct remedy_tier, and cascades every downstream link to NOT_OBSERVED`, () => {
      const result = computeAttributionChain(input);

      expect(result.break_at).toBe(link);
      expect(result.remedy_tier).toBe(REMEDY_TIER_BY_LINK[link]);
      expect(result.break_evidence.length).toBeGreaterThan(0);

      const breakIndex = LINK_ORDER.indexOf(link);
      for (let i = 0; i < LINK_ORDER.length; i++) {
        const l = LINK_ORDER[i];
        if (i < breakIndex) {
          expect(result.links[l]).toBe('PASS');
        } else if (i === breakIndex) {
          expect(result.links[l]).toBe('FAIL');
        } else {
          expect(result.links[l]).toBe('NOT_OBSERVED');
        }
      }
    });
  }

  it('never resolves a link downstream of a break as FAIL even if the caller supplied FAIL for it', () => {
    const result = computeAttributionChain(
      basePreConnectionInput({
        persistence: { verdict: 'FAIL', evidence: 'no capture tag' },
        form_carriage: { verdict: 'FAIL', evidence: 'this should be masked by the cascade' },
      }),
    );

    expect(result.break_at).toBe('persistence');
    expect(result.links.form_carriage).toBe('NOT_OBSERVED');
  });

  it('falls back to a generic evidence string when a FAIL observation supplies none', () => {
    const result = computeAttributionChain(basePreConnectionInput({ arrival: { verdict: 'FAIL' } }));

    expect(result.break_at).toBe('arrival');
    expect(result.break_evidence).toBe('The chain broke at arrival.');
  });
});

describe('computeAttributionChain — NOT_OBSERVED raw verdicts without a whole-scan reason', () => {
  it('a raw NOT_OBSERVED link before any FAIL does not itself trigger a break', () => {
    const result = computeAttributionChain(
      basePreConnectionInput({
        persistence: { verdict: 'NOT_OBSERVED', evidence: 'could not determine' },
        form_carriage: { verdict: 'FAIL', evidence: 'real break' },
      }),
    );

    expect(result.links.arrival).toBe('PASS');
    expect(result.links.persistence).toBe('NOT_OBSERVED');
    expect(result.links.form_carriage).toBe('FAIL');
    expect(result.break_at).toBe('form_carriage');
    expect(result.remedy_tier).toBe(REMEDY_TIER_BY_LINK.form_carriage);
  });

  it('produces a null break when every raw verdict is PASS or NOT_OBSERVED with no FAIL', () => {
    const result = computeAttributionChain(
      basePreConnectionInput({
        form_carriage: { verdict: 'NOT_OBSERVED', evidence: 'form never reached' },
      }),
    );

    expect(result.break_at).toBeNull();
    expect(result.remedy_tier).toBeNull();
    expect(result.links.form_carriage).toBe('NOT_OBSERVED');
  });
});

describe('computeAttributionChain — not_observed_reason overrides everything', () => {
  it('no_paid_traffic forces every link to NOT_OBSERVED with no break and no remedy, regardless of supplied link verdicts', () => {
    const result = computeAttributionChain(
      basePostConnectionInput({
        not_observed_reason: 'no_paid_traffic',
        arrival: { verdict: 'FAIL', evidence: 'should be fully ignored' },
        crm_arrival: { verdict: 'FAIL', evidence: 'should also be ignored' },
      }),
    );

    expect(result.links).toEqual({
      arrival: 'NOT_OBSERVED',
      persistence: 'NOT_OBSERVED',
      form_carriage: 'NOT_OBSERVED',
      crm_arrival: 'NOT_OBSERVED',
      real_population: 'NOT_OBSERVED',
    });
    expect(result.break_at).toBeNull();
    expect(result.break_evidence).toBe('');
    expect(result.remedy_tier).toBeNull();
    expect(result.not_observed_reason).toBe('no_paid_traffic');
  });

  it('no_conversion_surface forces every link to NOT_OBSERVED with no break and no remedy', () => {
    const result = computeAttributionChain(
      basePreConnectionInput({
        not_observed_reason: 'no_conversion_surface',
        arrival: { verdict: 'PASS' },
        persistence: { verdict: 'PASS' },
        form_carriage: { verdict: 'FAIL', evidence: 'should be fully ignored' },
      }),
    );

    expect(result.links).toEqual({
      arrival: 'NOT_OBSERVED',
      persistence: 'NOT_OBSERVED',
      form_carriage: 'NOT_OBSERVED',
      crm_arrival: 'NOT_OBSERVED',
      real_population: 'NOT_OBSERVED',
    });
    expect(result.break_at).toBeNull();
    expect(result.remedy_tier).toBeNull();
    expect(result.not_observed_reason).toBe('no_conversion_surface');
  });

  it('preserves the scope on a not_observed_reason result', () => {
    const result = computeAttributionChain(
      basePostConnectionInput({ not_observed_reason: 'no_paid_traffic' }),
    );

    expect(result.scope).toBe('post_connection');
  });

  it('treats a null not_observed_reason the same as an absent one (no override)', () => {
    const result = computeAttributionChain(basePreConnectionInput({ not_observed_reason: null }));

    expect(result.not_observed_reason).toBeNull();
    expect(result.links.arrival).toBe('PASS');
  });
});

describe('computeAttributionChain — remedy tier mapping stays in LINK_ORDER lockstep', () => {
  it('every link maps to a distinct tier matching its position in LINK_ORDER', () => {
    LINK_ORDER.forEach((link, index) => {
      expect(REMEDY_TIER_BY_LINK[link]).toBe(index + 1);
    });
  });
});
