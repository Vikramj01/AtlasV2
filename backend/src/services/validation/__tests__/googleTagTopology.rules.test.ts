import { describe, it, expect } from 'vitest';
import {
  GOOGLE_ADS_GOOGLE_TAG_MISSING,
  GOOGLE_TAG_COMBINED,
  GOOGLE_TAG_COMBINED_ADS_PRIMARY,
  GOOGLE_TAG_ID_UNCLASSIFIED,
} from '../googleTagTopology';
import { GA4_CROSS_DOMAIN_LINKING_MISSING } from '../tagConfiguration';
import { TAG_CONFIGURATION_RULES } from '../../ihc/tagConfigurationRules';
import { ALL_RULES } from '../engine';
import { GOOGLE_ADS_AW_ID_PRESENT } from '../register/L1';
import { detectSignalConflicts } from '../register/signalConsistency';
import type { AuditData, SiteSetupSummary, GTMTag, GTMTrigger, GTMContainerSnapshot, GTMVariable } from '@/types/audit';

const allPages: GTMTrigger = { triggerId: '1', name: 'All Pages', type: 'PAGEVIEW' };
const googtag = (id: string, name = 'Google tag', extra: Partial<GTMTag> = {}): GTMTag => ({
  tagId: id, name, type: 'googtag', firingTriggerId: ['1'],
  parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }], ...extra,
});
const awct: GTMTag = { tagId: '9', name: 'Ads conv', type: 'awct', firingTriggerId: ['1'], parameter: [] };
const container = (tags: GTMTag[], variables: GTMVariable[] = []): GTMContainerSnapshot => ({
  container_id: 'c', fetched_at: '2026-01-01T00:00:00Z', source: 'gtm_api',
  tags, triggers: [allPages], variables, built_in_variables: [], consent_default_tag: null,
});
const audit = (c: GTMContainerSnapshot, extra: Partial<AuditData> = {}) => ({ gtmContainer: c, ...extra }) as unknown as AuditData;

describe('GOOGLE_ADS_GOOGLE_TAG_MISSING (AC 7)', () => {
  const adsOnlyConv = container([googtag('G-1'), awct]);

  it('skips when the container has no Ads destination', () => {
    expect(GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(container([googtag('G-1')]))).status).toBe('skipped');
  });
  it('passes when a sitewide Ads googtag exists', () => {
    expect(GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(container([googtag('G-1'), googtag('AW-1', 'Ads tag'), awct]))).status).toBe('pass');
  });
  it('an Ads googtag on a filtered (non-sitewide) trigger does not count', () => {
    const c = container([googtag('AW-1', 'Ads tag', { firingTriggerId: ['2'] }), awct]);
    c.triggers.push({ triggerId: '2', name: 'Click', type: 'CLICK', filter: [{ type: 'EQUALS', parameter: [] }] });
    expect(GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(c)).status).toBe('fail');
  });
  it('unknown topology → high with confidence confirm (D5)', () => {
    const r = GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(adsOnlyConv));
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('high');
    expect(r.confidence).toBe('confirm');
  });
  it('known SPLIT → high, no confirm chip', () => {
    const r = GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(adsOnlyConv, { google_tag_topology: { verdict: 'SPLIT', strength: 'declared', combined_tags: [] } }));
    expect(r.severity).toBe('high');
    expect(r.confidence).toBeUndefined();
  });
  it('AW- ID on a combined tag → downgraded to low with the coverage note', () => {
    const r = GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(adsOnlyConv, {
      google_tag_topology: { verdict: 'COMBINED', strength: 'declared', combined_tags: [{ google_tag_id: 'G-1', primary_destination_id: 'G-1', destination_ids: ['G-1', 'AW-1'] }] },
    }));
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('low');
    expect(r.technical_details.evidence.join(' ')).toContain('will break Google Ads coverage');
  });
  it('an AW- constant variable also counts as an Ads destination', () => {
    const vars: GTMVariable[] = [{ variableId: '5', name: 'CONST - Ads', type: 'c', parameter: [{ type: 'TEMPLATE', key: 'value', value: 'AW-9' }] }];
    expect(GOOGLE_ADS_GOOGLE_TAG_MISSING.test(audit(container([googtag('G-1')], vars))).status).toBe('fail');
  });
});

describe('GOOGLE_TAG_COMBINED / _ADS_PRIMARY (AC 8)', () => {
  const combined = { google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1', 'G-1'] };
  const topo = { verdict: 'COMBINED_ADS_PRIMARY' as const, strength: 'declared' as const, combined_tags: [combined] };

  it('skip with unknown topology; pass when split', () => {
    expect(GOOGLE_TAG_COMBINED.test(audit(container([]))).status).toBe('skipped');
    expect(GOOGLE_TAG_COMBINED.test(audit(container([]), { google_tag_topology: { verdict: 'SPLIT', strength: 'observed', combined_tags: [] } })).status).toBe('pass');
  });
  it('COMBINED fails at medium and names the destinations and primary', () => {
    const r = GOOGLE_TAG_COMBINED.test(audit(container([]), { google_tag_topology: topo }));
    expect(r).toMatchObject({ status: 'fail', severity: 'medium' });
    expect(r.technical_details.evidence[0]).toContain('AW-1');
    expect(r.technical_details.evidence[0]).toContain('G-1');
  });
  it('ADS_PRIMARY is high with secondary domains, medium without', () => {
    expect(GOOGLE_TAG_COMBINED_ADS_PRIMARY.test(audit(container([]), { google_tag_topology: topo, client_secondary_domains: ['x.com'] })).severity).toBe('high');
    expect(GOOGLE_TAG_COMBINED_ADS_PRIMARY.test(audit(container([]), { google_tag_topology: topo })).severity).toBe('medium');
  });
  it('ADS_PRIMARY wording does not state the GA4 lock as fact (AC 17)', () => {
    const r = GOOGLE_TAG_COMBINED_ADS_PRIMARY.test(audit(container([]), { google_tag_topology: topo }));
    expect(r.technical_details.evidence.join(' ')).toContain('reported to');
  });
  it('a plain COMBINED (G- primary) does not fire ADS_PRIMARY', () => {
    const t = { verdict: 'COMBINED' as const, strength: 'declared' as const, combined_tags: [{ ...combined, google_tag_id: 'G-1', primary_destination_id: 'G-1' }] };
    expect(GOOGLE_TAG_COMBINED_ADS_PRIMARY.test(audit(container([]), { google_tag_topology: t })).status).toBe('pass');
  });
  it('assumed strength carries confirm', () => {
    const r = GOOGLE_TAG_COMBINED.test(audit(container([]), { google_tag_topology: { ...topo, strength: 'assumed' } }));
    expect(r.confidence).toBe('confirm');
  });
});

describe('GOOGLE_TAG_ID_UNCLASSIFIED', () => {
  it('flags GT- and unresolvable IDs with confirm; passes for G-/AW-', () => {
    expect(GOOGLE_TAG_ID_UNCLASSIFIED.test(audit(container([googtag('G-1'), googtag('AW-1')]))).status).toBe('pass');
    const r = GOOGLE_TAG_ID_UNCLASSIFIED.test(audit(container([googtag('GT-1'), googtag('{{DLV - x}}', 'Dyn')])));
    expect(r).toMatchObject({ status: 'fail', severity: 'low', confidence: 'confirm' });
    expect(r.technical_details.evidence).toHaveLength(2);
  });
});

describe('GA4_CROSS_DOMAIN_LINKING_MISSING on a COMBINED_ADS_PRIMARY client', () => {
  it('no longer returns a clean pass', () => {
    const tag = googtag('G-1', 'GA4', {
      parameter: [
        { type: 'TEMPLATE', key: 'tagId', value: 'G-1' },
        { type: 'LIST', key: 'linked_domains', list: [{ type: 'TEMPLATE', value: 'x.com' }] },
      ],
    });
    const r = GA4_CROSS_DOMAIN_LINKING_MISSING.test(audit(container([tag]), {
      client_secondary_domains: ['x.com'],
      google_tag_topology: { verdict: 'COMBINED_ADS_PRIMARY', strength: 'declared', combined_tags: [] },
    }));
    expect(r.status).toBe('pass');
    expect(r.confidence).toBe('confirm');
  });
});

describe('registry', () => {
  it('the four topology rules are registered for the IHC worker but NOT the v1 engine (v1 scoring counts skipped results)', () => {
    expect(ALL_RULES.some((r) => r.rule_id === 'GOOGLE_TAG_COMBINED')).toBe(false);
    const ids = TAG_CONFIGURATION_RULES.map((r) => r.rule_id);
    for (const id of ['GOOGLE_ADS_GOOGLE_TAG_MISSING', 'GOOGLE_TAG_COMBINED', 'GOOGLE_TAG_COMBINED_ADS_PRIMARY', 'GOOGLE_TAG_ID_UNCLASSIFIED']) {
      expect(ids).toContain(id);
    }
  });
});

const emptySiteSetup = (): SiteSetupSummary => ({
  generated_at: '2026-01-01T00:00:00Z',
  datalayer_inventory: [],
  tags: [],
  gtm_container: { detected: false, container_ids: [], connected_container_id: null, ids_match: null },
  possible_server_side_gtm: { detected: false, confidence: 'low', candidate_hosts: [], matched_heuristics: [], evidence_urls: [], caveat: '' },
});

describe('combined-tag fixture does not raise a false AW-ID contradiction (AC 10)', () => {
  const combinedRun = (): AuditData => ({
    networkRequests: [
      { url: 'https://www.googletagmanager.com/gtag/js?id=G-ABC&l=dataLayer', method: 'GET', headers: {}, timestamp: 1, step: 'landing' },
      { url: 'https://www.googleadservices.com/pagead/conversion/111111/?label=x', method: 'GET', headers: {}, timestamp: 2, step: 'landing' },
    ],
    dataLayer: [{ 0: 'config', 1: 'AW-111111' }] as unknown as AuditData['dataLayer'],
  }) as unknown as AuditData;

  it('GOOGLE_ADS_AW_ID_PRESENT passes when Ads hits observe the AW- ID with no AW- loader', () => {
    const r = GOOGLE_ADS_AW_ID_PRESENT.test(combinedRun());
    expect(r.status).toBe('pass');
    expect(r.technical_details.evidence.join(' ')).toContain('shares a Google tag');
  });
  it('so CONF_04 has no failing rule to contradict', () => {
    const run = combinedRun();
    const results = [GOOGLE_ADS_AW_ID_PRESENT.test(run)];
    expect(detectSignalConflicts(run, emptySiteSetup(), results).filter((c) => c.assertion_id === 'CONF_04')).toEqual([]);
  });
  it('control: the same dataLayer config(AW-*) DOES raise CONF_04 when the rule fails (nothing in the hits)', () => {
    const run = combinedRun();
    run.networkRequests = run.networkRequests.slice(0, 1);
    const results = [GOOGLE_ADS_AW_ID_PRESENT.test(run)];
    expect(results[0].status).toBe('fail');
    expect(detectSignalConflicts(run, emptySiteSetup(), results).some((c) => c.assertion_id === 'CONF_04')).toBe(true);
  });
  it('still fails when nothing at all carries an AW- ID', () => {
    const run = { networkRequests: [{ url: 'https://www.googletagmanager.com/gtag/js?id=G-ABC', method: 'GET', headers: {}, timestamp: 1, step: 's' }], dataLayer: [] } as unknown as AuditData;
    expect(GOOGLE_ADS_AW_ID_PRESENT.test(run).status).toBe('fail');
  });
});
