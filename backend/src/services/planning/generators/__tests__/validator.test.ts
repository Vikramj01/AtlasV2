/**
 * Sprint 2.5-E — GenerationValidator unit tests
 *
 * One describe block per rule (all 10). Each block has a "clean" test that
 * asserts the rule passes, then targeted failure tests for every branch.
 */
import { describe, it, expect } from 'vitest';
import { validateGeneration } from '../validator/generation.validator';
import type { GenerationValidationInput } from '../validator/generation.validator';
import type { GTMContainerJSON, GTMTagDef, GTMVariableDef, GTMTriggerDef } from '../gtmContainerGenerator';
import type { DataLayerSpecOutput } from '../dataLayerSpecGenerator';
import type { PlanningRecommendation, SuggestedParam } from '@/types/planning';

// ── Factory helpers ────────────────────────────────────────────────────────────

const STUB_CONTAINER = {
  accountId: '0',
  containerId: '0',
  fingerprint: '0',
  tagManagerUrl: 'https://tagmanager.google.com/',
};

function makeTag(overrides: Partial<GTMTagDef> & Pick<GTMTagDef, 'name' | 'type'>): GTMTagDef {
  return {
    ...STUB_CONTAINER,
    tagId: '1',
    parameter: [],
    firingTriggerId: ['1'],
    tagFiringOption: 'oncePerEvent',
    consentSettings: { consentStatus: 'needed' },
    ...overrides,
  };
}

function makeVariable(name: string, type = 'c', value = ''): GTMVariableDef {
  return {
    ...STUB_CONTAINER,
    variableId: '1',
    name,
    type,
    parameter: [{ type: 'TEMPLATE', key: 'value', value }],
  };
}

function makeTrigger(overrides: Partial<GTMTriggerDef> = {}): GTMTriggerDef {
  return {
    ...STUB_CONTAINER,
    triggerId: '1',
    name: 'Custom Event - test_event',
    type: 'CUSTOM_EVENT',
    customEventFilter: [],
    filter: [],
    ...overrides,
  };
}

function makeContainer(
  tags: GTMTagDef[] = [],
  variables: GTMVariableDef[] = [],
  triggers: GTMTriggerDef[] = [],
  builtIns: string[] = [],
): GTMContainerJSON {
  return {
    exportFormatVersion: 2,
    exportTime: '2026-01-01',
    containerVersion: {
      path: '',
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: 'Test',
      description: '',
      container: {
        path: '', accountId: '0', containerId: '0', name: 'Test',
        publicId: 'GTM-TEST', usageContext: ['WEB'], fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: tags,
      trigger: triggers,
      variable: variables,
      folder: [],
      builtInVariable: builtIns.map(name => ({
        accountId: '0', containerId: '0', type: name, name,
      })),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };
}

function makeSpec(pages: DataLayerSpecOutput['machine_spec']['pages'] = [], platforms: string[] = ['ga4']): DataLayerSpecOutput {
  return {
    atlas_spec_version: '1.0',
    metadata: {
      generated_at: '2026-01-01T00:00:00Z',
      business_type: 'lead_gen',
      platforms,
      atlas_spec_version: '1.0',
    },
    machine_spec: {
      event_schemas: [],
      ui_instrumentation_map: [],
      tracking_coverage: { covered_actions: [], missing_recommended_events: [] },
      pages,
      traffic_source: {
        utm_parameters: [],
        referrer_classification: '',
        session_cookie: '',
        code_snippet: '',
      },
    },
    human_documentation: {
      overview: '',
      implementation_notes: '',
      installation_snippet: '',
      variable_naming_guide: '',
      qa_checklist: [],
      events: [],
    },
  };
}

function makeRec(
  eventName: string,
  actionType: string,
  requiredParams: string[] = [],
  exampleValues: Record<string, string> = {},
): PlanningRecommendation {
  return {
    id: '1',
    page_id: 'p1',
    action_type: actionType,
    event_name: eventName,
    required_params: requiredParams.map((k): SuggestedParam => ({
      param_key: k,
      param_label: k,
      source: 'developer_provided',
      source_detail: '',
      example_value: exampleValues[k] ?? 'example',
    })),
    optional_params: [],
    confidence_score: 1,
    business_justification: 'test',
    affected_platforms: ['ga4'],
    source: 'ai',
  };
}

function makeGuide(conversionCount = 0, extraText = ''): string {
  return `# Tracking Implementation\n\n**Conversions:** ${conversionCount}\n\n${extraText}`;
}

function makeInput(overrides: Partial<GenerationValidationInput> = {}): GenerationValidationInput {
  return {
    gtmContainer: makeContainer(),
    dataLayerSpec: makeSpec(),
    implementationGuide: makeGuide(),
    recommendations: [],
    businessType: 'lead_gen',
    platforms: ['ga4'],
    ...overrides,
  };
}

// ── Rule 1: VARIABLE_RESOLUTION ────────────────────────────────────────────────

describe('Rule 1: VARIABLE_RESOLUTION', () => {
  it('passes when all {{Ref}} in tag parameters resolve to known variables', () => {
    const ga4Var = makeVariable('CONST - GA4 Measurement ID');
    const tag = makeTag({
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [{ type: 'TEMPLATE', key: 'trackingId', value: '{{CONST - GA4 Measurement ID}}' }],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [ga4Var]),
    }));
    const rule1 = result.errors.filter(e => e.rule === 'VARIABLE_RESOLUTION');
    expect(rule1).toHaveLength(0);
  });

  it('CRITICAL error when a tag references a {{Var}} that does not exist', () => {
    const tag = makeTag({
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [{ type: 'TEMPLATE', key: 'trackingId', value: '{{CONST - GA4 Measurement ID}}' }],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], []),
    }));
    const rule1 = result.errors.filter(e => e.rule === 'VARIABLE_RESOLUTION');
    expect(rule1.length).toBeGreaterThan(0);
    expect(rule1[0].severity).toBe('CRITICAL');
    expect(rule1[0].message).toContain('CONST - GA4 Measurement ID');
  });

  it('resolves built-in variables (e.g. {{Click Text}})', () => {
    const tag = makeTag({
      name: 'GA4 - click',
      type: 'gaawe',
      parameter: [{ type: 'TEMPLATE', key: 'val', value: '{{Click Text}}' }],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [], [], ['Click Text']),
    }));
    const rule1 = result.errors.filter(e => e.rule === 'VARIABLE_RESOLUTION');
    expect(rule1).toHaveLength(0);
  });

  it('checks nested LIST/MAP parameter values recursively', () => {
    const tag = makeTag({
      name: 'GA4 - event',
      type: 'gaawe',
      parameter: [{
        type: 'LIST',
        key: 'eventParameters',
        list: [{
          type: 'MAP',
          map: [
            { type: 'TEMPLATE', key: 'key', value: 'form_id' },
            { type: 'TEMPLATE', key: 'value', value: '{{DLV - form_id}}' },
          ],
        }],
      }],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], []),
    }));
    const rule1 = result.errors.filter(e => e.rule === 'VARIABLE_RESOLUTION');
    expect(rule1.length).toBeGreaterThan(0);
    expect(rule1[0].message).toContain('DLV - form_id');
  });
});

// ── Rule 2: TAG_NAME_UNIQUENESS ────────────────────────────────────────────────

describe('Rule 2: TAG_NAME_UNIQUENESS', () => {
  it('passes when all tag names are unique', () => {
    const tags = [
      makeTag({ name: 'GA4 - page_view', type: 'gaawc', tagId: '1' }),
      makeTag({ name: 'GA4 - form_submit', type: 'gaawe', tagId: '2' }),
    ];
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer(tags) }));
    expect(result.errors.filter(e => e.rule === 'TAG_NAME_UNIQUENESS')).toHaveLength(0);
  });

  it('HIGH error when two tags share the same name', () => {
    const tags = [
      makeTag({ name: 'GA4 - Form Submit', type: 'gaawe', tagId: '1' }),
      makeTag({ name: 'GA4 - Form Submit', type: 'gaawe', tagId: '2' }),
    ];
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer(tags) }));
    const rule2 = result.errors.filter(e => e.rule === 'TAG_NAME_UNIQUENESS');
    expect(rule2.length).toBeGreaterThan(0);
    expect(rule2[0].severity).toBe('HIGH');
    expect(rule2[0].message).toContain('GA4 - Form Submit');
  });

  it('reports how many duplicates exist', () => {
    const name = 'Google Ads - purchase Conversion';
    const tags = [
      makeTag({ name, type: 'awct', tagId: '1' }),
      makeTag({ name, type: 'awct', tagId: '2' }),
      makeTag({ name, type: 'awct', tagId: '3' }),
    ];
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer(tags) }));
    const rule2 = result.errors.filter(e => e.rule === 'TAG_NAME_UNIQUENESS');
    expect(rule2[0].message).toContain('3 times');
  });
});

// ── Rule 3: CONSENT_SETTINGS_PRESENT ──────────────────────────────────────────

describe('Rule 3: CONSENT_SETTINGS_PRESENT', () => {
  it('passes when all platform tags have consentStatus: needed', () => {
    const tags = [
      makeTag({ name: 'GA4 - Config', type: 'gaawc', consentSettings: { consentStatus: 'needed' } }),
      makeTag({ name: 'Google Ads - purchase', type: 'awct', consentSettings: { consentStatus: 'needed' } }),
    ];
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer(tags) }));
    expect(result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT')).toHaveLength(0);
  });

  it('CRITICAL error for gaawc tag with no consentSettings', () => {
    const tag = makeTag({ name: 'GA4 - Config', type: 'gaawc' });
    delete (tag as Record<string, unknown>).consentSettings;
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer([tag]) }));
    const rule3 = result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT');
    expect(rule3.length).toBeGreaterThan(0);
    expect(rule3[0].severity).toBe('CRITICAL');
  });

  it('CRITICAL error for gaawe tag with consentStatus: notSet', () => {
    const tag = makeTag({
      name: 'GA4 - form_submit',
      type: 'gaawe',
      consentSettings: { consentStatus: 'notSet' as 'needed' },
    });
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer([tag]) }));
    const rule3 = result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT');
    expect(rule3.length).toBeGreaterThan(0);
    expect(rule3[0].severity).toBe('CRITICAL');
  });

  it('CRITICAL error for HTML Meta tag with missing consent', () => {
    const tag = makeTag({ name: 'Meta - purchase', type: 'html' });
    delete (tag as Record<string, unknown>).consentSettings;
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer([tag]) }));
    const rule3 = result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT');
    expect(rule3.length).toBeGreaterThan(0);
  });

  it('infrastructure html tags (Consent Mode) do NOT require the check', () => {
    const tag = makeTag({
      name: 'Atlas - Consent Mode v2 Default',
      type: 'html',
      consentSettings: { consentStatus: 'notNeeded' },
    });
    const result = validateGeneration(makeInput({ gtmContainer: makeContainer([tag]) }));
    expect(result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT')).toHaveLength(0);
  });
});

// ── Rule 4: EVENT_PARAMETERS_COMPLETENESS ─────────────────────────────────────

describe('Rule 4: EVENT_PARAMETERS_COMPLETENESS', () => {
  it('passes when gaawe tag maps all declared params', () => {
    const tag = makeTag({
      name: 'GA4 - contact_form_submit',
      type: 'gaawe',
      parameter: [
        { type: 'TEMPLATE', key: 'eventName', value: 'contact_form_submit' },
        {
          type: 'LIST',
          key: 'eventParameters',
          list: [{
            type: 'MAP',
            map: [
              { type: 'TEMPLATE', key: 'key', value: 'form_id' },
              { type: 'TEMPLATE', key: 'value', value: '{{DLV - form_id}}' },
            ],
          }],
        },
      ],
    });
    const rec = makeRec('contact_form_submit', 'form_submit', ['form_id']);
    const dlvVar = makeVariable('DLV - form_id', 'v');
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [dlvVar]),
      recommendations: [rec],
    }));
    expect(result.errors.filter(e => e.rule === 'EVENT_PARAMETERS_COMPLETENESS')).toHaveLength(0);
  });

  it('HIGH error when gaawe tag has no eventParameters but rec declares params', () => {
    const tag = makeTag({
      name: 'GA4 - contact_form_submit',
      type: 'gaawe',
      parameter: [{ type: 'TEMPLATE', key: 'eventName', value: 'contact_form_submit' }],
    });
    const rec = makeRec('contact_form_submit', 'form_submit', ['form_id', 'page_section']);
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag]),
      recommendations: [rec],
    }));
    const rule4 = result.errors.filter(e => e.rule === 'EVENT_PARAMETERS_COMPLETENESS');
    expect(rule4.length).toBeGreaterThan(0);
    expect(rule4[0].severity).toBe('HIGH');
  });

  it('HIGH error when a specific param is mapped but another is missing', () => {
    const tag = makeTag({
      name: 'GA4 - contact_form_submit',
      type: 'gaawe',
      parameter: [
        { type: 'TEMPLATE', key: 'eventName', value: 'contact_form_submit' },
        {
          type: 'LIST',
          key: 'eventParameters',
          list: [{
            type: 'MAP',
            map: [
              { type: 'TEMPLATE', key: 'key', value: 'form_id' },
              { type: 'TEMPLATE', key: 'value', value: '{{DLV - form_id}}' },
            ],
          }],
        },
      ],
    });
    const rec = makeRec('contact_form_submit', 'form_submit', ['form_id', 'cta_text']);
    const dlvVar = makeVariable('DLV - form_id', 'v');
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [dlvVar]),
      recommendations: [rec],
    }));
    const rule4 = result.errors.filter(e => e.rule === 'EVENT_PARAMETERS_COMPLETENESS');
    expect(rule4.length).toBeGreaterThan(0);
    expect(rule4[0].message).toContain('cta_text');
  });
});

// ── Rule 5: SCHEMA_SNIPPET_CONSISTENCY ────────────────────────────────────────

describe('Rule 5: SCHEMA_SNIPPET_CONSISTENCY', () => {
  const snippet = (keys: string[]) =>
    `window.dataLayer = window.dataLayer || [];\nwindow.dataLayer.push({\n  event: 'test',\n${keys.map(k => `  ${k}: '{{${k.toUpperCase()}}}'`).join(',\n')}\n});`;

  it('passes when schema keys match snippet keys', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'cta_click',
        action_type: 'cta_click',
        trigger_type: 'click_css',
        business_justification: '',
        priority: 'recommended',
        parameters: [{ key: 'cta_text', label: 'CTA Text', source: '', example: '', required: true }],
        code_snippet: snippet(['cta_text']),
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({ dataLayerSpec: spec }));
    expect(result.errors.filter(e => e.rule === 'SCHEMA_SNIPPET_CONSISTENCY')).toHaveLength(0);
  });

  it('CRITICAL error when param key is in schema but absent from snippet', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'cta_click',
        action_type: 'cta_click',
        trigger_type: 'click_css',
        business_justification: '',
        priority: 'recommended',
        parameters: [
          { key: 'cta_text', label: 'CTA Text', source: '', example: '', required: true },
          { key: 'page_section', label: 'Section', source: '', example: '', required: true },
        ],
        code_snippet: snippet(['cta_text']),  // missing page_section
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({ dataLayerSpec: spec }));
    const rule5 = result.errors.filter(e => e.rule === 'SCHEMA_SNIPPET_CONSISTENCY');
    expect(rule5.length).toBeGreaterThan(0);
    expect(rule5[0].severity).toBe('CRITICAL');
    expect(rule5[0].message).toContain('page_section');
  });

  it('CRITICAL error when snippet has a key not declared in schema', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'cta_click',
        action_type: 'cta_click',
        trigger_type: 'click_css',
        business_justification: '',
        priority: 'recommended',
        parameters: [{ key: 'cta_text', label: 'CTA Text', source: '', example: '', required: true }],
        code_snippet: snippet(['cta_text', 'mystery_key']),
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({ dataLayerSpec: spec }));
    const rule5 = result.errors.filter(e => e.rule === 'SCHEMA_SNIPPET_CONSISTENCY');
    expect(rule5.length).toBeGreaterThan(0);
    expect(rule5.some(e => e.message.includes('mystery_key'))).toBe(true);
  });

  it('skips ecommerce action types (nested object, not flat keys)', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/checkout',
      events: [{
        event_name: 'purchase',
        action_type: 'purchase',
        trigger_type: 'custom_event',
        business_justification: '',
        priority: 'required',
        parameters: [{ key: 'transaction_id', label: 'Txn', source: '', example: '', required: true }],
        code_snippet: `window.dataLayer.push({ event: 'purchase', ecommerce: { transaction_id: '123' } });`,
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({ dataLayerSpec: spec }));
    expect(result.errors.filter(e => e.rule === 'SCHEMA_SNIPPET_CONSISTENCY')).toHaveLength(0);
  });
});

// ── Rule 6: SELECTOR_VALIDITY ─────────────────────────────────────────────────

describe('Rule 6: SELECTOR_VALIDITY', () => {
  it('passes when no invalid selectors exist anywhere', () => {
    const trigger = makeTrigger({
      filter: [{ type: 'CSS_SELECTOR', parameter: [{ type: 'TEMPLATE', key: 'arg1', value: '#cta-button' }] }],
    });
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'cta_click',
        action_type: 'cta_click',
        trigger_type: 'click_css',
        element_selector: '#cta-button',
        business_justification: '',
        priority: 'recommended',
        parameters: [],
        code_snippet: '',
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([], [], [trigger]),
      dataLayerSpec: spec,
    }));
    expect(result.errors.filter(e => e.rule === 'SELECTOR_VALIDITY')).toHaveLength(0);
  });

  it('CRITICAL error when GTM trigger filter contains :contains()', () => {
    const trigger = makeTrigger({
      filter: [{ type: 'MATCHES_CSS', parameter: [
        { type: 'TEMPLATE', key: 'arg0', value: '{{Click Element}}' },
        { type: 'TEMPLATE', key: 'arg1', value: 'a:contains("Buy Now")' },
      ]}],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([], [], [trigger]),
    }));
    const rule6 = result.errors.filter(e => e.rule === 'SELECTOR_VALIDITY');
    expect(rule6.length).toBeGreaterThan(0);
    expect(rule6[0].severity).toBe('CRITICAL');
    expect(rule6[0].message).toContain(':contains(');
  });

  it('CRITICAL error when spec event_selector contains :contains()', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'cta_click',
        action_type: 'cta_click',
        trigger_type: 'click_css',
        element_selector: 'a:contains("Buy")',
        business_justification: '',
        priority: 'recommended',
        parameters: [],
        code_snippet: '',
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({ dataLayerSpec: spec }));
    const rule6 = result.errors.filter(e => e.rule === 'SELECTOR_VALIDITY');
    expect(rule6.length).toBeGreaterThan(0);
    expect(rule6[0].severity).toBe('CRITICAL');
  });

  it('also catches :has-text() and :text() pseudo-selectors', () => {
    const trigger = makeTrigger({
      filter: [{ type: 'MATCHES_CSS', parameter: [
        { type: 'TEMPLATE', key: 'arg1', value: 'button:has-text("Submit")' },
      ]}],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([], [], [trigger]),
    }));
    expect(result.errors.filter(e => e.rule === 'SELECTOR_VALIDITY').length).toBeGreaterThan(0);
  });
});

// ── Rule 7: BUSINESS_TYPE_ISOLATION ───────────────────────────────────────────

describe('Rule 7: BUSINESS_TYPE_ISOLATION', () => {
  it('passes when lead_gen site has no ecommerce action types or param keys', () => {
    const rec = makeRec('contact_form_submit', 'form_submit', ['form_id', 'phone_number']);
    const result = validateGeneration(makeInput({
      businessType: 'lead_gen',
      recommendations: [rec],
    }));
    expect(result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION')).toHaveLength(0);
  });

  it('CRITICAL error when lead_gen rec has ecommerce action_type', () => {
    const rec = makeRec('purchase', 'purchase', []);
    const result = validateGeneration(makeInput({
      businessType: 'lead_gen',
      recommendations: [rec],
    }));
    const rule7 = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(rule7.length).toBeGreaterThan(0);
    expect(rule7[0].severity).toBe('CRITICAL');
    expect(rule7[0].message).toContain('purchase');
  });

  it('CRITICAL error when lead_gen rec has ecommerce param key (e.g. transaction_id)', () => {
    const rec = makeRec('weird_event', 'form_submit', ['transaction_id']);
    const result = validateGeneration(makeInput({
      businessType: 'lead_gen',
      recommendations: [rec],
    }));
    const rule7 = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(rule7.length).toBeGreaterThan(0);
    expect(rule7.some(e => e.message.includes('transaction_id'))).toBe(true);
  });

  it('HIGH error when lead_gen param example_value contains a currency symbol', () => {
    const rec: PlanningRecommendation = {
      ...makeRec('weird_event', 'form_submit', []),
      required_params: [{
        param_key: 'budget',
        param_label: 'Budget',
        source: 'developer_provided',
        source_detail: '',
        example_value: '£500',
      }],
    };
    const result = validateGeneration(makeInput({
      businessType: 'lead_gen',
      recommendations: [rec],
    }));
    const rule7 = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(rule7.length).toBeGreaterThan(0);
    expect(rule7[0].severity).toBe('HIGH');
    expect(rule7[0].message).toContain('£500');
  });

  it('CRITICAL error when lead_gen spec snippet contains ecommerce: object', () => {
    const spec = makeSpec([{
      page_url: 'https://example.com/',
      events: [{
        event_name: 'weird_event',
        action_type: 'form_submit',
        trigger_type: 'custom_event',
        business_justification: '',
        priority: 'recommended',
        parameters: [],
        code_snippet: `window.dataLayer.push({ event: 'weird_event', ecommerce: { value: 99 } });`,
        platforms: ['ga4'],
      }],
    }]);
    const result = validateGeneration(makeInput({
      businessType: 'lead_gen',
      dataLayerSpec: spec,
    }));
    const rule7 = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(rule7.length).toBeGreaterThan(0);
    expect(rule7[0].severity).toBe('CRITICAL');
  });

  it('does NOT fire on ecommerce business type with ecommerce action types', () => {
    const rec = makeRec('purchase', 'purchase', ['transaction_id']);
    const result = validateGeneration(makeInput({
      businessType: 'ecommerce',
      recommendations: [rec],
    }));
    expect(result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION')).toHaveLength(0);
  });
});

// ── Rule 8: METADATA_ACCURACY ─────────────────────────────────────────────────

describe('Rule 8: METADATA_ACCURACY', () => {
  it('passes when spec platforms match session platforms', () => {
    const spec = makeSpec([], ['ga4', 'google_ads']);
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer(),
      dataLayerSpec: spec,
      platforms: ['ga4', 'google_ads'],
    }));
    expect(result.errors.filter(e => e.rule === 'METADATA_ACCURACY')).toHaveLength(0);
  });

  it('HIGH error when spec platforms differ from session platforms', () => {
    const spec = makeSpec([], ['ga4', 'meta']);
    const result = validateGeneration(makeInput({
      dataLayerSpec: spec,
      platforms: ['ga4', 'google_ads'],
    }));
    const rule8 = result.errors.filter(e => e.rule === 'METADATA_ACCURACY');
    expect(rule8.length).toBeGreaterThan(0);
    expect(rule8[0].severity).toBe('HIGH');
  });

  it('HIGH error when guide shows Conversions: 0 but recs have conversion event names', () => {
    const rec = makeRec('purchase', 'purchase', []);
    const guide = makeGuide(0);
    const result = validateGeneration(makeInput({
      implementationGuide: guide,
      recommendations: [rec],
      platforms: ['ga4'],
    }));
    const rule8 = result.errors.filter(e => e.rule === 'METADATA_ACCURACY');
    expect(rule8.length).toBeGreaterThan(0);
  });

  it('passes when guide conversion count matches', () => {
    const rec = makeRec('purchase', 'purchase', []);
    const guide = makeGuide(1);
    const result = validateGeneration(makeInput({
      implementationGuide: guide,
      recommendations: [rec],
      platforms: ['ga4'],
    }));
    expect(result.errors.filter(e => e.rule === 'METADATA_ACCURACY')).toHaveLength(0);
  });
});

// ── Rule 9: PLACEHOLDER_GUIDE_CONSISTENCY ─────────────────────────────────────

describe('Rule 9: PLACEHOLDER_GUIDE_CONSISTENCY', () => {
  it('passes when guide has no Meta Pixel mention and meta is not selected', () => {
    const guide = makeGuide(0, 'GA4 Measurement ID: G-XXXX');
    const result = validateGeneration(makeInput({
      implementationGuide: guide,
      platforms: ['ga4'],
    }));
    expect(result.errors.filter(e => e.rule === 'PLACEHOLDER_GUIDE_CONSISTENCY')).toHaveLength(0);
  });

  it('HIGH error when guide mentions Meta Pixel but meta is not a selected platform', () => {
    const guide = makeGuide(0, '| `CONST - Meta Pixel ID` | Meta Pixel |');
    const result = validateGeneration(makeInput({
      implementationGuide: guide,
      platforms: ['ga4'],
    }));
    const rule9 = result.errors.filter(e => e.rule === 'PLACEHOLDER_GUIDE_CONSISTENCY');
    expect(rule9.length).toBeGreaterThan(0);
    expect(rule9[0].severity).toBe('HIGH');
  });

  it('no error when guide mentions Meta Pixel AND meta is a selected platform', () => {
    const guide = makeGuide(0, '| `CONST - Meta Pixel ID` | Meta Pixel |');
    const result = validateGeneration(makeInput({
      implementationGuide: guide,
      platforms: ['ga4', 'meta'],
    }));
    expect(result.errors.filter(e => e.rule === 'PLACEHOLDER_GUIDE_CONSISTENCY')).toHaveLength(0);
  });

  it('no error when Meta Pixel var is in the container even without meta in platforms', () => {
    const guide = makeGuide(0, '| `CONST - Meta Pixel ID` | Meta Pixel |');
    const metaVar = makeVariable('CONST - Meta Pixel ID');
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([], [metaVar]),
      implementationGuide: guide,
      platforms: ['ga4'],
    }));
    expect(result.errors.filter(e => e.rule === 'PLACEHOLDER_GUIDE_CONSISTENCY')).toHaveLength(0);
  });
});

// ── Rule 10: PER_EVENT_CONVERSION_LABELS ──────────────────────────────────────

describe('Rule 10: PER_EVENT_CONVERSION_LABELS', () => {
  it('passes when awct tag references per-event CONST label var that exists', () => {
    const labelVarName = 'CONST - GAds Conversion Label - contact_form_submit';
    const convIdVarName = 'CONST - Google Ads Conversion ID';
    const tag = makeTag({
      name: 'Google Ads - contact_form_submit Conversion',
      type: 'awct',
      parameter: [
        { type: 'TEMPLATE', key: 'conversionId', value: `{{${convIdVarName}}}` },
        { type: 'TEMPLATE', key: 'conversionLabel', value: `{{${labelVarName}}}` },
      ],
    });
    const vars = [makeVariable(labelVarName), makeVariable(convIdVarName)];
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], vars),
    }));
    expect(result.errors.filter(e => e.rule === 'PER_EVENT_CONVERSION_LABELS')).toHaveLength(0);
  });

  it('CRITICAL error when awct tag has no conversionLabel parameter at all', () => {
    const tag = makeTag({
      name: 'Google Ads - purchase Conversion',
      type: 'awct',
      parameter: [{ type: 'TEMPLATE', key: 'conversionId', value: '{{CONST - Google Ads Conversion ID}}' }],
    });
    const convIdVar = makeVariable('CONST - Google Ads Conversion ID');
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [convIdVar]),
    }));
    const rule10 = result.errors.filter(e => e.rule === 'PER_EVENT_CONVERSION_LABELS');
    expect(rule10.length).toBeGreaterThan(0);
    expect(rule10[0].severity).toBe('CRITICAL');
  });

  it('CRITICAL error when conversionLabel references the shared {{CONVERSION_LABEL}} variable', () => {
    const tag = makeTag({
      name: 'Google Ads - purchase Conversion',
      type: 'awct',
      parameter: [
        { type: 'TEMPLATE', key: 'conversionLabel', value: '{{CONVERSION_LABEL}}' },
      ],
    });
    // CONVERSION_LABEL exists as a variable
    const sharedVar = makeVariable('CONVERSION_LABEL');
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], [sharedVar]),
    }));
    const rule10 = result.errors.filter(e => e.rule === 'PER_EVENT_CONVERSION_LABELS');
    expect(rule10.length).toBeGreaterThan(0);
    expect(rule10[0].severity).toBe('CRITICAL');
    expect(rule10[0].message).toContain('CONVERSION_LABEL');
  });

  it('CRITICAL error when conversionLabel references a non-existent variable', () => {
    const tag = makeTag({
      name: 'Google Ads - purchase Conversion',
      type: 'awct',
      parameter: [
        { type: 'TEMPLATE', key: 'conversionLabel', value: '{{CONST - GAds Conversion Label - purchase}}' },
      ],
    });
    // Variable NOT added to container
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], []),
    }));
    const rule10 = result.errors.filter(e => e.rule === 'PER_EVENT_CONVERSION_LABELS');
    expect(rule10.length).toBeGreaterThan(0);
    expect(rule10[0].severity).toBe('CRITICAL');
  });

  it('HIGH error when conversionLabel is a hardcoded literal (no {{}} reference)', () => {
    const tag = makeTag({
      name: 'Google Ads - purchase Conversion',
      type: 'awct',
      parameter: [
        { type: 'TEMPLATE', key: 'conversionLabel', value: 'AbCdEfGhIjKl' },
      ],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], []),
    }));
    const rule10 = result.errors.filter(e => e.rule === 'PER_EVENT_CONVERSION_LABELS');
    expect(rule10.length).toBeGreaterThan(0);
    expect(rule10[0].severity).toBe('HIGH');
  });

  it('result.passed is false when any CRITICAL error exists', () => {
    const tag = makeTag({
      name: 'Google Ads - purchase Conversion',
      type: 'awct',
      parameter: [],
    });
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer([tag], []),
    }));
    expect(result.passed).toBe(false);
  });

  it('result.passed is true when only HIGH (non-CRITICAL) errors exist', () => {
    // Duplicate tag name = HIGH severity
    const name = 'GA4 - cta_click';
    const tags = [
      makeTag({ name, type: 'gaawe', tagId: '1' }),
      makeTag({ name, type: 'gaawe', tagId: '2' }),
    ];
    const result = validateGeneration(makeInput({
      gtmContainer: makeContainer(tags),
    }));
    const hasHighOnly = result.errors.every(e => e.severity === 'HIGH');
    expect(hasHighOnly).toBe(true);
    // passed = no CRITICAL errors
    expect(result.passed).toBe(true);
  });
});
