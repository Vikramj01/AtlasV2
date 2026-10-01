import { describe, it, expect } from 'vitest';
import {
  computeTopologyVerdict,
  destinationOfHit,
  extractGoogleTagObservation,
  observationToRows,
  type TopologyRow,
} from '../googleTagTopology';

const GTAG = (id: string) => ({ url: `https://www.googletagmanager.com/gtag/js?id=${id}&l=dataLayer` });
const GA4_HIT = (id: string) => ({ url: `https://region1.google-analytics.com/g/collect?v=2&tid=${id}&en=page_view` });
const ADS_HIT = (n: string) => ({ url: `https://www.googleadservices.com/pagead/conversion/${n}/?label=x` });

describe('destinationOfHit', () => {
  it('reads a GA4 collect tid and an Ads conversion id', () => {
    expect(destinationOfHit(GA4_HIT('G-ABC').url)).toBe('G-ABC');
    expect(destinationOfHit(ADS_HIT('123456789').url)).toBe('AW-123456789');
    expect(destinationOfHit('https://example.com/x')).toBeNull();
    expect(destinationOfHit('not a url')).toBeNull();
  });
});

describe('extractGoogleTagObservation / observationToRows', () => {
  it('split: each destination has its own loaded tag → self-attributed, not inferred', () => {
    const obs = extractGoogleTagObservation([GTAG('G-ABC'), GTAG('AW-111111'), GA4_HIT('G-ABC'), ADS_HIT('111111')]);
    expect(obs.unattributed_destination_ids).toEqual([]);
    expect(obs.attributed).toHaveLength(2);
    const rows = observationToRows(obs);
    expect(rows.every((r) => r.destination_ids.length === 1 && !r.inferred)).toBe(true);
    expect(computeTopologyVerdict(rows)).toMatchObject({ verdict: 'SPLIT', strength: 'observed' });
  });

  it('combined hint: one loader (G-) but hits to an AW- ID → inferred, never stronger than "assumed"', () => {
    const obs = extractGoogleTagObservation([GTAG('G-ABC'), GA4_HIT('G-ABC'), ADS_HIT('111111')]);
    expect(obs.unattributed_destination_ids).toEqual(['AW-111111']);
    const rows = observationToRows(obs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ destination_ids: ['G-ABC', 'AW-111111'], inferred: true });
    const v = computeTopologyVerdict(rows);
    expect(v.verdict).toBe('COMBINED');
    expect(v.strength).toBe('assumed'); // AC9
  });

  it('with several loaded tags an unattributable hit is NOT grouped with any tag', () => {
    const obs = extractGoogleTagObservation([GTAG('G-ABC'), GTAG('GT-XYZ'), ADS_HIT('111111')]);
    const rows = observationToRows(obs);
    expect(rows.every((r) => r.destination_ids.length === 1)).toBe(true);
    expect(computeTopologyVerdict(rows).verdict).toBe('SPLIT');
  });
});

describe('computeTopologyVerdict', () => {
  const declared = (over: Partial<TopologyRow>): TopologyRow => ({
    google_tag_id: 'G-ABC', primary_destination_id: 'G-ABC', destination_ids: ['G-ABC'],
    source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED', ...over,
  });

  it('no rows → UNKNOWN', () => {
    expect(computeTopologyVerdict([])).toMatchObject({ verdict: 'UNKNOWN', strength: 'none' });
  });
  it('AW- primary with GA4 on the same tag → COMBINED_ADS_PRIMARY', () => {
    const v = computeTopologyVerdict([declared({ google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1', 'G-ABC'] })]);
    expect(v.verdict).toBe('COMBINED_ADS_PRIMARY');
    expect(v.strength).toBe('declared');
    expect(v.combined_tags[0].google_tag_id).toBe('AW-1');
  });
  it('G- primary with AW- on the same tag → COMBINED (not Ads-primary)', () => {
    expect(computeTopologyVerdict([declared({ destination_ids: ['G-ABC', 'AW-1'] })]).verdict).toBe('COMBINED');
  });
  it('an OPERATOR_ASSUMED declaration is "assumed", not "declared"', () => {
    expect(computeTopologyVerdict([declared({ destination_ids: ['G-ABC', 'AW-1'], declaration_source: 'OPERATOR_ASSUMED' })]).strength).toBe('assumed');
  });
  it('a declaration outranks conflicting runtime evidence', () => {
    const runtime: TopologyRow = { google_tag_id: 'G-ABC', primary_destination_id: 'G-ABC', destination_ids: ['G-ABC', 'AW-1'], source: 'runtime_observed', inferred: true };
    expect(computeTopologyVerdict([runtime, declared({})]).verdict).toBe('SPLIT');
  });
});
