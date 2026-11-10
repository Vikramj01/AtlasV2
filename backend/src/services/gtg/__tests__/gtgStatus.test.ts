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

import {
  combineGtgStatus, effectiveProbeSummary, endpointVerdict, gtgStatusFromCapture, normaliseProbeSummary, summariseProbes,
  type CombineInput,
} from '../gtgStatus';

describe('gtgStatusFromCapture', () => {
  const ev = (over: Partial<Parameters<typeof gtgStatusFromCapture>[0]>) => ({
    hasFirstPartyLoad: false, hasGoogleDirectLoad: false, firstPartyIsGateway: false, ...over,
  });
  it('gateway loads only → detected_unverified (never verified: that needs the probe)', () => {
    expect(gtgStatusFromCapture(ev({ hasFirstPartyLoad: true, firstPartyIsGateway: true }))).toBe('detected_unverified');
  });
  it('Google-direct loads only → not_detected', () => {
    expect(gtgStatusFromCapture(ev({ hasGoogleDirectLoad: true }))).toBe('not_detected');
  });
  it('both → partial', () => {
    expect(gtgStatusFromCapture(ev({ hasFirstPartyLoad: true, firstPartyIsGateway: true, hasGoogleDirectLoad: true }))).toBe('partial');
  });
  it('no loader seen → unknown, not not_detected', () => {
    expect(gtgStatusFromCapture(ev({}))).toBe('unknown');
  });
  it('same-site loader that cannot be told from sGTM → unknown, not detected', () => {
    expect(gtgStatusFromCapture(ev({ hasFirstPartyLoad: true, firstPartyIsGateway: false }))).toBe('unknown');
  });
});

describe('endpointVerdict', () => {
  it('maps probe outcomes to a verdict', () => {
    expect(endpointVerdict({ pathStatus: 'pass', geoStatus: 'pass' })).toBe('ok');
    expect(endpointVerdict({ pathStatus: 'degraded', geoStatus: 'pass' })).toBe('ok');
    expect(endpointVerdict({ pathStatus: 'pass', geoStatus: 'fail' })).toBe('no_geo');
    expect(endpointVerdict({ pathStatus: 'pass', geoStatus: 'skipped' })).toBe('inconclusive');
    expect(endpointVerdict({ pathStatus: 'fail', geoStatus: 'skipped' })).toBe('broken');
    expect(endpointVerdict({ pathStatus: 'timeout', geoStatus: 'skipped' })).toBe('broken');
    expect(endpointVerdict({ pathStatus: 'error', geoStatus: 'skipped' })).toBe('inconclusive');
  });
});

describe('summariseProbes', () => {
  it('none probed → none', () => expect(summariseProbes([])).toBe('none'));
  it('any broken → broken, even beside ok endpoints', () => expect(summariseProbes(['ok', 'broken', 'inconclusive'])).toBe('broken'));
  it('inconclusive beats a clean result: one unknown endpoint stops a verified claim', () => {
    expect(summariseProbes(['ok', 'inconclusive'])).toBe('inconclusive');
  });
  it('no_geo beats ok', () => expect(summariseProbes(['ok', 'no_geo'])).toBe('no_geo'));
  it('all ok → ok', () => expect(summariseProbes(['ok', 'ok'])).toBe('ok'));
});

describe('effectiveProbeSummary (24h freshness)', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('a recent ok stays ok', () => expect(effectiveProbeSummary('ok', '2026-11-10T11:00:00Z', now)).toBe('ok'));
  it('a probe older than 24h no longer supports verified', () => {
    expect(effectiveProbeSummary('ok', '2026-11-09T11:00:00Z', now)).toBe('inconclusive');
    expect(effectiveProbeSummary('broken', '2026-11-01T00:00:00Z', now)).toBe('inconclusive');
  });
  it('a missing timestamp cannot support a claim', () => expect(effectiveProbeSummary('ok', null, now)).toBe('inconclusive'));
  it('none and inconclusive pass through untouched', () => {
    expect(effectiveProbeSummary('none', null, now)).toBe('none');
    expect(effectiveProbeSummary('inconclusive', null, now)).toBe('inconclusive');
  });
});

describe('normaliseProbeSummary', () => {
  it('coerces junk to none', () => {
    expect(normaliseProbeSummary('verified')).toBe('none');
    expect(normaliseProbeSummary(undefined)).toBe('none');
    expect(normaliseProbeSummary('ok')).toBe('ok');
  });
});

describe('combineGtgStatus', () => {
  const c = (over: Partial<CombineInput>): CombineInput => ({ current: 'unknown', capture: 'unknown', probe: 'none', ...over });

  it('AC 2: working path + a page that loads through it, no GTM connection involved → verified', () => {
    expect(combineGtgStatus(c({ probe: 'ok', capture: 'detected_unverified' }))).toBe('verified');
  });
  it('AC 3: routing works but location headers drop → verified_no_geo', () => {
    expect(combineGtgStatus(c({ probe: 'no_geo', capture: 'detected_unverified' }))).toBe('verified_no_geo');
  });
  it('a working path with no capture yet does NOT claim verified', () => {
    expect(combineGtgStatus(c({ probe: 'ok', capture: 'unknown' }))).toBe('unknown');
  });
  it('a working path but the page still loads from Google → not_detected', () => {
    expect(combineGtgStatus(c({ probe: 'ok', capture: 'not_detected' }))).toBe('not_detected');
  });
  it('a working path with a partly-routed page → partial', () => {
    expect(combineGtgStatus(c({ probe: 'ok', capture: 'partial' }))).toBe('partial');
  });
  it('a failing registered path is broken whatever the page shows', () => {
    for (const capture of ['unknown', 'detected_unverified', 'not_detected', 'partial'] as const) {
      expect(combineGtgStatus(c({ probe: 'broken', capture }))).toBe('broken');
    }
  });
  it('an inconclusive probe never regresses verified, verified_no_geo or broken', () => {
    for (const current of ['verified', 'verified_no_geo', 'broken'] as const) {
      expect(combineGtgStatus(c({ current, probe: 'inconclusive', capture: 'not_detected' }))).toBe(current);
    }
  });
  it('an inconclusive probe otherwise falls back to the capture', () => {
    expect(combineGtgStatus(c({ current: 'unknown', probe: 'inconclusive', capture: 'detected_unverified' }))).toBe('detected_unverified');
  });
  it('no endpoint registered: the capture decides (Sprint 2 behaviour)', () => {
    expect(combineGtgStatus(c({ probe: 'none', capture: 'not_detected' }))).toBe('not_detected');
    expect(combineGtgStatus(c({ current: 'verified', probe: 'none', capture: 'detected_unverified' }))).toBe('detected_unverified');
  });
  it('an operator-declared not_applicable is never overwritten', () => {
    expect(combineGtgStatus(c({ current: 'not_applicable', probe: 'broken', capture: 'not_detected' }))).toBe('not_applicable');
  });
  it('legacy is never overwritten', () => {
    expect(combineGtgStatus(c({ current: 'legacy', probe: 'ok', capture: 'detected_unverified' }))).toBe('legacy');
  });
  it('the order evidence arrives in does not change the answer', () => {
    // probe first, capture later
    const afterProbe = combineGtgStatus(c({ probe: 'ok', capture: 'unknown' }));
    const afterCapture = combineGtgStatus(c({ current: afterProbe, probe: 'ok', capture: 'detected_unverified' }));
    // capture first, probe later
    const afterCapture2 = combineGtgStatus(c({ probe: 'none', capture: 'detected_unverified' }));
    const afterProbe2 = combineGtgStatus(c({ current: afterCapture2, probe: 'ok', capture: 'detected_unverified' }));
    expect(afterCapture).toBe('verified');
    expect(afterProbe2).toBe('verified');
  });
});
