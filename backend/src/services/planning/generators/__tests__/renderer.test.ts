/**
 * Sprint 2.5-E — Renderer unit tests
 *
 * Covers all five renderer modules:
 *   trigger.renderer  — renderGTMTrigger, renderTriggerComment
 *   consent.renderer  — renderConsentSettings, consentSettingsForTag
 *   spec.renderer     — renderCodeSnippet
 *   gtm.renderer      — dlvPathForParam, renderGA4EventParameters,
 *                       renderGoogleAdsConversionTag, renderStandardEventAliasTag
 *   guide.renderer    — derivePlaceholderTable
 */
import { describe, it, expect } from 'vitest';

// ── Renderer imports ──────────────────────────────────────────────────────────
import { renderGTMTrigger, renderTriggerComment } from '../renderer/trigger.renderer';
import { renderConsentSettings, consentSettingsForTag, consentPurposeForTag } from '../renderer/consent.renderer';
import { renderCodeSnippet } from '../renderer/spec.renderer';
import {
  dlvPathForParam,
  renderGA4EventParameters,
  renderGoogleAdsConversionTag,
  renderStandardEventAliasTag,
} from '../renderer/gtm.renderer';
import { derivePlaceholderTable } from '../renderer/guide.renderer';

// ── Type imports ──────────────────────────────────────────────────────────────
import type { IREvent, IRTrigger, IRParameter } from '../ir.types';

// ── Test factories ────────────────────────────────────────────────────────────

function makeParam(key: string, type: IRParameter['type'] = 'string', required = true): IRParameter {
  return {
    key,
    label: key,
    type,
    required,
    value_source: { strategy: 'developer_provided' },
    example: type === 'number' ? '1' : 'example',
  };
}

function makeIREvent(overrides: Partial<IREvent> = {}): IREvent {
  return {
    event_id: 'atlas_evt_001',
    event_name: 'test_event',
    business_justification: 'test',
    action_type: 'cta_click',
    priority: 'recommended',
    platforms: ['ga4'],
    parameters: [],
    trigger: { trigger_type: 'click_css', selector: '#btn' },
    is_conversion: false,
    ...overrides,
  };
}

// ── trigger.renderer ─────────────────────────────────────────────────────────

describe('renderGTMTrigger', () => {
  it('page_load → CUSTOM_EVENT type (dev pushes the event, GTM listens via CE trigger)', () => {
    const t = renderGTMTrigger({ trigger_type: 'page_load' }, 'page_view', '1', 'f1');
    expect(t.type).toBe('CUSTOM_EVENT');
    // Fires when dataLayer receives event: 'page_view'
    const filterValue = t.customEventFilter?.[0]?.parameter?.find(p => p.key === 'arg1')?.value;
    expect(filterValue).toBe('page_view');
  });

  it('custom_event → CUSTOM_EVENT with event name filter', () => {
    const t = renderGTMTrigger({ trigger_type: 'custom_event' }, 'my_event', '1', 'f1');
    expect(t.type).toBe('CUSTOM_EVENT');
    const filterValue = t.customEventFilter?.[0]?.parameter?.find(p => p.key === 'arg1')?.value;
    expect(filterValue).toBe('my_event');
  });

  it('click_css → CLICK trigger with CSS_SELECTOR filter', () => {
    const t = renderGTMTrigger({ trigger_type: 'click_css', selector: '#cta' }, 'btn_click', '2', 'f1');
    expect(t.type).toBe('CLICK');
    const filter = t.filter?.[0];
    expect(filter?.type).toBe('CSS_SELECTOR');
    expect(filter?.parameter?.find(p => p.key === 'arg1')?.value).toBe('#cta');
  });

  it('click_text → CLICK trigger with EQUALS {{Click Text}} filter — never :contains()', () => {
    const t = renderGTMTrigger({ trigger_type: 'click_text', click_text: 'Buy Now' }, 'cta_click', '3', 'f1');
    expect(t.type).toBe('CLICK');
    const filter = t.filter?.[0];
    expect(filter?.type).toBe('EQUALS');
    const textRef = filter?.parameter?.find(p => p.key === 'arg0')?.value;
    const textVal = filter?.parameter?.find(p => p.key === 'arg1')?.value;
    expect(textRef).toBe('{{Click Text}}');
    expect(textVal).toBe('Buy Now');
    // Crucially: no :contains() anywhere
    expect(JSON.stringify(t)).not.toContain(':contains(');
  });

  it('form_submit → FORM_SUBMISSION with selector', () => {
    const t = renderGTMTrigger({ trigger_type: 'form_submit', selector: '#contact-form' }, 'form_submit', '4', 'f1');
    expect(t.type).toBe('FORM_SUBMISSION');
  });

  it('scroll_depth → SCROLL_DEPTH type', () => {
    const t = renderGTMTrigger({ trigger_type: 'scroll_depth' }, 'scroll', '5', 'f1');
    expect(t.type).toBe('SCROLL_DEPTH');
  });

  it('all triggers assign the correct folderId', () => {
    const t = renderGTMTrigger({ trigger_type: 'page_load' }, 'pv', '1', 'folder99');
    expect(t.folderId).toBe('folder99');
  });
});

describe('renderTriggerComment', () => {
  it('page_load → fires on page load', () => {
    expect(renderTriggerComment({ trigger_type: 'page_load' })).toContain('page load');
  });

  it('click_text → references text — never :contains()', () => {
    const comment = renderTriggerComment({ trigger_type: 'click_text', click_text: 'Submit' });
    expect(comment).toContain('Submit');
    expect(comment).not.toContain(':contains(');
  });

  it('form_submit → references form submission', () => {
    expect(renderTriggerComment({ trigger_type: 'form_submit', selector: '#form' })).toContain('form');
  });
});

// ── consent.renderer ─────────────────────────────────────────────────────────

describe('renderConsentSettings', () => {
  it('analytics → needed', () => {
    expect(renderConsentSettings('analytics')).toEqual({ consentStatus: 'needed' });
  });

  it('ads → needed', () => {
    expect(renderConsentSettings('ads')).toEqual({ consentStatus: 'needed' });
  });

  it('infrastructure → notNeeded', () => {
    expect(renderConsentSettings('infrastructure')).toEqual({ consentStatus: 'notNeeded' });
  });

  it('NEVER returns notSet for any purpose', () => {
    const purposes = ['analytics', 'ads', 'infrastructure'] as const;
    for (const p of purposes) {
      expect(renderConsentSettings(p).consentStatus).not.toBe('notSet');
    }
  });
});

describe('consentPurposeForTag', () => {
  it('gaawc/gaawe → analytics', () => {
    expect(consentPurposeForTag('gaawc', '')).toBe('analytics');
    expect(consentPurposeForTag('gaawe', '')).toBe('analytics');
  });

  it('awct/gclidw → ads', () => {
    expect(consentPurposeForTag('awct', '')).toBe('ads');
    expect(consentPurposeForTag('gclidw', '')).toBe('ads');
  });

  it('html Meta - tag → ads', () => {
    expect(consentPurposeForTag('html', 'Meta - purchase')).toBe('ads');
  });

  it('html TikTok - tag → ads', () => {
    expect(consentPurposeForTag('html', 'TikTok - add_to_cart')).toBe('ads');
  });

  it('html LinkedIn - tag → ads', () => {
    expect(consentPurposeForTag('html', 'LinkedIn - lead_form_submit')).toBe('ads');
  });

  it('html infrastructure tag → infrastructure', () => {
    expect(consentPurposeForTag('html', 'Atlas - Consent Mode v2 Default')).toBe('infrastructure');
  });

  it('consentSettingsForTag never returns notSet', () => {
    const platformTags: Array<[string, string]> = [
      ['gaawc', ''], ['gaawe', ''], ['awct', ''], ['gclidw', ''],
      ['html', 'Meta - purchase'], ['html', 'TikTok - add_to_cart'],
    ];
    for (const [type, name] of platformTags) {
      expect(consentSettingsForTag(type, name).consentStatus).not.toBe('notSet');
    }
  });
});

// ── spec.renderer ─────────────────────────────────────────────────────────────

describe('renderCodeSnippet', () => {
  it('always starts with window.dataLayer = window.dataLayer || [];', () => {
    const snippet = renderCodeSnippet(makeIREvent());
    expect(snippet).toContain('window.dataLayer = window.dataLayer || [];');
  });

  it('string params become single-quoted {{PARAM_KEY}} placeholders', () => {
    const event = makeIREvent({ parameters: [makeParam('form_id', 'string')] });
    const snippet = renderCodeSnippet(event);
    expect(snippet).toContain(`'{{FORM_ID}}'`);
  });

  it('number params become unquoted {{PARAM_KEY}} placeholders', () => {
    const event = makeIREvent({ parameters: [makeParam('value', 'number')] });
    const snippet = renderCodeSnippet(event);
    expect(snippet).toContain('{{VALUE}}');
    expect(snippet).not.toContain(`'{{VALUE}}'`);
  });

  it('purchase action uses nested ecommerce: object', () => {
    const event = makeIREvent({ action_type: 'purchase', event_name: 'purchase' });
    const snippet = renderCodeSnippet(event);
    expect(snippet).toContain('ecommerce:');
    expect(snippet).toContain('transaction_id');
  });

  it('add_to_cart uses nested ecommerce: object', () => {
    const event = makeIREvent({ action_type: 'add_to_cart', event_name: 'add_to_cart' });
    expect(renderCodeSnippet(event)).toContain('ecommerce:');
  });

  it('non-ecommerce event does NOT contain ecommerce: object', () => {
    const event = makeIREvent({
      action_type: 'form_submit',
      event_name: 'contact_form_submit',
      parameters: [makeParam('form_id', 'string')],
    });
    expect(renderCodeSnippet(event)).not.toContain('ecommerce:');
  });

  it('attribution params use URLSearchParams — never hardcoded', () => {
    const gclid: IRParameter = {
      key: 'gclid',
      label: 'GCLID',
      type: 'string',
      required: false,
      value_source: { strategy: 'page_url' },
      example: '',
    };
    const event = makeIREvent({ parameters: [gclid] });
    const snippet = renderCodeSnippet(event);
    expect(snippet).toContain('URLSearchParams');
    expect(snippet).not.toContain("'{{GCLID}}'");
  });

  it('never outputs :contains() in the trigger comment or body', () => {
    const event = makeIREvent({
      trigger: { trigger_type: 'click_text', click_text: 'Buy Now' },
    });
    expect(renderCodeSnippet(event)).not.toContain(':contains(');
  });
});

// ── gtm.renderer ─────────────────────────────────────────────────────────────

describe('dlvPathForParam', () => {
  it('value → ecommerce.value for ecommerce events', () => {
    expect(dlvPathForParam('value', true)).toBe('ecommerce.value');
  });

  it('value → value (flat) for non-ecommerce events', () => {
    expect(dlvPathForParam('value', false)).toBe('value');
  });

  it('currency → ecommerce.currency for ecommerce', () => {
    expect(dlvPathForParam('currency', true)).toBe('ecommerce.currency');
  });

  it('email → user_data.email regardless of ecommerce context', () => {
    expect(dlvPathForParam('email', true)).toBe('user_data.email');
    expect(dlvPathForParam('email', false)).toBe('user_data.email');
  });

  it('phone_number → user_data.phone_number regardless of ecommerce context', () => {
    expect(dlvPathForParam('phone_number', true)).toBe('user_data.phone_number');
    expect(dlvPathForParam('phone_number', false)).toBe('user_data.phone_number');
  });

  it('form_id → form_id (flat, not nested) for non-ecommerce', () => {
    expect(dlvPathForParam('form_id', false)).toBe('form_id');
  });
});

describe('renderGA4EventParameters', () => {
  it('returns empty array when event has no parameters', () => {
    expect(renderGA4EventParameters(makeIREvent())).toHaveLength(0);
  });

  it('returns a LIST parameter with one MAP entry per parameter', () => {
    const event = makeIREvent({ parameters: [makeParam('cta_text'), makeParam('page_section')] });
    const result = renderGA4EventParameters(event);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('LIST');
    expect(result[0].list).toHaveLength(2);
  });

  it('each MAP entry has key and DLV reference as value', () => {
    const event = makeIREvent({ parameters: [makeParam('form_id')] });
    const list = renderGA4EventParameters(event)[0].list!;
    const keyEntry = list[0].map!.find(m => m.key === 'key');
    const valEntry = list[0].map!.find(m => m.key === 'value');
    expect(keyEntry?.value).toBe('form_id');
    expect(valEntry?.value).toBe('{{DLV - form_id}}');
  });

  it('ecommerce event uses ecommerce-scoped DLV path', () => {
    const event = makeIREvent({
      action_type: 'purchase',
      parameters: [makeParam('value', 'number')],
    });
    const list = renderGA4EventParameters(event)[0].list!;
    const valEntry = list[0].map!.find(m => m.key === 'value');
    expect(valEntry?.value).toBe('{{DLV - ecommerce.value}}');
  });
});

describe('renderGoogleAdsConversionTag', () => {
  const event = makeIREvent({
    event_name: 'contact_form_submit',
    action_type: 'generate_lead' as 'cta_click', // cast for test
    is_conversion: true,
  });

  const result = renderGoogleAdsConversionTag(
    event, 'trig1', 'tag1', 'var1', 'fold1', 'CONST - Google Ads Conversion ID',
  );

  it('creates a per-event label variable with the event name in its name', () => {
    expect(result.labelVar.name).toContain('contact_form_submit');
    expect(result.labelVar.type).toBe('c');
  });

  it('tag references the per-event label variable — not a shared CONVERSION_LABEL', () => {
    const labelParam = result.tag.parameter.find(p => p.key === 'conversionLabel');
    expect(labelParam?.value).toContain('contact_form_submit');
    expect(labelParam?.value).not.toBe('{{CONVERSION_LABEL}}');
  });

  it('enhancedConversionsEnabled is true', () => {
    const ecParam = result.tag.parameter.find(p => p.key === 'enhancedConversionsEnabled');
    expect(ecParam?.value).toBe('true');
  });

  it('userDataEmail references DLV - user_data.email', () => {
    const emailParam = result.tag.parameter.find(p => p.key === 'userDataEmail');
    expect(emailParam?.value).toBe('{{DLV - user_data.email}}');
  });

  it('tag consent status is needed — never notSet', () => {
    expect(result.tag.consentSettings?.consentStatus).toBe('needed');
  });
});

describe('renderStandardEventAliasTag', () => {
  it('returns null when no standard_event_alias is set', () => {
    expect(renderStandardEventAliasTag(makeIREvent(), 't1', 'tag1', 'f1')).toBeNull();
  });

  it('returns a tag when standard_event_alias is set', () => {
    const event = makeIREvent({ standard_event_alias: 'generate_lead' });
    const tag = renderStandardEventAliasTag(event, 't1', 'tag1', 'f1');
    expect(tag).not.toBeNull();
    expect(tag!.type).toBe('gaawe');
  });

  it('alias tag event name is the standard alias — not the primary event name', () => {
    const event = makeIREvent({
      event_name: 'contact_form_submit',
      standard_event_alias: 'generate_lead',
    });
    const tag = renderStandardEventAliasTag(event, 't1', 'tag1', 'f1');
    const eventNameParam = tag!.parameter.find(p => p.key === 'eventName');
    expect(eventNameParam?.value).toBe('generate_lead');
  });

  it('alias tag name includes both event name and alias', () => {
    const event = makeIREvent({
      event_name: 'contact_form_submit',
      standard_event_alias: 'generate_lead',
    });
    const tag = renderStandardEventAliasTag(event, 't1', 'tag1', 'f1');
    expect(tag!.name).toContain('contact_form_submit');
    expect(tag!.name).toContain('generate_lead');
  });

  it('alias tag has consent: needed', () => {
    const event = makeIREvent({ standard_event_alias: 'sign_up' });
    const tag = renderStandardEventAliasTag(event, 't1', 'tag1', 'f1');
    expect(tag!.consentSettings?.consentStatus).toBe('needed');
  });
});

// ── guide.renderer ────────────────────────────────────────────────────────────

describe('derivePlaceholderTable', () => {
  function makeConstVar(name: string) {
    return {
      name,
      type: 'c',
      variableId: '1',
      accountId: '0',
      containerId: '0',
      fingerprint: '0',
      tagManagerUrl: '',
      parameter: [{ type: 'TEMPLATE' as const, key: 'value', value: '' }],
    };
  }

  it('returns a row for each CONST variable matching selected platforms', () => {
    const vars = [
      makeConstVar('CONST - GA4 Measurement ID'),
      makeConstVar('CONST - Google Ads Conversion ID'),
    ];
    const rows = derivePlaceholderTable(vars, ['ga4', 'google_ads']);
    expect(rows.length).toBe(2);
  });

  it('does NOT include Meta row when meta is not in selected platforms', () => {
    const vars = [
      makeConstVar('CONST - GA4 Measurement ID'),
      makeConstVar('CONST - Meta Pixel ID'),
    ];
    const rows = derivePlaceholderTable(vars, ['ga4']);
    expect(rows.every(r => !r.variable_name.includes('Meta'))).toBe(true);
  });

  it('includes Meta row when meta IS in selected platforms', () => {
    const vars = [makeConstVar('CONST - Meta Pixel ID')];
    const rows = derivePlaceholderTable(vars, ['ga4', 'meta']);
    expect(rows.some(r => r.variable_name.includes('Meta'))).toBe(true);
  });

  it('each row has required fields: variable_name, description, where_to_find, example', () => {
    const vars = [makeConstVar('CONST - GA4 Measurement ID')];
    const rows = derivePlaceholderTable(vars, ['ga4']);
    expect(rows[0]).toHaveProperty('variable_name');
    expect(rows[0]).toHaveProperty('description');
    expect(rows[0]).toHaveProperty('where_to_find');
    expect(rows[0]).toHaveProperty('example');
  });

  it('returns empty array when no CONST variables present', () => {
    const vars = [{ ...makeConstVar('DLV - event'), type: 'v' as const }];
    const rows = derivePlaceholderTable(vars, ['ga4']);
    expect(rows).toHaveLength(0);
  });
});
