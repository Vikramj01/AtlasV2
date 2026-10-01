import { describe, it, expect } from 'vitest';
import { runBackscan, type BackscanClient } from '../googleTagBackscan';
import type { GTMContainerSnapshot, GTMTag } from '@/types/audit';

const tag = (type: string, name: string, extra: Partial<GTMTag> = {}): GTMTag => ({ tagId: name, name, type, firingTriggerId: ['1'], parameter: [], ...extra });
const googtag = (id: string, extra: Partial<GTMTag> = {}) => tag('googtag', `G ${id}`, { parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }], ...extra });
const c = (tags: GTMTag[]): GTMContainerSnapshot => ({ container_id: 'c', fetched_at: '', source: 'gtm_api', tags, triggers: [], variables: [], built_in_variables: [], consent_default_tag: null });
const client = (id: string, tags: GTMTag[], extra: Partial<BackscanClient> = {}): BackscanClient => ({
  client_id: id, container: c(tags), topology_rows: [], secondary_domains: [], sgtm_verified: false, ...extra,
});
const atlas = tag('html', 'Atlas - Consent Mode v2 Default');

describe('runBackscan', () => {
  it('group 1: Atlas-generated, Ads destination, no Ads Google tag and no linker', () => {
    const r = runBackscan([
      client('exposed', [atlas, googtag('G-1'), tag('awct', 'conv')]),
      client('has-linker', [atlas, googtag('G-1'), tag('awct', 'conv'), tag('gclidw', 'linker')]),
      client('has-ads-tag', [atlas, googtag('G-1'), googtag('AW-1'), tag('awct', 'conv')]),
      client('not-atlas', [googtag('G-1'), tag('awct', 'conv')]),
    ]);
    expect(r.missing_ads_tag_and_linker).toEqual([{ client_id: 'exposed' }]);
  });

  it('group 2: names the findings the old googtag===GA4 logic would have wrongly raised', () => {
    const r = runBackscan([
      client('a', [googtag('AW-1', { consentSettings: { consentStatus: 'NEEDED', consentType: ['ad_storage', 'ad_user_data'] } as GTMTag['consentSettings'] })], { secondary_domains: ['x.com'], sgtm_verified: true }),
      client('ga4-only', [googtag('G-1')], { secondary_domains: ['x.com'] }),
    ]);
    expect(r.retract_false_findings).toHaveLength(1);
    expect(r.retract_false_findings[0].client_id).toBe('a');
    expect(r.retract_false_findings[0].old_findings.sort()).toEqual(['CONSENT_TYPE_MISMATCH', 'GA4_CROSS_DOMAIN_LINKING_MISSING', 'SGTM_ROUTING_NOT_CONFIGURED']);
  });

  it('group 3: clients with a known COMBINED verdict', () => {
    const r = runBackscan([
      client('combined', [], { topology_rows: [{ google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1', 'G-1'], source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED' }] }),
      client('unknown', []),
    ]);
    expect(r.combined).toEqual([{ client_id: 'combined', verdict: 'COMBINED_ADS_PRIMARY', strength: 'declared' }]);
  });
});
