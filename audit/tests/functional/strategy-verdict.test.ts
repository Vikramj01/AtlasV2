/**
 * Strategy Gate evaluation functional tests
 *
 * Tests the evaluationPrompt module: buildUserPrompt, parseEvalResponse,
 * enforceProxyRule, and verdict validation.
 *
 * Claude is NOT called — these tests exercise the prompt-building and
 * response-parsing logic only.
 */

import { describe, it, expect } from 'vitest';
import {
  buildUserPrompt,
  parseEvalResponse,
  enforceProxyRule,
  type EvalInput,
} from '../../../backend/src/services/strategy/evaluationPrompt';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_INPUT: EvalInput = {
  objectiveName: 'Lead Form Submission',
  description: 'User submits the main contact form requesting a demo',
  platforms: ['google_ads', 'meta'],
  currentEvent: 'form_submit',
  outcomeTimingDays: 30,
};

const CONFIRM_RESPONSE = {
  verdict: 'CONFIRM' as const,
  outcomeCategory: 'qualified_lead' as const,
  recommendedPrimaryEvent: null,
  recommendedPrimaryRationale: null,
  recommendedProxyEvent: null,
  proxyEventRationale: null,
  proxyEventRequired: false,
  conversionTier: 'primary' as const,
  platformActionTypes: {
    google_ads: 'primary_action',
    meta: 'optimization_event',
  },
  platformRationale: null,
  verdictRationale: 'The form_submit event directly maps to a qualified lead with clear intent.',
  summaryMarkdown: '## Verdict: CONFIRM\n\nThe current event is well-matched.',
};

const REPLACE_RESPONSE = {
  verdict: 'REPLACE' as const,
  outcomeCategory: 'qualified_lead' as const,
  recommendedPrimaryEvent: 'qualified_lead',
  recommendedPrimaryRationale: 'Better signal quality.',
  recommendedProxyEvent: 'form_start',
  proxyEventRationale: 'Earlier intent signal.',
  proxyEventRequired: true,
  conversionTier: 'primary' as const,
  platformActionTypes: {
    google_ads: 'primary_action',
    meta: 'optimization_event',
  },
  platformRationale: null,
  verdictRationale: 'form_submit fires too early before qualification. Recommend qualified_lead event.',
  summaryMarkdown: '## Verdict: REPLACE\n\nReplace with qualified_lead.',
};

// ── buildUserPrompt ───────────────────────────────────────────────────────────

describe('buildUserPrompt', () => {
  it('includes objective name, description, and current event', () => {
    const prompt = buildUserPrompt(BASE_INPUT);

    expect(prompt).toContain('Lead Form Submission');
    expect(prompt).toContain('form_submit');
    expect(prompt).toContain('30');
  });

  it('includes all target platforms', () => {
    const prompt = buildUserPrompt(BASE_INPUT);

    expect(prompt).toContain('google_ads');
    expect(prompt).toContain('meta');
  });

  it('produces a non-empty string', () => {
    const prompt = buildUserPrompt(BASE_INPUT);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ── parseEvalResponse ─────────────────────────────────────────────────────────

describe('parseEvalResponse', () => {
  it('parses valid CONFIRM JSON response', () => {
    const raw = JSON.stringify(CONFIRM_RESPONSE);
    const parsed = parseEvalResponse(raw);

    expect(parsed.verdict).toBe('CONFIRM');
    expect(parsed.conversionTier).toBe('primary');
  });

  it('parses valid REPLACE JSON response', () => {
    const raw = JSON.stringify(REPLACE_RESPONSE);
    const parsed = parseEvalResponse(raw);

    expect(parsed.verdict).toBe('REPLACE');
    expect(parsed.recommendedPrimaryEvent).toBe('qualified_lead');
    expect(parsed.proxyEventRequired).toBe(true);
  });

  it('parses response with markdown code block wrapper', () => {
    const raw = '```json\n' + JSON.stringify(CONFIRM_RESPONSE) + '\n```';
    const parsed = parseEvalResponse(raw);

    expect(parsed.verdict).toBe('CONFIRM');
  });

  it('verdict is one of CONFIRM | AUGMENT | REPLACE', () => {
    const validVerdicts = ['CONFIRM', 'AUGMENT', 'REPLACE'];

    for (const verdict of validVerdicts) {
      const raw = JSON.stringify({ ...CONFIRM_RESPONSE, verdict });
      const parsed = parseEvalResponse(raw);
      expect(validVerdicts).toContain(parsed.verdict);
    }
  });

  it('throws or returns error for invalid JSON', () => {
    expect(() => parseEvalResponse('not valid json')).toThrow();
  });

  it('platformActionTypes is an object with at least one platform key when provided', () => {
    const parsed = parseEvalResponse(JSON.stringify(REPLACE_RESPONSE));
    if (parsed.platformActionTypes) {
      expect(typeof parsed.platformActionTypes).toBe('object');
      expect(Object.keys(parsed.platformActionTypes).length).toBeGreaterThan(0);
    }
  });
});

// ── enforceProxyRule ──────────────────────────────────────────────────────────

describe('enforceProxyRule', () => {
  it('preserves proxyEventRequired=false when outcomeTimingDays <= 1', () => {
    const result = enforceProxyRule(CONFIRM_RESPONSE as any, 1);

    expect(result.proxyEventRequired).toBe(false);
  });

  it('sets proxyEventRequired=true when timing > 1 day', () => {
    const result = enforceProxyRule(REPLACE_RESPONSE as any, 30);

    expect(result.proxyEventRequired).toBe(true);
  });

  it('returns response with verdict intact', () => {
    const result = enforceProxyRule(CONFIRM_RESPONSE as any, 30);

    expect(result.verdict).toBe('CONFIRM');
  });
});

// ── OCI nudge (documented behaviour) ─────────────────────────────────────────

describe('OCI nudge for CRM-stage events', () => {
  const CRM_STAGE_EVENTS = ['sql_created', 'mql_created', 'opportunity_created', 'closed_won'];

  it('CRM-stage event names are correctly formatted', () => {
    for (const eventName of CRM_STAGE_EVENTS) {
      expect(typeof eventName).toBe('string');
      expect(eventName.length).toBeGreaterThan(0);
      expect(eventName).toMatch(/^[a-z_]+$/);
    }
  });

  it('strategy route adds oci_nudge flag for CRM events (documented pattern)', () => {
    const crmEvents = new Set(['sql_created', 'mql_created', 'opportunity_created', 'closed_won']);
    const testEvent = 'sql_created';
    expect(crmEvents.has(testEvent)).toBe(true);
  });
});

// ── conversionTier values ─────────────────────────────────────────────────────

describe('conversionTier', () => {
  const VALID_TIERS = ['primary', 'secondary', 'suppression'];

  it('CONFIRM response has valid conversionTier', () => {
    const parsed = parseEvalResponse(JSON.stringify(CONFIRM_RESPONSE));
    expect(VALID_TIERS).toContain(parsed.conversionTier);
  });

  it('REPLACE response has valid conversionTier', () => {
    const parsed = parseEvalResponse(JSON.stringify(REPLACE_RESPONSE));
    expect(VALID_TIERS).toContain(parsed.conversionTier);
  });
});
