/**
 * Google Tag Topology Sprint 1: every rule that used to treat `googtag` as
 * GA4 now classifies by the tag's destination ID.
 */
import { describe, it, expect } from 'vitest';
import { GA4_CROSS_DOMAIN_LINKING_MISSING, SGTM_ROUTING_NOT_CONFIGURED, CONSENT_TYPE_MISMATCH } from '../tagConfiguration';
import { consentPurposeForTag, consentSettingsForTag } from '../../planning/generators/renderer/consent.renderer';
import { validateGTMContainer } from '../../planning/generators/gtmSchemaValidator';
import type { AuditData, GTMTag, GTMContainerSnapshot, GTMVariable } from '@/types/audit';

const googtag = (id: string, extra: Partial<GTMTag> = {}): GTMTag => ({
  tagId: '1', name: 'Google tag', type: 'googtag', firingTriggerId: ['1'],
  parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }], ...extra,
});
const container = (tags: GTMTag[], variables: GTMVariable[] = []): GTMContainerSnapshot => ({
  container_id: 'c', fetched_at: '2026-01-01T00:00:00Z', source: 'gtm_api',
  tags, triggers: [], variables, built_in_variables: [], consent_default_tag: null,
});
const audit = (c: GTMContainerSnapshot, extra: Partial<AuditData> = {}) =>
  ({ gtmContainer: c, ...extra }) as unknown as AuditData;

describe('GA4 cross-domain / sGTM rules ignore an Ads googtag', () => {
  const adsOnly = container([googtag('AW-111')]);
  it('GA4_CROSS_DOMAIN_LINKING_MISSING skips (no false finding)', () => {
    const r = GA4_CROSS_DOMAIN_LINKING_MISSING.test(audit(adsOnly, { client_secondary_domains: ['shop.example.com'] }));
    expect(r.status).toBe('skipped');
  });
  it('SGTM_ROUTING_NOT_CONFIGURED skips', () => {
    const r = SGTM_ROUTING_NOT_CONFIGURED.test(
      audit(adsOnly, { sgtmVerified: true, client_sgtm_endpoint_url: 'https://s.example.com' } as Partial<AuditData>),
    );
    expect(r.status).toBe('skipped');
  });
});

describe('GA4 googtag keeps its previous behaviour (regression)', () => {
  it('still fails cross-domain when declared domains are missing, with no confirm chip', () => {
    const r = GA4_CROSS_DOMAIN_LINKING_MISSING.test(audit(container([googtag('G-1')]), { client_secondary_domains: ['x.com'] }));
    expect(r.status).toBe('fail');
    expect(r.confidence).toBeUndefined();
  });
  it('resolves a CONST variable to GA4', () => {
    const vars: GTMVariable[] = [{ variableId: '9', name: 'CONST - GA4 Measurement ID', type: 'c', parameter: [{ type: 'TEMPLATE', key: 'value', value: 'G-1' }] }];
    const r = GA4_CROSS_DOMAIN_LINKING_MISSING.test(
      audit(container([googtag('{{CONST - GA4 Measurement ID}}')], vars), { client_secondary_domains: ['x.com'] }),
    );
    expect(r.status).toBe('fail');
    expect(r.confidence).toBeUndefined();
  });
  it('an unresolvable googtag is still audited but flagged confirm', () => {
    const r = GA4_CROSS_DOMAIN_LINKING_MISSING.test(
      audit(container([googtag('{{DLV - id}}')]), { client_secondary_domains: ['x.com'] }),
    );
    expect(r.status).toBe('fail');
    expect(r.confidence).toBe('confirm');
  });
});

describe('CONSENT_TYPE_MISMATCH by destination', () => {
  const consent = (types: string[]) => ({ consentStatus: 'NEEDED', consentType: types }) as GTMTag['consentSettings'];
  it('Ads googtag needs ad_storage + ad_user_data, not analytics_storage', () => {
    const wrong = CONSENT_TYPE_MISMATCH.test(audit(container([googtag('AW-1', { consentSettings: consent(['analytics_storage']) })])));
    expect(wrong.status).toBe('fail');
    expect(wrong.technical_details.evidence.join(' ')).toContain('ad_storage');
    const right = CONSENT_TYPE_MISMATCH.test(audit(container([googtag('AW-1', { consentSettings: consent(['ad_storage', 'ad_user_data']) })])));
    expect(right.status).toBe('pass');
  });
  it('GA4 googtag still needs analytics_storage only', () => {
    expect(CONSENT_TYPE_MISMATCH.test(audit(container([googtag('G-1', { consentSettings: consent(['analytics_storage']) })]))).status).toBe('pass');
    expect(CONSENT_TYPE_MISMATCH.test(audit(container([googtag('G-1', { consentSettings: consent(['ad_storage']) })]))).status).toBe('fail');
  });
  it('unknown googtag requires the union and is flagged confirm', () => {
    const r = CONSENT_TYPE_MISMATCH.test(audit(container([googtag('{{X}}', { consentSettings: consent(['analytics_storage']) })])));
    expect(r.status).toBe('fail');
    expect(r.confidence).toBe('confirm');
  });
});

describe('consent renderer by resolved ID', () => {
  it('Ads ID → ads, GA4 ID → analytics, no ID → analytics (fallback)', () => {
    expect(consentPurposeForTag('googtag', '', 'AW-1')).toBe('ads');
    expect(consentPurposeForTag('googtag', '', 'G-1')).toBe('analytics');
    expect(consentPurposeForTag('googtag', '')).toBe('analytics');
    expect(consentSettingsForTag('googtag', '', 'AW-1')).toEqual({ consentStatus: 'needed' });
  });
});

describe('validateGTMContainer GA4-config warning', () => {
  const wrap = (tag: object) => ({ exportFormatVersion: 2, containerVersion: { tag: [tag], trigger: [], variable: [] } });
  const warnsNoGa4 = (tag: object) => validateGTMContainer(wrap(tag)).warnings.some((w) => w.includes('No GA4 configuration tag'));
  it('an Ads-only googtag no longer counts as GA4 config', () => {
    expect(warnsNoGa4({ name: 'Google Tag - Ads', type: 'googtag', parameter: [{ key: 'tagId', value: 'AW-1' }] })).toBe(true);
  });
  it('a G- googtag does', () => {
    expect(warnsNoGa4({ name: 'Google Tag', type: 'googtag', parameter: [{ key: 'tagId', value: 'G-1' }] })).toBe(false);
  });
});
