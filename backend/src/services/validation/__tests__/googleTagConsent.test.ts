/**
 * Google Tag Topology PRD §9 (Sprint 5): the two consent rules named for a
 * "confirm they behave correctly" pass after googtag reclassification. Tests
 * only — no logic change is expected, and none was made.
 */
import { describe, it, expect } from 'vitest';
import { CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG, DEFAULT_CONSENT_GRANTED_GLOBALLY } from '../tagConfiguration';
import type { AuditData, GTMTag, GTMContainerSnapshot } from '@/types/audit';

const adsGoogtag = (extra: Partial<GTMTag> = {}): GTMTag => ({
  tagId: '1', name: 'Google Tag - Google Ads', type: 'googtag', firingTriggerId: ['1'],
  parameter: [{ type: 'TEMPLATE', key: 'tagId', value: 'AW-111' }], ...extra,
});
const consentDefault = (status: 'denied' | 'granted'): GTMTag => ({
  tagId: '9', name: 'Consent Mode v2 Default', type: 'html', firingTriggerId: ['1'],
  parameter: [{ type: 'LIST', key: 'defaultValue', list: [{ map: [{ key: 'consentType', value: 'ad_storage' }, { key: 'consentStatus', value: status }] }] }],
});
const container = (tags: GTMTag[], consent: GTMTag | null): GTMContainerSnapshot => ({
  container_id: 'c', fetched_at: '', source: 'gtm_api', tags, triggers: [], variables: [], built_in_variables: [], consent_default_tag: consent,
});
const audit = (c: GTMContainerSnapshot) => ({ gtmContainer: c }) as unknown as AuditData;

describe('CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG with an Ads googtag', () => {
  it('flags an Ads Google tag that has no consent settings, naming it', () => {
    const r = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(audit(container([adsGoogtag()], consentDefault('denied'))));
    expect(r.status).toBe('fail');
    expect(r.technical_details.evidence.join(' ')).toContain('Google Tag - Google Ads');
  });

  it('passes once the Ads Google tag declares consent (as the generator now emits)', () => {
    const tag = adsGoogtag({ consentSettings: { consentStatus: 'NEEDED', consentType: ['ad_storage', 'ad_user_data'] } as GTMTag['consentSettings'] });
    expect(CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(audit(container([tag], consentDefault('denied')))).status).toBe('pass');
  });
});

describe('DEFAULT_CONSENT_GRANTED_GLOBALLY is independent of which Google tags exist', () => {
  it('reads only the consent-default tag: an Ads Google tag neither triggers nor masks it', () => {
    const denied = DEFAULT_CONSENT_GRANTED_GLOBALLY.test(audit(container([adsGoogtag()], consentDefault('denied'))));
    const granted = DEFAULT_CONSENT_GRANTED_GLOBALLY.test(audit(container([adsGoogtag()], consentDefault('granted'))));
    expect(denied.status).toBe('pass');
    expect(granted.status).toBe('fail');
    expect(granted.technical_details.evidence.join(' ')).toContain('ad_storage');
  });

  it('still fails when there is no consent default at all, regardless of the Ads Google tag', () => {
    expect(DEFAULT_CONSENT_GRANTED_GLOBALLY.test(audit(container([adsGoogtag()], null))).status).toBe('fail');
  });
});
