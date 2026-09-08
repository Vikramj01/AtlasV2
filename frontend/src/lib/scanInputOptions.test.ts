/**
 * ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part B (B-W5) — covers the two behaviors
 * the traffic-region picker change depends on: the combined "EEA /
 * Switzerland" chip expanding into both underlying values, and a
 * pre-existing audit's now-removed 'brazil' region rendering a label
 * instead of throwing.
 */
import { describe, it, expect } from 'vitest';
import { expandTrafficRegionSelection, getTrafficRegionLabel, TRAFFIC_REGION_OPTIONS } from './scanInputOptions';
import type { TrafficRegion } from '@/types/audit';

describe('expandTrafficRegionSelection', () => {
  it('adds switzerland when eea is newly selected', () => {
    const result = expandTrafficRegionSelection(['us'], ['us', 'eea']);
    expect(result).toEqual(expect.arrayContaining(['us', 'eea', 'switzerland']));
    expect(result).toHaveLength(3);
  });

  it('removes switzerland when eea is deselected', () => {
    const result = expandTrafficRegionSelection(['eea', 'switzerland', 'us'], ['us']);
    expect(result).toEqual(['us']);
  });

  it('leaves an unrelated toggle untouched', () => {
    const result = expandTrafficRegionSelection(['us'], ['us', 'uk']);
    expect(result).toEqual(['us', 'uk']);
  });

  it('does not re-add switzerland on an unrelated change once eea is already selected', () => {
    const result = expandTrafficRegionSelection(['eea', 'switzerland'], ['eea', 'switzerland', 'uk']);
    expect(result).toEqual(['eea', 'switzerland', 'uk']);
  });
});

describe('getTrafficRegionLabel', () => {
  it('resolves a known region to its picker label', () => {
    expect(getTrafficRegionLabel('eea')).toBe('EEA / Switzerland');
    expect(getTrafficRegionLabel('singapore')).toBe('Singapore');
    expect(getTrafficRegionLabel('gcc')).toBe('UAE / GCC');
  });

  it('falls back to the raw value for a stored region no longer in the picker (brazil)', () => {
    expect(getTrafficRegionLabel('brazil')).toBe('brazil');
  });
});

describe('TRAFFIC_REGION_OPTIONS', () => {
  it('no longer offers a standalone Brazil or Switzerland chip', () => {
    const values = TRAFFIC_REGION_OPTIONS.map((o) => o.value as TrafficRegion | 'brazil');
    expect(values).not.toContain('brazil');
    expect(values).not.toContain('switzerland');
  });

  it('offers Singapore and UAE/GCC', () => {
    const values = TRAFFIC_REGION_OPTIONS.map((o) => o.value);
    expect(values).toContain('singapore');
    expect(values).toContain('gcc');
  });
});
