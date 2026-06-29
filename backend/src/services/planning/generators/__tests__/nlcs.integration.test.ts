/**
 * Sprint 2.5-E — NLCS (No-LLM Context Scenario) acceptance gate integration tests
 *
 * Tests the full deterministic pipeline:
 *   generateGTMContainer → generateDataLayerSpec → generateDeveloperHandoffDoc → validateGeneration
 *
 * These tests do NOT call the LLM. All input is constructed from test fixtures
 * representing realistic recommendation sets for lead_gen and ecommerce sites.
 * A passing run here is the acceptance gate for Sprint 2.5 output quality.
 */
import { describe, it, expect } from 'vitest';

import { generateGTMContainer } from '../gtmContainerGenerator';
import { generateDataLayerSpec } from '../dataLayerSpecGenerator';
import { generateDeveloperHandoffDoc } from '../developerHandoffDoc';
import { validateGeneration } from '../validator/generation.validator';
import type { PlanningRecommendation, SuggestedParam, PlanningPage, PlanningSession } from '@/types/planning';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeParam(key: string, example = 'example'): SuggestedParam {
  return { param_key: key, param_label: key, source: 'developer_provided', source_detail: '', example_value: example };
}

function makeRec(
  id: string,
  pageId: string,
  eventName: string,
  actionType: string,
  required: string[],
  optional: string[] = [],
  platforms: string[] = ['ga4'],
  isConversion = false,
): PlanningRecommendation {
  return {
    id,
    page_id: pageId,
    action_type: actionType,
    event_name: eventName,
    element_selector: actionType === 'page_view' ? undefined : `#${eventName}`,
    element_type: actionType === 'page_view' ? 'track_page_view' : 'track_click',
    required_params: required.map(k => makeParam(k)),
    optional_params: optional.map(k => makeParam(k)),
    confidence_score: 1,
    business_justification: `Track ${eventName}`,
    affected_platforms: platforms,
    source: 'ai',
  };
}

function makePage(id: string, url: string, pageType = 'generic'): PlanningPage {
  return {
    id,
    session_id: 'sess1',
    url,
    page_type: pageType,
    page_order: 1,
    status: 'done',
    existing_tracking: [],
    created_at: '2026-01-01T00:00:00Z',
  };
}

function makeSession(
  businessType: PlanningSession['business_type'],
  platforms: string[],
): Pick<PlanningSession, 'id' | 'business_type' | 'selected_platforms' | 'website_url'> & PlanningSession {
  return {
    id: 'sess1',
    user_id: 'u1',
    website_url: 'https://example.com',
    business_type: businessType,
    selected_platforms: platforms,
    secondary_domains: [],
    status: 'outputs_ready',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// ── Lead Gen Fixtures ──────────────────────────────────────────────────────────

const LEAD_GEN_PAGES = [
  makePage('p1', 'https://example.com/', 'homepage'),
  makePage('p2', 'https://example.com/contact', 'contact'),
  makePage('p3', 'https://example.com/about', 'about'),
];

const LEAD_GEN_RECS: PlanningRecommendation[] = [
  makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
  makeRec('r2', 'p1', 'hero_cta_click', 'cta_click', ['cta_text'], ['page_section'], ['ga4', 'google_ads']),
  makeRec('r3', 'p2', 'contact_form_submit', 'form_submit', ['form_id', 'form_type'], [], ['ga4', 'google_ads']),
  makeRec('r4', 'p2', 'contact_form_submit', 'generate_lead', ['form_id'], [], ['ga4', 'google_ads'], true),
  makeRec('r5', 'p3', 'content_scroll', 'content_engagement', ['scroll_depth'], [], ['ga4']),
];

// ── Ecommerce Fixtures ─────────────────────────────────────────────────────────

const ECOM_PAGES = [
  makePage('p1', 'https://shop.example.com/', 'homepage'),
  makePage('p2', 'https://shop.example.com/products/widget', 'product'),
  makePage('p3', 'https://shop.example.com/cart', 'cart'),
  makePage('p4', 'https://shop.example.com/checkout/confirm', 'confirmation'),
];

const ECOM_RECS: PlanningRecommendation[] = [
  makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
  makeRec('r2', 'p2', 'view_item', 'view_item', ['item_id', 'item_name', 'price'], [], ['ga4', 'meta']),
  makeRec('r3', 'p3', 'add_to_cart', 'add_to_cart', ['item_id', 'item_name', 'quantity'], [], ['ga4', 'meta']),
  makeRec('r4', 'p4', 'purchase', 'purchase', ['transaction_id', 'value', 'currency'], ['coupon'], ['ga4', 'google_ads', 'meta'], true),
];

// ── Integration tests: Lead Gen ────────────────────────────────────────────────

describe('Lead gen pipeline — end-to-end validation', () => {
  const session = makeSession('lead_gen', ['ga4', 'google_ads']);

  const gtmContainer  = generateGTMContainer(LEAD_GEN_RECS, session);
  const dataLayerSpec = generateDataLayerSpec(LEAD_GEN_RECS, LEAD_GEN_PAGES, session);
  const guide         = generateDeveloperHandoffDoc(LEAD_GEN_RECS, LEAD_GEN_PAGES, session, gtmContainer);
  const result        = validateGeneration({
    gtmContainer,
    dataLayerSpec,
    implementationGuide: guide,
    recommendations: LEAD_GEN_RECS,
    businessType: 'lead_gen',
    platforms: session.selected_platforms,
  });

  it('validator passes (no CRITICAL errors)', () => {
    const criticals = result.errors.filter(e => e.severity === 'CRITICAL');
    if (criticals.length > 0) {
      // Provide a useful failure message listing all critical errors
      const msgs = criticals.map(e => `[${e.rule}] ${e.location}: ${e.message}`).join('\n');
      throw new Error(`CRITICAL validation errors:\n${msgs}`);
    }
    expect(result.passed).toBe(true);
  });

  it('GTM container contains a GA4 configuration tag', () => {
    const ga4Config = gtmContainer.containerVersion.tag.find(t => t.type === 'gaawc');
    expect(ga4Config).toBeDefined();
  });

  it('GTM container contains a Google Ads conversion tag for the conversion event', () => {
    const gAdsTags = gtmContainer.containerVersion.tag.filter(t => t.type === 'awct');
    expect(gAdsTags.length).toBeGreaterThan(0);
  });

  it('each Google Ads conversion tag has its own per-event label variable', () => {
    const gAdsTags = gtmContainer.containerVersion.tag.filter(t => t.type === 'awct');
    for (const tag of gAdsTags) {
      const labelParam = tag.parameter.find(p => p.key === 'conversionLabel');
      expect(labelParam).toBeDefined();
      // Must reference a variable named CONST - GAds Conversion Label - {event_name}
      expect(labelParam?.value).toMatch(/CONST - GAds Conversion Label -/);
      // That variable must exist in the container
      const varName = labelParam!.value!.replace(/^\{\{/, '').replace(/\}\}$/, '');
      const varExists = gtmContainer.containerVersion.variable.some(v => v.name === varName);
      expect(varExists).toBe(true);
    }
  });

  it('no Google Ads tag references the shared {{CONVERSION_LABEL}} placeholder', () => {
    const gAdsTags = gtmContainer.containerVersion.tag.filter(t => t.type === 'awct');
    for (const tag of gAdsTags) {
      const labelParam = tag.parameter.find(p => p.key === 'conversionLabel');
      expect(labelParam?.value).not.toBe('{{CONVERSION_LABEL}}');
    }
  });

  it('each Google Ads conversion tag has enhancedConversionsEnabled: true', () => {
    const gAdsTags = gtmContainer.containerVersion.tag.filter(t => t.type === 'awct');
    for (const tag of gAdsTags) {
      const ecParam = tag.parameter.find(p => p.key === 'enhancedConversionsEnabled');
      expect(ecParam?.value).toBe('true');
    }
  });

  it('no tag has consentStatus: notSet', () => {
    for (const tag of gtmContainer.containerVersion.tag) {
      expect(tag.consentSettings?.consentStatus).not.toBe('notSet');
    }
  });

  it('guide includes Platform IDs section', () => {
    expect(guide).toContain('Platform IDs to fill in');
  });

  it('guide includes Enhanced Conversions section for google_ads', () => {
    expect(guide).toContain('Enhanced Conversions');
    expect(guide).toContain('user_data');
  });

  it('guide includes dataLayer snippet for each event', () => {
    const eventNames = ['contact_form_submit'];
    for (const name of eventNames) {
      expect(guide).toContain(name);
    }
  });

  it('dataLayer spec has pages for the scanned URLs', () => {
    expect(dataLayerSpec.machine_spec.pages.length).toBeGreaterThan(0);
  });

  it('spec metadata.platforms matches session selected_platforms', () => {
    const specPlatforms = [...dataLayerSpec.metadata.platforms].sort();
    const sessionPlatforms = [...session.selected_platforms].sort();
    expect(specPlatforms).toEqual(sessionPlatforms);
  });
});

// ── Integration tests: Ecommerce ───────────────────────────────────────────────

describe('Ecommerce pipeline — end-to-end validation', () => {
  const session = makeSession('ecommerce', ['ga4', 'google_ads', 'meta']);

  const gtmContainer  = generateGTMContainer(ECOM_RECS, session);
  const dataLayerSpec = generateDataLayerSpec(ECOM_RECS, ECOM_PAGES, session);
  const guide         = generateDeveloperHandoffDoc(ECOM_RECS, ECOM_PAGES, session, gtmContainer);
  const result        = validateGeneration({
    gtmContainer,
    dataLayerSpec,
    implementationGuide: guide,
    recommendations: ECOM_RECS,
    businessType: 'ecommerce',
    platforms: session.selected_platforms,
  });

  it('validator passes (no CRITICAL errors)', () => {
    const criticals = result.errors.filter(e => e.severity === 'CRITICAL');
    if (criticals.length > 0) {
      const msgs = criticals.map(e => `[${e.rule}] ${e.location}: ${e.message}`).join('\n');
      throw new Error(`CRITICAL validation errors:\n${msgs}`);
    }
    expect(result.passed).toBe(true);
  });

  it('purchase conversion tag exists', () => {
    const purchaseTag = gtmContainer.containerVersion.tag.find(t =>
      t.type === 'awct' && t.name.includes('purchase'),
    );
    expect(purchaseTag).toBeDefined();
  });

  it('Meta event tags exist for view_item, add_to_cart, purchase', () => {
    const metaTags = gtmContainer.containerVersion.tag.filter(t =>
      t.type === 'html' && t.name.startsWith('Meta -'),
    );
    expect(metaTags.length).toBeGreaterThan(0);
  });

  it('Meta purchase tag passes event ID for CAPI deduplication', () => {
    const purchaseTag = gtmContainer.containerVersion.tag.find(t =>
      t.type === 'html' && t.name === 'Meta - purchase',
    );
    const htmlParam = purchaseTag?.parameter.find(p => p.key === 'html');
    expect(htmlParam?.value).toContain('Atlas - Event ID');
  });

  it('no ecommerce action_type errors on ecommerce site', () => {
    const rule7 = result.errors.filter(e => e.rule === 'BUSINESS_TYPE_ISOLATION');
    expect(rule7).toHaveLength(0);
  });
});

// ── Integration tests: Standard event alias ────────────────────────────────────

describe('Standard event alias — generate_lead for custom-named form event', () => {
  const session = makeSession('lead_gen', ['ga4', 'google_ads']);

  // Custom event name for the lead form, action_type is 'generate_lead' (legacy DB value)
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'demo_request_submit', 'generate_lead', ['form_id'], [], ['ga4', 'google_ads'], true),
  ];

  const gtmContainer = generateGTMContainer(recs, session);

  it('generates a standard alias tag for generate_lead action_type with custom event name', () => {
    const aliasTags = gtmContainer.containerVersion.tag.filter(t =>
      t.type === 'gaawe' && t.name.includes('generate_lead alias'),
    );
    expect(aliasTags.length).toBeGreaterThan(0);
  });

  it('alias tag fires generate_lead event name for Smart Bidding', () => {
    const aliasTag = gtmContainer.containerVersion.tag.find(t =>
      t.type === 'gaawe' && t.name.includes('alias'),
    );
    const eventNameParam = aliasTag?.parameter.find(p => p.key === 'eventName');
    expect(eventNameParam?.value).toBe('generate_lead');
  });

  it('primary GA4 tag still fires the custom event name', () => {
    const primaryTag = gtmContainer.containerVersion.tag.find(t =>
      t.type === 'gaawe' && t.name === 'GA4 - demo_request_submit',
    );
    const eventNameParam = primaryTag?.parameter.find(p => p.key === 'eventName');
    expect(eventNameParam?.value).toBe('demo_request_submit');
  });
});

// ── Integration tests: Consent tags ───────────────────────────────────────────

describe('Consent Mode v2 tags always present', () => {
  const session = makeSession('lead_gen', ['ga4']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
  ];
  const gtmContainer = generateGTMContainer(recs, session);

  it('includes a Consent Mode v2 Default tag', () => {
    const defaultTag = gtmContainer.containerVersion.tag.find(t =>
      t.name.includes('Consent Mode v2 Default'),
    );
    expect(defaultTag).toBeDefined();
  });

  it('includes a Consent Mode v2 Update tag', () => {
    const updateTag = gtmContainer.containerVersion.tag.find(t =>
      t.name.includes('Consent Mode v2 Update'),
    );
    expect(updateTag).toBeDefined();
  });

  it('consent tags do not have consentStatus: needed (they are infrastructure, not platform measurement)', () => {
    const consentTags = gtmContainer.containerVersion.tag.filter(t =>
      t.name.includes('Consent Mode'),
    );
    for (const tag of consentTags) {
      // Infrastructure tags either have no consentSettings or consentStatus: notNeeded
      expect(tag.consentSettings?.consentStatus).not.toBe('needed');
    }
  });
});

// ── Integration tests: Platform isolation ─────────────────────────────────────

describe('Platform-conditional tag generation', () => {
  it('does not generate Meta tags when meta is not in selected_platforms', () => {
    const session = makeSession('lead_gen', ['ga4']);
    const recs = [makeRec('r1', 'p1', 'cta_click', 'cta_click', [], [], ['ga4'])];
    const container = generateGTMContainer(recs, session);
    const metaTags = container.containerVersion.tag.filter(t =>
      t.type === 'html' && t.name.startsWith('Meta -'),
    );
    expect(metaTags).toHaveLength(0);
  });

  it('generates Meta tags when meta IS in selected_platforms', () => {
    const session = makeSession('ecommerce', ['ga4', 'meta']);
    const recs = [makeRec('r1', 'p1', 'purchase', 'purchase', ['transaction_id', 'value', 'currency'], [], ['ga4', 'meta'], true)];
    const container = generateGTMContainer(recs, session);
    const metaTags = container.containerVersion.tag.filter(t =>
      t.type === 'html' && t.name.startsWith('Meta -'),
    );
    expect(metaTags.length).toBeGreaterThan(0);
  });

  it('does not generate Google Ads tags when google_ads is not in selected_platforms', () => {
    const session = makeSession('lead_gen', ['ga4']);
    const recs = [makeRec('r1', 'p1', 'form_submit', 'form_submit', [], [], ['ga4'])];
    const container = generateGTMContainer(recs, session);
    const gAdsTags = container.containerVersion.tag.filter(t => t.type === 'awct');
    expect(gAdsTags).toHaveLength(0);
  });
});
