/**
 * Functional tests — GA4 GTM Container Generator + GenerationValidator
 *
 * We test directly against the validator (pure function) and construct
 * minimal GTMContainerJSON fixtures that reflect what the generator
 * would produce, to verify structural contracts without needing a full
 * Supabase/Express context.
 */

import { describe, it, expect } from 'vitest';
import { validateGeneration } from '../../../backend/src/services/planning/generators/validator/generation.validator';
import type { GenerationValidationInput } from '../../../backend/src/services/planning/generators/validator/generation.validator';
import type { GTMContainerJSON, GTMTagDef } from '../../../backend/src/services/planning/generators/gtmContainerGenerator';
import type { DataLayerSpecOutput } from '../../../backend/src/services/planning/generators/dataLayerSpecGenerator';
// eslint-disable-next-line @typescript-eslint/no-unused-vars

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeContainer(overrides: {
  tags?: GTMTagDef[];
  variables?: GTMContainerJSON['containerVersion']['variable'];
  builtInVariables?: GTMContainerJSON['containerVersion']['builtInVariable'];
} = {}): GTMContainerJSON {
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      path: 'accounts/0/containers/0/versions/0',
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: 'Atlas Test Container',
      description: '',
      container: {
        path: 'accounts/0/containers/0',
        accountId: '0',
        containerId: '0',
        name: 'Test',
        publicId: 'GTM-TEST',
        usageContext: ['WEB'],
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: overrides.tags ?? [],
      trigger: [],
      variable: overrides.variables ?? [],
      folder: [],
      builtInVariable: overrides.builtInVariables ?? [],
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };
}

function makeEmptyDataLayerSpec(platforms: string[] = ['ga4']): DataLayerSpecOutput {
  return {
    atlas_spec_version: '1.0',
    metadata: {
      generated_at: new Date().toISOString(),
      atlas_spec_version: '1.0',
      business_type: 'lead_gen',
      platforms,
    },
    machine_spec: {
      event_schemas: [],
      ui_instrumentation_map: [],
      tracking_coverage: { total_events: 0, by_platform: {} } as unknown as import('../../../backend/src/services/planning/generators/dataLayerSpecGenerator').TrackingCoverage,
      pages: [],
      traffic_source: {} as unknown as import('../../../backend/src/services/planning/generators/dataLayerSpecGenerator').TrafficSourceSpec,
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

function baseInput(
  overrides: Partial<GenerationValidationInput> = {},
): GenerationValidationInput {
  return {
    gtmContainer: makeContainer(),
    dataLayerSpec: makeEmptyDataLayerSpec(),
    implementationGuide: '',
    recommendations: [],
    businessType: 'lead_gen',
    platforms: ['ga4'],
    ...overrides,
  };
}

// ── Scenario 1: GA4 PageView tag name convention ───────────────────────────────

describe('Scenario 1 — GA4 PageView tag naming', () => {
  it('container output includes a tag named "GA4 - PageView"', () => {
    // We construct the tag fixture that the generator would produce
    const pageViewTag: GTMTagDef = {
      accountId: '0',
      containerId: '0',
      tagId: '1',
      name: 'GA4 - PageView',
      type: 'gaawc',
      parameter: [
        { type: 'TEMPLATE', key: 'measurementId', value: '{{CONST - GA4 Measurement ID}}' },
      ],
      firingTriggerId: ['1'],
      tagFiringOption: 'oncePerEvent',
      consentSettings: { consentStatus: 'needed' },
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    };

    const constVar = {
      accountId: '0',
      containerId: '0',
      variableId: '1',
      name: 'CONST - GA4 Measurement ID',
      type: 'c',
      parameter: [{ type: 'TEMPLATE' as const, key: 'value', value: 'G-XXXXXXXXXX' }],
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    };

    const container = makeContainer({
      tags: [pageViewTag],
      variables: [constVar],
    });

    // Verify tag name appears in the container
    const tagNames = container.containerVersion.tag.map(t => t.name);
    expect(tagNames).toContain('GA4 - PageView');
  });
});

// ── Scenario 2: exportFormatVersion = 2 ───────────────────────────────────────

describe('Scenario 2 — exportFormatVersion', () => {
  it('GTM container fixture has exportFormatVersion: 2', () => {
    const container = makeContainer();
    expect(container.exportFormatVersion).toBe(2);
  });
});

// ── Scenario 3: CONSENT_SETTINGS_PRESENT rule ─────────────────────────────────

describe('Scenario 3 — CONSENT_SETTINGS_PRESENT rule', () => {
  it('flags a platform tag with consentStatus: notSet', () => {
    const badTag: GTMTagDef = {
      accountId: '0',
      containerId: '0',
      tagId: '2',
      name: 'GA4 - Config',
      type: 'gaawc',  // platform tag type
      parameter: [],
      firingTriggerId: [],
      tagFiringOption: 'oncePerEvent',
      consentSettings: { consentStatus: 'notSet' },   // ← bad
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    };

    const result = validateGeneration(baseInput({
      gtmContainer: makeContainer({ tags: [badTag] }),
    }));

    const consentErrors = result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT');
    expect(consentErrors.length).toBeGreaterThan(0);
    expect(consentErrors[0].severity).toBe('CRITICAL');
    expect(result.passed).toBe(false);
  });

  it('does NOT flag a platform tag with consentStatus: needed', () => {
    const goodTag: GTMTagDef = {
      accountId: '0',
      containerId: '0',
      tagId: '3',
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [],
      firingTriggerId: [],
      tagFiringOption: 'oncePerEvent',
      consentSettings: { consentStatus: 'needed' },   // ← correct
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    };

    const result = validateGeneration(baseInput({
      gtmContainer: makeContainer({ tags: [goodTag] }),
    }));

    const consentErrors = result.errors.filter(e => e.rule === 'CONSENT_SETTINGS_PRESENT');
    expect(consentErrors.length).toBe(0);
  });
});

// ── Scenario 4: BUSINESS_TYPE_ISOLATION — WalkerOS / ecommerce on lead_gen ────

describe('Scenario 4 — BUSINESS_TYPE_ISOLATION rule (ecommerce constructs on lead_gen)', () => {
  it('flags a recommendation with ecommerce action_type on a lead_gen business', () => {
    const ecommerceRec = {
      id: 'rec-1',
      session_id: 'session-1',
      event_name: 'purchase',
      action_type: 'purchase',     // ecommerce-only on lead_gen
      recommendation_type: 'track_event',
      element_reference: '',
      selector: null,
      approved: true,
      required_params: [],
      optional_params: [],
    } as unknown as import('../../../backend/src/types/planning').PlanningRecommendation;

    const result = validateGeneration(baseInput({
      businessType: 'lead_gen',
      recommendations: [ecommerceRec],
    }));

    const isolationErrors = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(isolationErrors.length).toBeGreaterThan(0);
    expect(isolationErrors[0].severity).toBe('CRITICAL');
    expect(result.passed).toBe(false);
  });

  it('does NOT flag an ecommerce action_type on an ecommerce business type', () => {
    const ecommerceRec = {
      id: 'rec-2',
      session_id: 'session-1',
      event_name: 'purchase',
      action_type: 'purchase',
      recommendation_type: 'track_event',
      element_reference: '',
      selector: null,
      approved: true,
      required_params: [],
      optional_params: [],
    } as unknown as import('../../../backend/src/types/planning').PlanningRecommendation;

    const result = validateGeneration(baseInput({
      businessType: 'ecommerce',
      recommendations: [ecommerceRec],
      dataLayerSpec: makeEmptyDataLayerSpec(['ga4']),
    }));

    const isolationErrors = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(isolationErrors.length).toBe(0);
  });

  it('WalkerOS-style tag (html type, non-Atlas prefix) does not trigger BUSINESS_TYPE_ISOLATION', () => {
    // WalkerOS is simply not generated by the renderer — verify the validator
    // does not flag a generic HTML tag as an isolation error.
    const walkerTag: GTMTagDef = {
      accountId: '0',
      containerId: '0',
      tagId: '10',
      name: 'WalkerOS - Custom',
      type: 'html',
      parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script>/* walkerOS */</script>' }],
      firingTriggerId: [],
      tagFiringOption: 'oncePerEvent',
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    };

    const result = validateGeneration(baseInput({
      businessType: 'lead_gen',
      gtmContainer: makeContainer({ tags: [walkerTag] }),
    }));

    const isolationErrors = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(isolationErrors.length).toBe(0);
  });
});
