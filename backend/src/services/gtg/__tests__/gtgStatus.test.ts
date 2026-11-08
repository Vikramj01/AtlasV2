import { describe, it, expect } from 'vitest';
import {
  GTG_STATUSES,
  aggregateGtgStatus,
  gtgNeedsActionFlags,
  isGtgActive,
  normaliseGtgStatus,
  shouldCapScore,
  type GtgStatus,
} from '../gtgStatus';

describe('normaliseGtgStatus', () => {
  it('passes through every known status', () => {
    for (const s of GTG_STATUSES) expect(normaliseGtgStatus(s)).toBe(s);
  });
  it('coerces missing or unrecognised values to unknown, never guessing', () => {
    expect(normaliseGtgStatus(undefined)).toBe('unknown');
    expect(normaliseGtgStatus(null)).toBe('unknown');
    expect(normaliseGtgStatus('active')).toBe('unknown');
    expect(normaliseGtgStatus(true)).toBe('unknown');
  });
});

describe('isGtgActive', () => {
  it('is true only for verified and verified_no_geo', () => {
    const active = GTG_STATUSES.filter(isGtgActive);
    expect(active).toEqual(['verified', 'verified_no_geo']);
  });
});

describe('shouldCapScore (PRD D1)', () => {
  it('caps only not_detected and broken', () => {
    const capped = GTG_STATUSES.filter(shouldCapScore);
    expect(capped).toEqual(['broken', 'not_detected'].sort((a, b) => GTG_STATUSES.indexOf(a as GtgStatus) - GTG_STATUSES.indexOf(b as GtgStatus)));
  });
  it('never caps unknown or not_applicable', () => {
    expect(shouldCapScore('unknown')).toBe(false);
    expect(shouldCapScore('not_applicable')).toBe(false);
  });
});

describe('gtgNeedsActionFlags', () => {
  it('raises gtg_not_deployed only for not_detected', () => {
    expect(gtgNeedsActionFlags('not_detected')).toEqual(['gtg_not_deployed']);
    expect(gtgNeedsActionFlags('unknown')).toEqual([]);
    expect(gtgNeedsActionFlags('not_applicable')).toEqual([]);
  });
  it('raises the new flags', () => {
    expect(gtgNeedsActionFlags('broken')).toEqual(['gtg_broken']);
    expect(gtgNeedsActionFlags('verified_no_geo')).toEqual(['gtg_geo_missing']);
    expect(gtgNeedsActionFlags('partial')).toEqual(['gtg_partial']);
  });
  it('raises nothing for verified', () => {
    expect(gtgNeedsActionFlags('verified')).toEqual([]);
  });
});

describe('aggregateGtgStatus', () => {
  it('is unknown with no clients or only unknown clients', () => {
    expect(aggregateGtgStatus([])).toBe('unknown');
    expect(aggregateGtgStatus(['unknown', 'unknown'])).toBe('unknown');
  });
  it('ignores unknown clients once one has a known status', () => {
    expect(aggregateGtgStatus(['unknown', 'verified'])).toBe('verified');
    expect(aggregateGtgStatus(['unknown', 'not_detected'])).toBe('not_detected');
  });
  it('is not_applicable when every known client is not_applicable', () => {
    expect(aggregateGtgStatus(['not_applicable', 'unknown'])).toBe('not_applicable');
  });
  it('excludes not_applicable clients from the decision', () => {
    expect(aggregateGtgStatus(['not_applicable', 'not_detected'])).toBe('not_detected');
  });
  it('any broken client makes the org broken', () => {
    expect(aggregateGtgStatus(['verified', 'broken', 'not_detected'])).toBe('broken');
  });
  it('returns the shared status when applicable clients agree', () => {
    expect(aggregateGtgStatus(['not_detected', 'not_detected'])).toBe('not_detected');
    expect(aggregateGtgStatus(['verified', 'verified'])).toBe('verified');
  });
  it('mixed verified and verified_no_geo is verified_no_geo', () => {
    expect(aggregateGtgStatus(['verified', 'verified_no_geo'])).toBe('verified_no_geo');
  });
  it('mixed deployed and not deployed is partial, which does not cap', () => {
    const s = aggregateGtgStatus(['verified', 'not_detected']);
    expect(s).toBe('partial');
    expect(shouldCapScore(s)).toBe(false);
  });
});
