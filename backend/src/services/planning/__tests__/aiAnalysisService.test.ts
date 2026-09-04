/**
 * Regression tests for the action_type ingestion bug: validateRecommendedElements()
 * used to validate AI-returned action_type values against ACTION_PRIMITIVES (a
 * different, legacy Journey Builder enum) instead of the vocabulary the prompt
 * actually instructs the AI to use (UNIVERSAL_ACTION_TYPES + ecommerce types from
 * ir-schema.prompt.ts), silently rewriting most legitimate non-ecommerce
 * recommendations to action_type: 'custom'.
 */
import { describe, it, expect } from 'vitest';
import {
  validateRecommendedElements,
  sanitiseActionType,
  buildFallbackPageView,
} from '../aiAnalysisService';
import type { AIAnalysisRequest } from '@/types/planning';

function makeRawElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    element_reference: 'el_1',
    selector: '#cta',
    action_type: 'cta_click',
    suggested_event_name: 'hero_cta_click',
    suggested_event_category: 'engagement',
    business_justification: 'Track hero CTA clicks',
    priority: 'must_have',
    parameters: [],
    confidence: 0.9,
    ...overrides,
  };
}

describe('validateRecommendedElements — action_type vocabulary', () => {
  it('accepts a universal action_type (cta_click) on a lead_gen site instead of rewriting to custom', () => {
    const [rec] = validateRecommendedElements([makeRawElement({ action_type: 'cta_click' })], 'lead_gen');
    expect(rec.action_primitive_key).toBe('cta_click');
  });

  it('accepts every UNIVERSAL_ACTION_TYPES value, not just cta_click', () => {
    const raw = ['page_view', 'form_submit', 'content_engagement', 'content_navigation', 'ui_interaction'].map((t) =>
      makeRawElement({ action_type: t }),
    );
    const recs = validateRecommendedElements(raw, 'lead_gen');
    expect(recs.map((r) => r.action_primitive_key)).toEqual([
      'page_view',
      'form_submit',
      'content_engagement',
      'content_navigation',
      'ui_interaction',
    ]);
  });

  it('still downgrades an ecommerce action_type to form_submit on a lead_gen site (regression guard)', () => {
    const [rec] = validateRecommendedElements([makeRawElement({ action_type: 'view_item' })], 'lead_gen');
    expect(rec.action_primitive_key).toBe('form_submit');
  });

  it('still downgrades an ecommerce action_type to form_submit on a saas site', () => {
    const [rec] = validateRecommendedElements([makeRawElement({ action_type: 'purchase' })], 'saas');
    expect(rec.action_primitive_key).toBe('form_submit');
  });

  it('accepts an ecommerce action_type unmodified on an ecommerce site', () => {
    const [rec] = validateRecommendedElements([makeRawElement({ action_type: 'view_item' })], 'ecommerce');
    expect(rec.action_primitive_key).toBe('view_item');
  });

  it('still accepts the legacy action_primitive_key input format (backward compat)', () => {
    const raw = { ...makeRawElement(), action_type: undefined, action_primitive_key: 'generate_lead' };
    const [rec] = validateRecommendedElements([raw], 'lead_gen');
    expect(rec.action_primitive_key).toBe('generate_lead');
  });

  it('falls back to custom for an unrecognised action_type', () => {
    const [rec] = validateRecommendedElements([makeRawElement({ action_type: 'not_a_real_type' })], 'lead_gen');
    expect(rec.action_primitive_key).toBe('custom');
  });
});

describe('sanitiseActionType', () => {
  it('leaves a universal action_type unchanged regardless of business type', () => {
    expect(sanitiseActionType('cta_click', 'lead_gen')).toBe('cta_click');
    expect(sanitiseActionType('cta_click', 'ecommerce')).toBe('cta_click');
  });

  it('downgrades ecommerce action_types to form_submit for lead_gen and saas only', () => {
    expect(sanitiseActionType('purchase', 'lead_gen')).toBe('form_submit');
    expect(sanitiseActionType('purchase', 'saas')).toBe('form_submit');
    expect(sanitiseActionType('purchase', 'ecommerce')).toBe('purchase');
    expect(sanitiseActionType('purchase', 'content')).toBe('purchase');
  });
});

describe('buildFallbackPageView', () => {
  it('produces an action_primitive_key consistent with its own page_view event_name', () => {
    const req = { page_url: 'https://example.com/', page_title: 'Example' } as AIAnalysisRequest;
    const fallback = buildFallbackPageView(req);
    expect(fallback.suggested_event_name).toBe('page_view');
    expect(fallback.action_primitive_key).toBe('page_view');
  });
});
